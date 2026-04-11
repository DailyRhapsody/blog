import { NextResponse } from "next/server";
import { limitByIp } from "@/lib/upstash-rate-limit";
import { recordViolation } from "@/lib/honeypot";
import { getClientIpFromRequest } from "@/lib/client-ip";
import { getAllowedHostnames } from "@/lib/site-hosts";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

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

function urlHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 校验 Origin / Referer 与本站 host 一致，防止跨站抓取与 CSRF 假冒来源。
 * - 必须用精确 hostname 比较（避免 evil-host.com 子串绕过 host.com）。
 * - 至少要有一个（Origin 或 Referer）存在且同源；两者都没有视为可疑。
 * - 白名单只来自 NEXT_PUBLIC_SITE_URL / SITE_HOSTNAMES 环境变量，**不读 Host 头**，
 *   否则攻击者只要 `-H "Host: evil.com" -H "Origin: https://evil.com"` 就能伪造同源。
 */
export function checkOriginOrReferer(req: Request): boolean {
  const allowed = getAllowedHostnames();
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  if (!origin && !referer) return false;

  if (origin) {
    const h = urlHostname(origin);
    if (!h || !allowed.has(h)) return false;
  }
  if (referer) {
    const h = urlHostname(referer);
    if (!h || !allowed.has(h)) return false;
  }
  return true;
}

/**
 * 校验 Sec-Fetch-Site 是否同源。
 * 现代浏览器（Chrome 76+、Firefox 90+、Safari 16+）发起 fetch/XHR/sendBeacon
 * 时会自动带这个头：
 *   - same-origin：站内 fetch（正常情况）
 *   - same-site / cross-site / none：跨站或直接导航
 * 服务器侧 fetch / curl / requests 默认不会发送，所以缺失即视作可疑。
 *
 * 该校验仅对 API 调用生效；页面导航 (Sec-Fetch-Dest=document) 走的是 attachSeed
 * 路径，不经过这里。
 */
export function checkSecFetchSiteSameOrigin(req: Request): boolean {
  const sfs = req.headers.get("sec-fetch-site");
  if (!sfs) return false;
  return sfs === "same-origin";
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
    checkSecFetch = true,
    skipViolationRecord = false,
  }: {
    scope: string;
    limit: number;
    windowMs: number;
    blockSuspicious?: boolean;
    checkOrigin?: boolean;
    /** 是否要求 Sec-Fetch-Site=same-origin。默认开启；analytics/sendBeacon 等需要时可关闭。 */
    checkSecFetch?: boolean;
    /**
     * 失败时不记违规计数。用于 /api/auth/login 这类"救济"入口：
     * 即使在自家 IP 被封的情况下也得让管理员能试错几次，不能让失败的登陆
     * 尝试把自己的 IP 推得更深。配合 blockSuspicious=false 使用。
     */
    skipViolationRecord?: boolean;
  }
): Promise<NextResponse | null> {
  const ip = getClientIpFromRequest(req);
  const violate = async (reason: string) => {
    if (!skipViolationRecord) await recordViolation(ip, reason);
  };

  if (blockSuspicious && isSuspiciousRequest(req)) {
    await violate(`suspicious req scope=${scope}`);
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "请求由于可疑行为被拦截" }, { status: 403 })
    );
  }

  if (checkOrigin && !checkOriginOrReferer(req)) {
    await violate(`bad origin scope=${scope}`);
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "禁止跨域抓取" }, { status: 403 })
    );
  }

  if (checkSecFetch && !checkSecFetchSiteSameOrigin(req)) {
    await violate(`bad sec-fetch scope=${scope}`);
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "请求来源异常" }, { status: 403 })
    );
  }

  const allowed = await limitByIp(scope, ip, limit, `${windowMs} ms`);
  if (!allowed) {
    await violate(`rate limit scope=${scope}`);
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
    await violate(`local bucket scope=${scope}`);
    return tooManyRequests(bucket.resetAt);
  }

  return null;
}
