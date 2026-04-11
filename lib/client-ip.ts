import type { NextRequest } from "next/server";

/**
 * 取客户端真实 IP，**抗 XFF 伪造**版本。
 *
 * 二轮渗透发现：旧实现直接 `xff.split(",")[0]`，攻击者只要加一行
 *   `-H "X-Forwarded-For: 1.1.1.1"` 就能任意伪造 IP，绕过黑名单和按 IP 速率限制。
 *
 * 新策略（按优先级）：
 *  1) Cloudflare 的 `cf-connecting-ip`：CF 自己写入，攻击者无法影响。
 *  2) Vercel 的 `x-vercel-forwarded-for`：Vercel 平台自己写入，可信。
 *  3) `x-real-ip`：通常由可信反代写入。
 *  4) 通用 `x-forwarded-for`：必须从右往左数，跳过 N 个可信代理。
 *     N 由环境变量 `TRUST_PROXY_HOPS` 控制（默认 0 = 紧邻服务器的那一跳就是真实客户端）。
 *
 * 为什么从右往左？XFF 的格式是 `client, proxy1, proxy2, ..., 紧邻代理`，
 * 攻击者只能伪造最左边的部分，最右侧总是可信代理写入的。取右侧才安全。
 */

function pickXffFromRight(xff: string, hops: number): string | null {
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // 跳过最右 hops 个可信代理；剩下最右一个就是真实客户端
  const idx = parts.length - 1 - Math.max(0, hops);
  if (idx < 0) return parts[0]!;
  return parts[idx]!;
}

export function getClientIpFromRequest(req: Request | NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const vercel = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) {
    // Vercel 自己保证最左是真实客户端
    const first = vercel.split(",")[0]?.trim();
    if (first) return first;
  }

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
    const ip = pickXffFromRight(xff, Number.isFinite(hops) ? hops : 0);
    if (ip) return ip;
  }

  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

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
