import { NextResponse } from "next/server";

/**
 * 对「可能改变状态」的请求做基础 CSRF 防护：若携带 Origin / Referer，则必须与当前请求的站点一致。
 * 两者皆无时不拦截（兼容部分合法客户端；主要依赖 HttpOnly 会话与 Cookie 门闸）。
 */
export function rejectCrossSiteWrite(req: Request): NextResponse | null {
  const url = new URL(req.url);
  const expected = url.hostname;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).hostname !== expected) {
        return NextResponse.json({ error: "拒绝跨站请求" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "拒绝跨站请求" }, { status: 403 });
    }
    return null;
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).hostname !== expected) {
        return NextResponse.json({ error: "拒绝跨站请求" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "拒绝跨站请求" }, { status: 403 });
    }
  }
  return null;
}
