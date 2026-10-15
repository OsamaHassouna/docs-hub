import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { getRedis, todayKey } from '../../lib/kv';
import { SYSTEM_PROMPT } from '../../lib/gemini-prompt';
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
  | { kind: 'retryable'; status: number; message: string }
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
  return `${outcome.kind} ${outcome.status}${providerStatus}: ${outcome.message}`;
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
    return { kind: 'retryable', status: res.status, message: 'Empty response' };
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

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:html?|HTML)?\s*\n([\s\S]*?)\n```\s*$/;
  const match = trimmed.match(fence);
  return match ? match[1].trim() : trimmed;
}

function looksLikeEmailHtml(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('<!doctype') && lower.includes('<table') && lower.includes('</html>');
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
          { text: 'Convert this email design into a production-ready HTML email per the system instructions.' },
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

  // Serialized once: it carries the base64 image and is sent up to 3 times.
  const providerBody = JSON.stringify(payload);

  let outcome: ProviderOutcome | null = null;
  let attempts = 0;
  for (let i = 0; i < PRIMARY_MAX_ATTEMPTS; i++) {
    const windowMs = Math.min(PRIMARY_TIMEOUT_MS, remainingMs() - FALLBACK_RESERVE_MS);
    if (windowMs < MIN_PRIMARY_WINDOW_MS) break;
    attempts++;
    const callStartedAt = Date.now();
    outcome = await callProvider(PRIMARY_MODEL, providerBody, apiKey, windowMs, request.signal);
    const quickFailure = Date.now() - callStartedAt < QUICK_FAILURE_MS;
    if (request.signal.aborted) break;
    // 429 is quota: the same model won't recover within this request.
    if (outcome.kind !== 'retryable' || outcome.status === 429 || !quickFailure) break;
    if (i < PRIMARY_MAX_ATTEMPTS - 1) await sleep(RETRY_BACKOFF_MS);
  }

  // The browser left mid-wait: nobody will read an answer, so skip the fallback.
  // Only fires where the runtime propagates disconnects: local dev today. On
  // Vercel request.signal needs `supportsCancellation` (not enabled), so there
  // these checks are inert and the request runs to completion as before.
  if (request.signal.aborted) {
    return jsonResponse({ error: 'Client disconnected.', attempts }, 499);
  }

  if (!outcome || isFailure(outcome)) {
    console.warn(`[generate-email] ${PRIMARY_MODEL} failed (${describeOutcome(outcome)}), using ${FALLBACK_MODEL}`);
    attempts++;
    outcome = await callProvider(FALLBACK_MODEL, providerBody, apiKey, remainingMs(), request.signal);
    // A disconnect aborts the call too; don't log it as a fallback timeout.
    if (request.signal.aborted) {
      return jsonResponse({ error: 'Client disconnected.', attempts }, 499);
    }
    // The client only gets a generic message, so this is the one record of why
    // the fallback failed too (e.g. a retired model id returning 404).
    if (isFailure(outcome)) {
      console.warn(`[generate-email] ${FALLBACK_MODEL} failed too (${describeOutcome(outcome)})`);
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
  // Only a fallback answer can reach here cut short (the primary's went to the
  // fallback). Any stop but STOP is partial output, not a result.
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

  if (!looksLikeEmailHtml(cleaned)) {
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

  return jsonResponse({ html: cleaned, attempts, generation_id: generationId }, 200);
};

export const GET: APIRoute = () =>
  jsonResponse(
    { error: 'Use POST with JSON body { image: base64, mimeType: string }.' },
    405,
  );
