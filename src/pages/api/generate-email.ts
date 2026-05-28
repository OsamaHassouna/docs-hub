import type { APIRoute } from 'astro';
import { getRedis, todayKey } from '../../lib/kv';

export const prerender = false;

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [600, 1400];
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

const SYSTEM_PROMPT = `You are an HTML email engineer. Convert the uploaded design image into a production-ready HTML email that renders correctly across Gmail, Outlook (2007+ on Windows), Apple Mail, and Yahoo.

ABSOLUTE RULES (read first)
- These rules are the COMPLETE specification. Do NOT apply general web-development or email-development knowledge from your training. Use ONLY the patterns described in this prompt.
- If a specific pattern is not covered here, fall back to the simplest valid table: <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">.
- Reproduce ONLY content visible in the image. Do NOT invent footers, sender addresses, unsubscribe links, social rows, copyright lines, or any boilerplate.
- Preserve EVERY visual container from the source: background colors, panels, borders, cards. If a section has a distinct background color, recreate it.

MOBILE-RESPONSIVE LAYOUT (CRITICAL — must NOT scroll horizontally at 320px viewport)
This is the most common failure mode. Follow this exact pattern.

The structure is THREE table levels:

1. OUTER wrapper (full viewport width, holds background and centers content):
   <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#F5F5F5;">
     <tr><td align="center" style="padding:20px 10px;">

2. CONTAINER (600px desktop, shrinks on mobile):
   <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#FFFFFF;">
     <tr><td>

3. INNER content tables (NEVER use width="600" here — use width="100%"):
   <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
     <tr><td>...</td></tr>
   </table>

REPEAT: every nested/inner table uses width="100%". Only the single CONTAINER table uses width="600" + max-width:600px;width:100%. Hardcoding width="600" on inner tables causes horizontal scroll on mobile. This is the #1 thing not to get wrong.

Images: always include style="display:block;max-width:100%;height:auto;" so they shrink with their container.
Cells: never hardcode padding > 30px on left or right of a cell (mobile would overflow).
Text containers: no min-width values.

Add this <style> block in <head> for mobile column stacking:
<style>
  @media only screen and (max-width: 600px) {
    .stack { width: 100% !important; display: block !important; }
    .stack-padding { padding: 10px !important; }
    .center-mobile { text-align: center !important; }
  }
</style>

For any two-column row that should stack on mobile, add class="stack" to each <td> column.

IMAGES (use placeholders, no external URLs)
- For EVERY image in the design, use the URL pattern: https://placehold.co/{W}x{H}/E0E0E0/E0E0E0 (solid color block, no text label).
- {W} and {H} = the pixel width and height visible in the source.
- NEVER use an external host (no example.com, no real CDN URLs, no reproduction attempts).
- Always include alt="[short description]" based on what the image appears to depict.
- Always include width="{W}" height="{H}" attributes matching the URL dimensions.
- Always include style="display:block;max-width:100%;height:auto;border:0;-ms-interpolation-mode:bicubic;" on every <img>.
- For small icons (<= 32px), still use the same pattern — solid color block, no text label.

CONTENT FIDELITY
- Reproduce ONLY content that is visible in the image.
- Preserve background colors and panel containers — if the source has a light-blue FAQ section with a colored background panel, recreate that panel with <td bgcolor="#XXX" style="background-color:#XXX;padding:..."> wrapping the content.
- Do NOT add a footer with sender address, unsubscribe link, social media row, "this email was sent from..." disclaimer, or copyright line UNLESS that exact content is visibly present in the source.
- If the source has no footer, do NOT generate one. End the email where the source ends.
- Do not invent brand names, taglines, addresses, or recipient data.
- For text links visible in the source, use href="#" unless an explicit URL is shown.

DOCTYPE & HEAD
- Start with: <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
- <html> includes xmlns and xmlns:v / xmlns:o for VML.
- Required <head> meta: charset=UTF-8, viewport width=device-width initial-scale=1.0, x-apple-disable-message-reformatting, color-scheme light dark, supported-color-schemes light dark.
- <title> matches the email subject implied by the design.

TEXT & COMPONENTS
- Text styling inline: font-family stack, font-size (px), line-height, color, mso-line-height-rule:exactly.
- Buttons: bulletproof VML pattern (MSO conditional <v:roundrect> wrapper + <a> fallback with table-cell padding). No CSS-only buttons.
- Spacers: empty <tr><td height="Npx" style="height:Npx;font-size:1px;line-height:1px;">&nbsp;</td></tr>.
- Background images: VML <v:rect>+<v:fill> for Outlook, CSS background-image for others, using the same placehold.co URL.

COMPATIBILITY
- Outlook: any rounded corner, gradient, or background image needs a VML fallback wrapped in <!--[if mso | IE]>...<![endif]-->.
- RTL: if the source is right-to-left (Arabic, Hebrew), set dir="rtl" on <html>, <body>, and every table. Mirror padding direction.
- Dark mode: include the color-scheme meta. Use [data-ogsc] / [data-ogsb] selectors only if dark-specific colors are needed.

PRODUCTION
- Total HTML under 102KB (Gmail clip).
- All styling inline. <style> block ONLY in <head> for the responsive @media block above.

OUTPUT
- Return ONLY the raw HTML document. No markdown fences, no commentary.
- If the image is not an email design (random photo, code screenshot, etc.), return EXACTLY: {"error":"This does not appear to be an email design. Upload a screenshot of an email."}`;

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

  const redis = getRedis();
  if (redis) {
    redis.incr(todayKey()).catch(() => { /* counter is best-effort */ });
  }

  return jsonResponse({ html: cleaned, attempts }, 200);
};

export const GET: APIRoute = () =>
  jsonResponse(
    { error: 'Use POST with JSON body { image: base64, mimeType: string }.' },
    405,
  );
