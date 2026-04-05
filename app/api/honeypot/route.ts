import { NextResponse } from "next/server";
import { blockIp } from "@/lib/honeypot";

function getClientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent");
  await blockIp(ip, `Visited honeypot. UA: ${ua}`);
  
  return NextResponse.json({ error: "Access denied" }, { status: 403 });
}
