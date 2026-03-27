import { NextResponse } from "next/server";
import { createSessionCookie } from "@/lib/auth";
import { guardApiRequest } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { sleepLoginPenalty } from "@/lib/brute-delay";

export async function POST(req: Request) {
  const blocked = await guardApiRequest(req, {
    scope: "auth:login",
    limit: 12,
    windowMs: 900_000,
    blockSuspiciousUa: false,
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
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (body.password !== password) {
    await sleepLoginPenalty();
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const cookie = createSessionCookie();
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
