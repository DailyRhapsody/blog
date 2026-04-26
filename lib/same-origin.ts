import { NextResponse } from "next/server";
import { getAllowedHostnames } from "@/lib/site-hosts";

/**
 * 对「可能改变状态」的请求做基础 CSRF 防护。
 *
 * 策略（更严，2026-04 修订）：
 *  - 白名单仅取自 NEXT_PUBLIC_SITE_URL / SITE_HOSTNAMES，**绝不读 Host 头**。
 *    旧实现把 req.headers.get("host") 与 x-forwarded-host 也加入白名单，
 *    攻击者只需 `-H "Host: evil.com" -H "Origin: https://evil.com"` 就能伪造同源。
 *  - 写操作必须有 Origin 或 Referer 之一，**两者皆缺直接拒**。旧实现兼容
 *    "两者皆无放行" 在 `meta referrer=no-referrer` 等场景被 CSRF 利用。
 *  - 凡 Origin / Referer 任一不在白名单 → 拒。
 */
export function rejectCrossSiteWrite(req: Request): NextResponse | null {
  const allowed = getAllowedHostnames();

  function hostnameOf(value: string): string | null {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) {
    return NextResponse.json({ error: "缺少同源标识" }, { status: 403 });
  }

  if (origin) {
    const h = hostnameOf(origin);
    if (!h || !allowed.has(h)) {
      return NextResponse.json({ error: "拒绝跨站请求" }, { status: 403 });
    }
  }
  if (referer) {
    const h = hostnameOf(referer);
    if (!h || !allowed.has(h)) {
      return NextResponse.json({ error: "拒绝跨站请求" }, { status: 403 });
    }
  }
  return null;
}
