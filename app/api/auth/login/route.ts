import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSessionCookie } from "@/lib/auth";
import { guardApiRequest } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { sleepLoginPenalty } from "@/lib/brute-delay";
import { getClientIpFromRequest } from "@/lib/client-ip";
import { unblockIp } from "@/lib/honeypot";

/** 常量时间字符串比较：两个 string 都先 utf8 编码到等长 buffer 再比较，
 *  长度不同也保持执行一次同等长度的 timingSafeEqual，避免泄露长度信息。 */
function safeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // 用 ab 与 ab 比较，仅为消耗与正常路径相近的 CPU 时间
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const blocked = await guardApiRequest(req, {
    scope: "auth:login",
    limit: 12,
    windowMs: 900_000,
    blockSuspicious: false,
  });
  if (blocked) return blocked;

  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 }
    );
  }
  let body: { password?: string; remember?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body.password !== "string" || !safeStringEqual(body.password, password)) {
    await sleepLoginPenalty();
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  // 登陆成功 → 主动解封本 IP 的黑名单与违规计数，避免之前的误触续期把刚登陆
  // 的管理员又锁在页面外。相当于"登陆即救济"。
  const ip = getClientIpFromRequest(req);
  if (ip && ip !== "unknown") {
    try {
      await unblockIp(ip);
    } catch {
      /* best-effort：Redis 抖动不应阻断登陆 */
    }
  }

  const cookie = createSessionCookie(body.remember === true);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
