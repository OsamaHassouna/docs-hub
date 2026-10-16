import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { getRedis, todayKey } from '../../lib/kv';
import { EMAIL_SHELL, SYSTEM_PROMPT } from '../../lib/gemini-prompt';
import { blockCrossOrigin } from '../../lib/origin';

export const prerender = false;

// Primary: 3.6 Flash. In side-by-side tests vs 2.5 Flash (2026-10-15) it kept
// layout and content close to the design, answering in 40-70s on the free tier.
// 3.8 Flash matched it on quality but kept returning 503 "high demand" or
// running past 220s, so it is one env change away, not the default.
// Fallback: much faster Flash-Lite, used when the primary is overloaded, out
// of quota, timed out, truncated, or gone. Both overridable from Vercel env
// with no code change (Vercel applies env changes on the next deploy only).
const PRIMARY_MODEL = modelFromEnv('GENERATE_MODEL_PRIMARY', 'gemini-3.6-flash');
const FALLBACK_MODEL = modelFromEnv('GENERATE_MODEL_FALLBACK', 'gemini-3.5-flash-lite');
// Last resort when the fallback fails too, if time is left. 2.5 Flash answers
// and cites where Gemini 3.x blocks the whole answer as RECITATION (2026-10-16).
const LAST_RESORT_MODEL = modelFromEnv('GENERATE_MODEL_LAST_RESORT', 'gemini-2.5-flash');
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

// Vercel kills the function at maxDuration (300s, astro.config.mjs). Every
// provider call gets its timeout from one request-wide deadline, and the
// primary never eats the slice reserved for the fallback.
const REQUEST_DEADLINE_MS = 280_000;
// A primary call past 150s is stuck in a queue, not thinking. Cut it so the
// user gets the fallback at ~3 minutes instead of ~4.
const PRIMARY_TIMEOUT_MS = 150_000;
const FALLBACK_RESERVE_MS = 60_000;
// Flash-Lite answers in ~15-20s, so 90s is generous and leaves room for the
// last resort, which only runs with at least 45s (~30s per 2.5 call) left.
// When the deadline can't leave that room anyway (after a timed-out primary:
// 280 - 150 - 90 = 40s), the fallback gets all the time left instead.
const FALLBACK_TIMEOUT_MS = 90_000;
const LAST_RESORT_MIN_MS = 45_000;
const MIN_PRIMARY_WINDOW_MS = 30_000;
// Retry the primary only after a fast failure (an instant 503 "high demand").
// A slow failure means another long wait, so go straight to the fallback.
const QUICK_FAILURE_MS = 20_000;
const RETRY_BACKOFF_MS = 1500;
const PRIMARY_MAX_ATTEMPTS = 2;

const DAILY_LIMIT_PER_IP = numberFromEnv('GENERATE_DAILY_LIMIT_PER_IP', 10);
const DAILY_LIMIT_GLOBAL = numberFromEnv('GENERATE_DAILY_LIMIT_GLOBAL', 200);
const QUOTA_TTL_SECONDS = 60 * 60 * 26;

