import type { APIRoute } from 'astro';
import { getRedis, lastNDayKeys } from '../../lib/kv';

export const prerender = false;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const expected = process.env.STATS_TOKEN;
  if (!expected) {
    return jsonResponse(
      { error: 'Server is missing STATS_TOKEN. Set it in Vercel project settings.' },
      503,
    );
  }

  const token = url.searchParams.get('token');
  if (!token || token !== expected) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  const redis = getRedis();
  if (!redis) {
    return jsonResponse(
      { error: 'KV is not configured (missing KV_REST_API_URL / KV_REST_API_TOKEN).' },
      503,
    );
  }

  const requestedDays = Number(url.searchParams.get('days') ?? DEFAULT_DAYS);
  const days = Number.isFinite(requestedDays)
    ? Math.min(Math.max(Math.floor(requestedDays), 1), MAX_DAYS)
    : DEFAULT_DAYS;

  const entries = lastNDayKeys(days);
  let values: (number | string | null)[];
  try {
    values = await redis.mget(...entries.map((e) => e.key));
  } catch (err) {
    return jsonResponse(
      { error: 'KV read failed.', detail: (err as Error).message },
      502,
    );
  }

  const daily = entries.map((e, i) => ({
    date: e.date,
    count: Number(values[i] ?? 0),
  }));
  const total = daily.reduce((sum, d) => sum + d.count, 0);

  return jsonResponse({ days, total, daily }, 200);
};
