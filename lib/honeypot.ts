import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis =
  url && token
    ? new Redis({ url, token })
    : null;

const BLOCK_PREFIX = "dr:blocked:";
const BLOCK_DURATION_S = 60 * 60 * 24; // 封禁 24 小时

export async function blockIp(ip: string, reason: string) {
  if (!redis) return;
  console.warn(`Blocking IP ${ip} for ${reason}`);
  await redis.set(`${BLOCK_PREFIX}${ip}`, {
    ip,
    reason,
    at: new Date().toISOString(),
  }, { ex: BLOCK_DURATION_S });
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  if (!redis) return false;
  const blocked = await redis.get(`${BLOCK_PREFIX}${ip}`);
  return !!blocked;
}
