import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { getRedis, todayKey } from '../../lib/kv';
import { SYSTEM_PROMPT } from '../../lib/gemini-prompt';

export const prerender = false;

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [600, 1400];
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

const DAILY_LIMIT_PER_IP = Number(process.env.GENERATE_DAILY_LIMIT_PER_IP ?? '10');
const DAILY_LIMIT_GLOBAL = Number(process.env.GENERATE_DAILY_LIMIT_GLOBAL ?? '200');
const QUOTA_TTL_SECONDS = 60 * 60 * 26;

function clientIpHash(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for') ?? '';
  const real = request.headers.get('x-real-ip') ?? '';
  const vercel = request.headers.get('x-vercel-forwarded-for') ?? '';
  const raw = (fwd.split(',')[0] || real || vercel || 'unknown').trim();
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

async function callProvider(payload: unknown, apiKey: string): Promise<ProviderOutcome> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { kind: 'retryable', status: 0, message: (err as Error).message || 'Network error' };
  }

  let data: GeminiResponse;
  try {
    data = (await res.json()) as GeminiResponse;
  } catch {
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
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
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
  const redis = getRedis();
  if (redis) {
    const date = todayDate();
    const ipHash = clientIpHash(request);
    const ipKey = `quota:ip:${ipHash}:${date}`;
    const globalKey = `quota:global:${date}`;

    try {
      const [ipUsedRaw, globalUsedRaw] = await Promise.all([
        redis.get(ipKey),
        redis.get(globalKey),
      ]);
      const ipUsed = Number(ipUsedRaw ?? 0);
      const globalUsed = Number(globalUsedRaw ?? 0);

      if (ipUsed >= DAILY_LIMIT_PER_IP) {
        return jsonResponse(
          {
            error: `Daily limit reached for this client (${DAILY_LIMIT_PER_IP}/day). Try again tomorrow.`,
            limit: DAILY_LIMIT_PER_IP,
            scope: 'per-ip',
          },
          429,
        );
      }
      if (globalUsed >= DAILY_LIMIT_GLOBAL) {
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
      /* if KV read fails, fail open — never block on infrastructure errors */
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
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 32768,
      responseMimeType: 'text/plain',
    },
  };

  let outcome: ProviderOutcome | null = null;
  let attempts = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts = i + 1;
    outcome = await callProvider(payload, apiKey);
    if (outcome.kind !== 'retryable') break;
    if (i < MAX_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_MS[i] ?? 1400);
    }
  }

  if (!outcome) {
    return jsonResponse({ error: 'Unknown error after retries.' }, 502);
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
  if (outcome.finishReason === 'MAX_TOKENS') {
    return jsonResponse(
      { error: 'Response was truncated. Try a simpler image.', raw: cleaned.slice(0, 500), attempts },
      422,
    );
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

  if (redis) {
    const date = todayDate();
    const ipHash = clientIpHash(request);
    Promise.all([
      redis.incr(todayKey()),
      redis.incr(`quota:ip:${ipHash}:${date}`).then(() =>
        redis.expire(`quota:ip:${ipHash}:${date}`, QUOTA_TTL_SECONDS),
      ),
      redis.incr(`quota:global:${date}`).then(() =>
        redis.expire(`quota:global:${date}`, QUOTA_TTL_SECONDS),
      ),
    ]).catch(() => { /* counter writes are best-effort */ });
  }

  return jsonResponse({ html: cleaned, attempts, generation_id: generationId }, 200);
};

export const GET: APIRoute = () =>
  jsonResponse(
    { error: 'Use POST with JSON body { image: base64, mimeType: string }.' },
    405,
  );
