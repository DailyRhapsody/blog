import { NextResponse } from "next/server";
import { limitByIp } from "@/lib/upstash-rate-limit";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/** 定期清理过期桶，防止内存无限增长 */
const CLEANUP_INTERVAL = 60_000; // 60s
let lastCleanup = Date.now();
function cleanupExpiredBuckets() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

const BOT_UA_RE =
  /(bot|spider|crawler|curl|wget|python-requests|scrapy|httpclient|headless|phantom|playwright|puppeteer|go-http-client|axios|got|node-fetch|postman|insomnia|rest-client|java|php|ruby|perl|dotnet|csharp)/i;

const SUSPICIOUS_HEADERS = [
  "x-runtime",
  "x-powered-by",
  "x-generator",
];

/** 用于统计等场景：标记疑似自动化流量（非拦截用） */
export function isLikelyBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = userAgent ?? "";
  // 1. 无 User-Agent 的通常是简单爬虫
  if (!ua) return true;
  // 2. 匹配常见爬虫关键字
  if (BOT_UA_RE.test(ua)) return true;
  return false;
}

function getClientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

function isSuspiciousRequest(req: Request) {
  const ua = req.headers.get("user-agent");
  if (isLikelyBotUserAgent(ua)) return true;

  // 3. 检查异常请求头
  for (const h of SUSPICIOUS_HEADERS) {
    if (req.headers.has(h)) return true;
  }

  // 4. 检查是否为 headless (一些无头浏览器会设置特定的 Header)
  if (req.headers.has("x-puppeteer-version") || req.headers.has("x-playwright-version")) {
    return true;
  }

  // 5. 现代浏览器通常会发送 Sec-CH-UA
  // 如果 User-Agent 看起来像 Chrome/Edge/Safari 但没有 Sec-CH-UA，可能是伪装的爬虫
  const isChrome = ua?.includes("Chrome") || ua?.includes("Safari");
  if (isChrome && !req.headers.has("sec-ch-ua")) {
    // 允许部分旧浏览器或非主流，但这是一个可疑信号
    // 这里先不做强力拦截，仅作为 suspicious 判定的一部分
    // return true; 
  }

  return false;
}

/** 校验 Origin 和 Referer，防止跨站抓取。 */
export function checkOriginOrReferer(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = (req.headers.get("host") || "").split(":")[0]!.toLowerCase();

  function hostMatches(url: string): boolean {
    try {
      return new URL(url).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  }

  if (origin && !hostMatches(origin)) {
    return false;
  }
  if (referer && !hostMatches(referer)) {
    return false;
  }
  // 两者皆无时放行（兼容部分合法客户端）
  return true;
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
    blockSuspicious = true,
    checkOrigin = true,
  }: {
    scope: string;
    limit: number;
    windowMs: number;
    blockSuspicious?: boolean;
    checkOrigin?: boolean;
  }
): Promise<NextResponse | null> {
  if (blockSuspicious && isSuspiciousRequest(req)) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "请求由于可疑行为被拦截" }, { status: 403 })
    );
  }

  if (checkOrigin && !checkOriginOrReferer(req)) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "禁止跨域抓取" }, { status: 403 })
    );
  }

  const ip = getClientIp(req);
  const allowed = await limitByIp(scope, ip, limit, `${windowMs} ms`);
  if (!allowed) {
    return tooManyRequests(Date.now() + 60_000);
  }

  cleanupExpiredBuckets();

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
