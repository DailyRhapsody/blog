import type { NextRequest } from "next/server";

/**
 * 取客户端 IP（优先代理链最左侧；与 request-guard 逻辑一致）。
 */
export function getClientIpFromRequest(req: Request | NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const vercel = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel.split(",")[0]?.trim() || vercel;
  return "unknown";
}

export function isProbablyPrivateOrLocalIp(ip: string): boolean {
  if (!ip || ip === "unknown") return true;
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd"))
    return true;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const p = ip.split(".");
    const n = Number(p[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}
