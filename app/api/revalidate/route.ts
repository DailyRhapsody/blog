/**
 * On-demand revalidation endpoint.
 *
 * 调用方式（仅 POST）：
 *   curl -X POST -H "Authorization: Bearer $REVALIDATE_SECRET" \
 *        https://www.tengjun.org/api/revalidate
 *
 * 用途：
 * 1. 清空 Upstash 中的 Notion 数据缓存（diaries / moments）
 * 2. 重新验证 Next.js 内置页面缓存
 *
 * 安全要点：
 * - secret 仅从 Authorization 头读取，不放 query string（避免落入 Vercel
 *   access log / proxy log / Referer / 浏览器历史）。
 * - 仅 POST。早先版本 GET 直接代理 POST，结果是任何带 secret 的链接、
 *   <img src=...>、CSRF 都能触发缓存击穿 DoS。
 * - 错误 message 不回显内部信息（避免泄漏 Notion / Upstash 内部错误链）。
 */

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { invalidateCache } from "@/lib/notion";
import { invalidateMomentsCache } from "@/lib/notion-moments";

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function POST(req: NextRequest) {
  const expected = process.env.REVALIDATE_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const provided = extractBearerToken(req);
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await invalidateCache();
    await invalidateMomentsCache();
    revalidatePath("/", "layout");
    return NextResponse.json({ revalidated: true, now: Date.now() });
  } catch (error) {
    // 不回显具体错误信息给客户端（避免泄漏 Notion / Upstash 内部错误链）
    console.warn("[revalidate] failed:", error);
    return NextResponse.json({ error: "Revalidation failed" }, { status: 500 });
  }
}

/** 健康检查端点（不携带 secret 时返回 OK，不触发任何动作）。 */
export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST with Authorization: Bearer <secret>" });
}
