import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSessionCookie } from "@/lib/auth";
import { guardApiRequest } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { sleepLoginPenalty } from "@/lib/brute-delay";

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
  const inputBuf = Buffer.from(String(body.password ?? ""));
  const expectedBuf = Buffer.from(password);
  const isMatch =
    inputBuf.length === expectedBuf.length &&
    timingSafeEqual(inputBuf, expectedBuf);
  if (!isMatch) {
    await sleepLoginPenalty();
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const cookie = createSessionCookie(body.remember === true);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
