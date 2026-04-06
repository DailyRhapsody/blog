import { NextResponse } from "next/server";

/**
 * 对「可能改变状态」的请求做基础 CSRF 防护：若携带 Origin / Referer，则必须与当前请求的站点一致。
 * 两者皆无时不拦截（兼容部分合法客户端；主要依赖 HttpOnly 会话与 Cookie 门闸）。
 */
export function rejectCrossSiteWrite(req: Request): NextResponse | null {
  const url = new URL(req.url);
  const expectedHosts = new Set<string>();
  expectedHosts.add(url.hostname);
  const host = req.headers.get("host");
  if (host) expectedHosts.add(host.split(",")[0]!.trim().split(":")[0]!.toLowerCase());
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    expectedHosts.add(forwardedHost.split(",")[0]!.trim().split(":")[0]!.toLowerCase());
  }

  function isAllowedHost(candidateUrl: string): boolean {
    try {
      const h = new URL(candidateUrl).hostname.toLowerCase();
      return expectedHosts.has(h);
    } catch {
      return false;
    }
  }

  const origin = req.headers.get("origin");
  if (origin) {
    if (!isAllowedHost(origin)) {
      return NextResponse.json({ error: "拒绝跨站请求" }, { status: 403 });
    }
    return null;
  }
  const referer = req.headers.get("referer");
  if (referer) {
    if (!isAllowedHost(referer)) {
      return NextResponse.json({ error: "拒绝跨站请求" }, { status: 403 });
    }
  }
  return null;
}
