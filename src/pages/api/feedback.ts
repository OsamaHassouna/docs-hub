import type { APIRoute } from 'astro';
import { getRedis } from '../../lib/kv';

export const prerender = false;

const ALLOWED_RATINGS = new Set(['good', 'bad']);
const MAX_NOTES_LEN = 500;
const TTL_SECONDS = 60 * 60 * 24 * 90;

interface FeedbackBody {
  generation_id?: string;
  rating?: string;
  notes?: string;
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isValidId(id: string): boolean {
  return /^[a-z0-9-]{8,64}$/i.test(id);
}

export const POST: APIRoute = async ({ request }) => {
  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return jsonResponse({ error: 'Body must be valid JSON.' }, 400);
  }

  const { generation_id, rating, notes } = body;

  if (!generation_id || typeof generation_id !== 'string' || !isValidId(generation_id)) {
    return jsonResponse({ error: "Missing or invalid 'generation_id'." }, 400);
  }
  if (!rating || !ALLOWED_RATINGS.has(rating)) {
    return jsonResponse({ error: "'rating' must be 'good' or 'bad'." }, 400);
  }
  if (notes != null && (typeof notes !== 'string' || notes.length > MAX_NOTES_LEN)) {
    return jsonResponse({ error: `'notes' must be a string up to ${MAX_NOTES_LEN} chars.` }, 400);
  }

  const redis = getRedis();
  if (!redis) {
    return jsonResponse({ ok: true, persisted: false, reason: 'KV not configured.' }, 200);
  }

  const date = new Date().toISOString().slice(0, 10);
  const record = {
    generation_id,
    rating,
    notes: notes?.slice(0, MAX_NOTES_LEN) ?? null,
    ts: new Date().toISOString(),
  };

  try {
    await Promise.all([
      redis.set(`feedback:${generation_id}`, JSON.stringify(record), { ex: TTL_SECONDS }),
      redis.incr(`feedback:daily:${date}:${rating}`),
    ]);
  } catch (err) {
    return jsonResponse(
      { ok: false, error: 'KV write failed.', detail: (err as Error).message },
      502,
    );
  }

  return jsonResponse({ ok: true, persisted: true }, 200);
};

export const GET: APIRoute = () =>
  jsonResponse(
    { error: 'Use POST with JSON body { generation_id, rating: "good"|"bad", notes? }.' },
    405,
  );
