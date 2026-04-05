import { NextResponse } from "next/server";
import { limitByIp } from "@/lib/upstash-rate-limit";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const BOT_UA_RE =
  /(bot|spider|crawler|curl|wget|python-requests|scrapy|httpclient|headless|phantom|playwright|puppeteer)/i;

/** 用于统计等场景：标记疑似自动化流量（非拦截用） */
export function isLikelyBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = userAgent ?? "";
  return !ua || BOT_UA_RE.test(ua);
}

function getClientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

function isSuspiciousUserAgent(req: Request) {
  return isLikelyBotUserAgent(req.headers.get("user-agent"));
}

export function withAntiScrapeHeaders(res: NextResponse) {
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

function tooManyRequests(resetAt: number) {
  const now = Date.now();
  return withAntiScrapeHeaders(
    NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(Math.max(1, resetAt - now) / 1000)),
        },
      }
    )
  );
}

export async function guardApiRequest(
  req: Request,
  {
    scope,
    limit,
    windowMs,
    blockSuspiciousUa = true,
  }: {
    scope: string;
    limit: number;
    windowMs: number;
    blockSuspiciousUa?: boolean;
  }
): Promise<NextResponse | null> {
  if (blockSuspiciousUa && isSuspiciousUserAgent(req)) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "请求被拦截" }, { status: 403 })
    );
  }

  const ip = getClientIp(req);
  const allowed = await limitByIp(scope, ip);
  if (!allowed) {
    return tooManyRequests(Date.now() + 60_000);
  }

  const now = Date.now();
  const key = `${scope}:${ip}`;
  const current = buckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count > limit) {
    return tooManyRequests(bucket.resetAt);
  }

  return null;
}
