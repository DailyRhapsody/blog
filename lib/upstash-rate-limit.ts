import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

const redis =
  url && token
    ? new Redis({ url, token })
    : null;

const limiters = new Map<string, Ratelimit>();

function getLimiter(scope: string, limit: number = 60, window: Duration = "1 m") {
  if (!redis) return null;
  const key = `${scope}:${limit}:${window}`;
  if (!limiters.has(key)) {
    limiters.set(key, new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `dr:rl:${scope}`,
      analytics: false,
    }));
  }
  return limiters.get(key)!;
}

export function isUpstashConfigured(): boolean {
  return !!redis;
}

export async function limitByIp(scope: string, ip: string, limit?: number, window?: Duration): Promise<boolean> {
  const l = getLimiter(scope, limit, window);
  if (!l) return true;
  const { success } = await l.limit(ip);
  return success;
}
