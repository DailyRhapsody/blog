import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { rejectCrossSiteWrite } from "@/lib/same-origin";

export async function POST(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  const cookie = clearSessionCookie();
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", cookie);
  return res;
}
