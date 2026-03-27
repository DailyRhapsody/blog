import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis =
  url && token
    ? new Redis({ url, token })
    : null;

const limiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, "1 m"),
      prefix: "dr:rl",
      analytics: false,
    })
  : null;

export function isUpstashConfigured(): boolean {
  return !!limiter;
}

export async function limitByIp(scope: string, ip: string): Promise<boolean> {
  if (!limiter) return true;
  const { success } = await limiter.limit(`${scope}:${ip}`);
  return success;
}