// A blank env value means "use the default", and a pasted `models/` prefix
// (how the models.list API names them) is dropped so the URL doesn't double it.
function modelFromEnv(name: string, fallback: string): string {
  return process.env[name]?.trim().replace(/^models\//, '') || fallback;
}

// Same rule for the limits: a blank value would be Number('') = 0 and 429
// every request, and a typo would be NaN and disable the cap.
function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

function clientIpHash(request: Request): string {
  // Prefer Vercel's authoritative client-IP header — `x-forwarded-for` is
  // client-spoofable on the way in, so reading [0] of it would happily quota
  // an attacker's claimed IP instead of the real one.
  const vercel = request.headers.get('x-vercel-forwarded-for') ?? '';
  const real = request.headers.get('x-real-ip') ?? '';
  const fwd = request.headers.get('x-forwarded-for') ?? '';
  // From `x-forwarded-for`, the rightmost value is the closest upstream proxy
  // (Vercel's edge in our case) — much harder to spoof than [0].
  const fwdLast = fwd.split(',').map(s => s.trim()).filter(Boolean).pop() ?? '';
  const raw = (vercel || real || fwdLast || 'unknown').trim();
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RequestBody {
  image?: string;
  mimeType?: string;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

type ProviderOutcome =
  | { kind: 'ok'; text: string; finishReason?: string }
  | { kind: 'retryable'; status: number; message: string; finishReason?: string }
  | { kind: 'fatal'; status: number; message: string; providerStatus?: string }
  | { kind: 'blocked'; reason: string };

// Candidate-level blocks come back with one of these finish reasons instead of
// promptFeedback, sometimes with the partial answer written before the stop.
// Retrying or falling back won't help.
const BLOCK_FINISH_REASONS = new Set(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

// An answer that stopped for any reason but STOP (MAX_TOKENS, RECITATION,
// OTHER...) is cut short, so it is a failure, not a result.
function isIncomplete(outcome: ProviderOutcome): boolean {
  return outcome.kind === 'ok' && outcome.finishReason !== undefined && outcome.finishReason !== 'STOP';
}

// Anything but a complete answer or a safety block. A blocked image would be
// blocked by the fallback too; a cut-short answer is a failure.
function isFailure(outcome: ProviderOutcome): boolean {
  return outcome.kind === 'retryable' || outcome.kind === 'fatal' || isIncomplete(outcome);
}

function isTimeout(err: unknown): boolean {
  const name = (err as Error)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

// For the fallback log line: enough to tell "high demand" from "model gone".
function describeOutcome(outcome: ProviderOutcome | null): string {
  if (!outcome) return 'no window';
  if (outcome.kind === 'ok') return `incomplete (${outcome.finishReason})`;
  if (outcome.kind === 'blocked') return `blocked (${outcome.reason})`;
  const providerStatus = outcome.kind === 'fatal' && outcome.providerStatus ? ` ${outcome.providerStatus}` : '';
  const finish = outcome.kind === 'retryable' && outcome.finishReason ? ` (${outcome.finishReason})` : '';
  return `${outcome.kind} ${outcome.status}${providerStatus}: ${outcome.message}${finish}`;
}

async function callProvider(
  model: string,
  body: string,
  apiKey: string,
  timeoutMs: number,
  clientSignal: AbortSignal,
): Promise<ProviderOutcome> {
  // One signal covers the request and the body read below, and also fires if
  // the browser disconnects. Clamped because timeout() throws on a negative
  // value, and an exhausted budget should read as a timeout, not a 500.
  const signal = AbortSignal.any([AbortSignal.timeout(Math.max(0, timeoutMs)), clientSignal]);
  let res: Response;
  try {
    // Key in a header, not the query string, so it stays out of URL logs.
    res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body,
      signal,
    });
  } catch (err) {
    if (isTimeout(err)) return { kind: 'retryable', status: 504, message: 'Timed out' };
    return { kind: 'retryable', status: 0, message: (err as Error).message || 'Network error' };
  }

  let data: GeminiResponse;
  try {
    data = (await res.json()) as GeminiResponse;
  } catch (err) {
    if (isTimeout(err)) return { kind: 'retryable', status: 504, message: 'Timed out' };
    return RETRYABLE_HTTP.has(res.status)
      ? { kind: 'retryable', status: res.status, message: 'Non-JSON response' }
      : { kind: 'fatal', status: res.status, message: `Generation service returned an unexpected response (${res.status}).` };
  }

  if (!res.ok || data.error) {
    const providerMsg = data.error?.message ?? `Service error (${res.status})`;
    if (RETRYABLE_HTTP.has(res.status)) {
      return { kind: 'retryable', status: res.status, message: providerMsg };
    }
    return { kind: 'fatal', status: res.status, message: 'Generation service rejected the request.', providerStatus: data.error?.status };
  }

  if (data.promptFeedback?.blockReason) {
    return { kind: 'blocked', reason: data.promptFeedback.blockReason };
  }

  const candidate = data.candidates?.[0];
  // Before the text check: a safety stop can still carry a partial answer.
  if (candidate?.finishReason && BLOCK_FINISH_REASONS.has(candidate.finishReason)) {
    return { kind: 'blocked', reason: candidate.finishReason };
  }
  const text = candidate?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
  if (!text) {
    // RECITATION lands here: an empty answer, with the reason only in finishReason.
    return { kind: 'retryable', status: res.status, message: 'Empty response', finishReason: candidate?.finishReason };
  }
  return { kind: 'ok', text, finishReason: candidate?.finishReason };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// The fenced blocks wherever they sit, joined: prose after a closing fence often
// quotes tags (`<table role="presentation">`), and the chat trim in
// wrapInShell would keep the fence and that prose up to the quoted tag. All of
// them, not just the first: the head <style> blocks can come in a fence of
// their own ahead of the body markup. Any info string (```css, ```json), so a
// closing fence is never taken for an opener.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const blocks = Array.from(trimmed.matchAll(/```[^\n`]*\n([\s\S]*?)\n```/g), (m) => m[1].trim());
  return blocks.length ? blocks.join('\n') : trimmed;
}

// A <style> block sent with the body markup, alone or wrapped whole in a
// conditional comment: hidden (<!--[if mso]><style>...</style><![endif]-->) or
// revealed (<!--[if !mso]><!--><style>...</style><!--<![endif]-->, which keeps
// web-font CSS away from Outlook's Times New Roman fallback). It belongs in the
// head. The conditional's two ends match together or not at all, so a move
// never leaves half a comment behind (an orphan `<!--` hides everything up to
// the next `-->` in every client but Outlook) or drops the wrapper.
const STYLE_BLOCK = /<!--\[if [^\]]*\]>\s*<style\b(?:(?!<\/style>)[\s\S])*<\/style>\s*<!\[endif\]-->|<!--\[if [^\]]*\]><!--(?:\s*--)?>\s*<style\b(?:(?!<\/style>)[\s\S])*<\/style>\s*<!--<!\[endif\]-->|<style\b[\s\S]*?<\/style>/gi;

// Splits the style blocks from the markup. A bare <style> inside a wider
// conditional comment (other markup around it) stays where it is: moving it
// out would change which clients see it. Hidden conditionals leave a `<!--`
// open; a revealed one (<!--[if !mso]><!--> ... <!--<![endif]-->) closes its
// own comment, so only an [if without its [endif] shows it is still open.
function takeStyles(markup: string): { styles: string[]; rest: string } {
  const styles: string[] = [];
  const rest = markup.replace(STYLE_BLOCK, (block: string, at: number) => {
    const before = markup.slice(0, at).toLowerCase();
    const inComment = before.lastIndexOf('<!--') > before.lastIndexOf('-->');
    const inConditional = before.lastIndexOf('[if ') > before.lastIndexOf('[endif]');
    if (inComment || inConditional) return block;
    styles.push(block);
    return '';
  });
  return { styles, rest };
}

// The generator returns only what goes inside <body>, plus the head <style>
// blocks. The server owns the doctype, head and body tag, built
// at compile time from the playbook's structure/head and body-container pages.
// Writing that long fixed boilerplate verbatim is what made Gemini 3.x block
// whole answers as RECITATION (2026-10-16).
function wrapInShell(markup: string): string {
  // A full document anyway (e.g. from a model that ignored the scope): keep it.
  // Comments skipped: one echoing the scope ("no <html> tag") is not a document.
  if (/<html[\s>]/i.test(markup.replace(/<!--[\s\S]*?-->/g, ''))) return markup;
  // Styles first, from the whole answer: one sent ahead of a stray <body> tag
  // still belongs in the head.
  const { styles, rest } = takeStyles(markup);
  const body = (rest.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? rest).trim();
  // Chat around the markup ("Here is your email:", "Let me know...") would land
  // inside the email. Keep only the span from the first tag to the last.
  const content = body.slice(Math.max(0, body.indexOf('<')), body.lastIndexOf('>') + 1);

  // The shell says lang="en". An RTL body also gets dir="rtl" on <html>, and the
  // lang of its script when that is clear (compatibility/rtl). RTL means the
  // email's main language: a bilingual email with one dir="rtl" block in an
  // English body stays LTR, so RTL letters must not be outnumbered by Latin
  // ones in the visible text (tags, comments, entities and {{tokens}} stripped:
  // the &nbsp; of every spacer cell would otherwise count as Latin letters).
  let shell = EMAIL_SHELL.before;
  if (/\bdir\s*=\s*["']?rtl/i.test(content)) {
    const text = content.replace(/<!--[\s\S]*?-->|<[^>]*>|&#?\w+;|\{\{[^}]*\}\}/g, ' ');
    const rtlLetters = (text.match(/[֐-׿؀-ۿ]/g) ?? []).length;
    const latinLetters = (text.match(/[A-Za-z]/g) ?? []).length;
    if (rtlLetters >= latinLetters) {
      // Arabic script is shared: Urdu and Persian letters first, then Arabic.
      const lang = /[ٹڈڑںے]/.test(text) ? 'ur'
        : /[پچژگ]/.test(text) ? 'fa'
        : /[؀-ۿ]/.test(text) ? 'ar'
        : /[֐-׿]/.test(text) ? 'he'
        : null;
      shell = shell.replace('lang="en"', () => (lang ? `lang="${lang}" dir="rtl"` : 'lang="en" dir="rtl"'));
    }
  }
  // Function replacers: a string one would treat `$&` etc. in the CSS as patterns.
  const before = styles.length ? shell.replace('</head>', () => `${styles.join('\n')}\n</head>`) : shell;
  return `${before}${content}${EMAIL_SHELL.after}`;
}

// Runs on the wrapped document, where the shell always supplies the doctype
// and </html>, so the table checks are what test the model's own markup: it
// built a table and closed one (not a refusal that mentions "<table>").
function looksLikeEmailHtml(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('<!doctype') && lower.includes('<table') && lower.includes('</table>') && lower.includes('</html>');
}

export const POST: APIRoute = async ({ request }) => {
  // The deadline counts from here: body parsing and the quota round-trips
  // below also run inside Vercel's maxDuration.
  const startedAt = Date.now();
  const remainingMs = () => REQUEST_DEADLINE_MS - (Date.now() - startedAt);

  const blocked = blockCrossOrigin(request);
  if (blocked) return blocked;

  const apiKey = import.meta.env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      { error: 'Generation service is not configured on the server.' },
      503,
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Body must be valid JSON.' }, 400);
  }

  const { image, mimeType } = body;
  if (!image || typeof image !== 'string') {
    return jsonResponse({ error: 'Missing "image" (base64 string).' }, 400);
  }
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    return jsonResponse(
      { error: `Unsupported mimeType. Allowed: ${Array.from(ALLOWED_MIME).join(', ')}.` },
      400,
    );
  }

  const approxBytes = Math.floor((image.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    return jsonResponse(
      { error: `Image too large (${Math.round(approxBytes / 1024)}KB). Max ${MAX_IMAGE_BYTES / 1024 / 1024}MB.` },
      413,
    );
  }

  // ── Quota gate (per-IP + global daily) ───────────────────────
  // Reserve quota BEFORE the provider call so a request that reaches Gemini
  // always consumes a slot, even if the response fails downstream validation
  // (otherwise an attacker can spam invalid inputs that burn provider cost
  // without ever filling the bucket).
  const redis = getRedis();
  const date = todayDate();
  const ipHash = clientIpHash(request);
  const ipKey = `quota:ip:${ipHash}:${date}`;
  const globalKey = `quota:global:${date}`;

  if (redis) {
    try {
      // Atomic increment-and-check: the INCR result IS the new value, so two
      // concurrent requests get distinct counts. Increment IP first; if the
      // global cap rejects after, refund the IP since the system cap isn't
      // the caller's fault.
      const ipNewCount = await redis.incr(ipKey);
      await redis.expire(ipKey, QUOTA_TTL_SECONDS).catch(() => {});

      if (ipNewCount > DAILY_LIMIT_PER_IP) {
        return jsonResponse(
          {
            error: `Daily limit reached for this client (${DAILY_LIMIT_PER_IP}/day). Try again tomorrow.`,
            limit: DAILY_LIMIT_PER_IP,
            scope: 'per-ip',
          },
          429,
        );
      }

      const globalNewCount = await redis.incr(globalKey);
      await redis.expire(globalKey, QUOTA_TTL_SECONDS).catch(() => {});

      if (globalNewCount > DAILY_LIMIT_GLOBAL) {
        // Refund the IP — caller didn't get to make a real request.
        await redis.decr(ipKey).catch(() => {});
        return jsonResponse(
          {
            error: `Service has reached its daily total cap. Try again tomorrow.`,
            limit: DAILY_LIMIT_GLOBAL,
            scope: 'global',
          },
          429,
        );
      }
    } catch {
      /* if KV fails, fail open — never block on infrastructure errors */
    }
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Convert this email design per the system instructions. Follow OUTPUT SCOPE: return only the markup that goes inside <body>.' },
          { inline_data: { mime_type: mimeType, data: image } },
        ],
      },
    ],
    // No temperature/topP: Gemini 3.x is tuned for its defaults, and the old
    // 0.2 was set for 2.5 Flash. Default thinking level on purpose: medium and
    // low both lost layout fidelity in testing (on 3.8) and were not faster.
    // Thinking tokens count against maxOutputTokens, so use the full 65536
    // both default models allow (models.get, 2026-10-15), not the old 32768.
    generationConfig: {
      maxOutputTokens: 65536,
      responseMimeType: 'text/plain',
    },
  };

  // Serialized once: it carries the base64 image and is sent up to 4 times.
  const providerBody = JSON.stringify(payload);

  let outcome: ProviderOutcome | null = null;
  let attempts = 0;
  // The model behind `outcome`, for the success log.
  let model = PRIMARY_MODEL;
  for (let i = 0; i < PRIMARY_MAX_ATTEMPTS; i++) {
    const windowMs = Math.min(PRIMARY_TIMEOUT_MS, remainingMs() - FALLBACK_RESERVE_MS);
    if (windowMs < MIN_PRIMARY_WINDOW_MS) break;
    attempts++;
    const callStartedAt = Date.now();
    outcome = await callProvider(PRIMARY_MODEL, providerBody, apiKey, windowMs, request.signal);
    const quickFailure = Date.now() - callStartedAt < QUICK_FAILURE_MS;
    if (request.signal.aborted) break;
    // 429 is quota: the same model won't recover within this request. An empty
    // 200 (e.g. RECITATION) is the model declining, not a transient error.
    if (outcome.kind !== 'retryable' || outcome.status === 429 || outcome.status === 200 || !quickFailure) break;
    if (i < PRIMARY_MAX_ATTEMPTS - 1) await sleep(RETRY_BACKOFF_MS);
  }

  // The browser left mid-wait: nobody will read an answer, so skip the fallback.
  // Only fires where the runtime propagates disconnects: local dev today. On
  // Vercel request.signal needs `supportsCancellation` (not enabled), so there
  // these checks are inert and the request runs to completion as before.
  if (request.signal.aborted) {
    return jsonResponse({ error: 'Client disconnected.', attempts }, 499);
  }

  // One later stage (fallback, last resort). The client only gets a generic
  // message, so the log line here is the one record of why that model failed
  // too (e.g. a retired model id returning 404).
  const callLaterStage = async (stageModel: string, windowMs: number): Promise<ProviderOutcome> => {
    attempts++;
    model = stageModel;
    const result = await callProvider(stageModel, providerBody, apiKey, windowMs, request.signal);
    // A disconnect aborts the call too; don't log it as a timeout.
    if (!request.signal.aborted && isFailure(result)) {
      console.warn(`[generate-email] ${stageModel} failed too (${describeOutcome(result)})`);
    }
    return result;
  };

  if (!outcome || isFailure(outcome)) {
    console.warn(`[generate-email] ${PRIMARY_MODEL} failed (${describeOutcome(outcome)}), using ${FALLBACK_MODEL}`);
    const left = remainingMs();
    outcome = await callLaterStage(FALLBACK_MODEL, left - FALLBACK_TIMEOUT_MS >= LAST_RESORT_MIN_MS ? FALLBACK_TIMEOUT_MS : left);
    if (request.signal.aborted) {
      return jsonResponse({ error: 'Client disconnected.', attempts }, 499);
    }
  }

  // Not for request errors (bad image, bad key): a third model would only add
  // a wait before the same answer. A 404 is different: the fallback model id is
  // retired or mistyped, and the last resort can still answer.
  const lastResortCanHelp = isFailure(outcome) && (outcome.kind !== 'fatal' || outcome.status === 404);
  if (lastResortCanHelp && remainingMs() >= LAST_RESORT_MIN_MS) {
    console.warn(`[generate-email] using last resort ${LAST_RESORT_MODEL}`);
    outcome = await callLaterStage(LAST_RESORT_MODEL, remainingMs());
    if (request.signal.aborted) {
      return jsonResponse({ error: 'Client disconnected.', attempts }, 499);
    }
  }

  if (outcome.kind === 'blocked') {
    return jsonResponse({ error: `Blocked by safety filter: ${outcome.reason}`, attempts }, 422);
  }

  if (outcome.kind === 'fatal') {
    const status = outcome.status >= 400 && outcome.status < 600 ? outcome.status : 502;
    return jsonResponse({ error: outcome.message, attempts }, status);
  }

  if (outcome.kind === 'retryable') {
    return jsonResponse(
      { error: `Generation failed after ${attempts} attempts. Try again in a moment.`, attempts },
      outcome.status >= 400 && outcome.status < 600 ? outcome.status : 502,
    );
  }

  const cleaned = stripCodeFence(outcome.text);
  // Only a fallback or last-resort answer can reach here cut short (the
  // primary's went to the fallback). Any stop but STOP is partial output, not
  // a result.
  if (isIncomplete(outcome)) {
    const error = outcome.finishReason === 'MAX_TOKENS'
      ? 'Response was truncated. Try a simpler image.'
      : `Response was cut short (${outcome.finishReason}). Try again or use a different image.`;
    return jsonResponse({ error, raw: cleaned.slice(0, 500), attempts }, 422);
  }

  if (cleaned.startsWith('{') && cleaned.includes('"error"')) {
    try {
      const parsed = JSON.parse(cleaned) as { error?: string };
      if (parsed.error) {
        return jsonResponse({ error: parsed.error }, 422);
      }
    } catch {
      /* fall through to html handling */
    }
  }

  const html = wrapInShell(cleaned);
  if (!looksLikeEmailHtml(html)) {
    return jsonResponse(
      {
        error: 'Model output did not look like a complete HTML email. Try a clearer image.',
        raw: cleaned.slice(0, 500),
      },
      422,
    );
  }

  const generationId = `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  // Quota counters were already charged before the provider call. Bump only
  // the success-stats counter here so the stats dashboard reflects actually
  // successful generations, not raw attempts.
  if (redis) {
    redis.incr(todayKey()).catch(() => { /* best-effort */ });
  }

  // Which model answered: the record of how often the fallback chain is needed.
  console.info(`[generate-email] answered by ${model} after ${attempts} attempt(s)`);

  return jsonResponse({ html, attempts, generation_id: generationId }, 200);
};

export const GET: APIRoute = () =>
  jsonResponse(
    { error: 'Use POST with JSON body { image: base64, mimeType: string }.' },
    405,
  );
