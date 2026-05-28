import { Redis } from '@upstash/redis';

let redis: Redis | null = null;
let initialized = false;

export function getRedis(): Redis | null {
  if (initialized) return redis;
  initialized = true;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function dateKey(d: Date): string {
  return `daily:${d.toISOString().slice(0, 10)}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function lastNDayKeys(n: number): { key: string; date: string }[] {
  const out: { key: string; date: string }[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ key: `daily:${iso}`, date: iso });
  }
  return out;
}
