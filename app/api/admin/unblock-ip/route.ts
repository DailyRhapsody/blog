import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { getClientIpFromRequest } from "@/lib/client-ip";
import { unblockIp } from "@/lib/honeypot";

/**
 * 管理员手动解封 IP。
 *
 * - 不传 body：解封当前请求来源 IP（管理员自救：登陆后台 → 点一下就恢复访问）。
 * - body.ip：解封指定 IP（给真人用户做客服用）。
 */
export async function POST(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;

  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let targetIp = getClientIpFromRequest(req);
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const body = JSON.parse(raw) as { ip?: unknown };
      if (typeof body.ip === "string" && body.ip.trim()) {
        targetIp = body.ip.trim();
      }
    }
  } catch {
    // 允许空 body
  }

  if (!targetIp || targetIp === "unknown") {
    return NextResponse.json({ error: "无法识别目标 IP" }, { status: 400 });
  }

  const { removed } = await unblockIp(targetIp);
  return NextResponse.json({ ok: true, ip: targetIp, removed });
}
