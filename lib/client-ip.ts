import type { NextRequest } from "next/server";

/**
 * 取客户端真实 IP，**抗 XFF / 伪造头**版本。
 *
 * ### 信任模型
 *
 * 攻击者发送任意 HTTP header（包括 cf-connecting-ip / x-real-ip / x-forwarded-for）
 * 都能让 server 直接读到。**只有可信代理写入的头才能采纳**。
 * 由环境变量 `IP_TRUSTED_PROXY` 控制信任源：
 *
 *   - `vercel`（默认）：Vercel Edge Network 后部署。读 `x-vercel-forwarded-for`
 *     与 Vercel 保证可信的几个头；忽略攻击者可任意伪造的 cf-connecting-ip / x-real-ip。
 *   - `cloudflare`：Cloudflare 后部署。读 `cf-connecting-ip`。
 *   - `none`：直连场景，仅用 socket / x-real-ip（实际 Next.js 拿不到 socket，所以
 *     退化为 unknown）；适用于 self-host + 不在反代后的开发场景。
 *   - `xff`：通用反向代理（nginx、HAProxy）。读 `x-forwarded-for` 从右往左跳过
 *     `TRUST_PROXY_HOPS` 个可信代理。
 *
 * ### 为什么不"全收"
 *
 * 旧实现按 cf > vercel > xff > x-real-ip 的优先级无条件读取：
 * 攻击者只要发 `Cf-Connecting-Ip: 1.2.3.4` 即可任意伪造 IP，
 * 绕过 IP 黑名单 / 限流，把违规栽赃到无辜 IP（DoS 别人）。
 */

type TrustedProxy = "vercel" | "cloudflare" | "xff" | "none";

function getTrustedProxy(): TrustedProxy {
  const explicit = process.env.IP_TRUSTED_PROXY?.trim().toLowerCase();
  if (explicit === "vercel" || explicit === "cloudflare" || explicit === "xff" || explicit === "none") {
    return explicit;
  }
  // 默认值：Vercel 环境（VERCEL=1）走 vercel；否则 xff（dev / 自托管）。
  // 这样本地 dev 用 X-Forwarded-For 测试不会全部归到 unknown 桶。
  if (process.env.VERCEL === "1") return "vercel";
  return "xff";
}

function pickXffFromRight(xff: string, hops: number): string | null {
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // 跳过最右 hops 个可信代理；剩下最右一个就是真实客户端
  const idx = parts.length - 1 - Math.max(0, hops);
  if (idx < 0) return parts[0]!;
  return parts[idx]!;
}

export function getClientIpFromRequest(req: Request | NextRequest): string {
  const proxy = getTrustedProxy();

  switch (proxy) {
    case "vercel": {
      // Vercel Edge 自己注入 x-vercel-forwarded-for，最左是真实客户端
      const v = req.headers.get("x-vercel-forwarded-for")?.trim();
      if (v) {
        const first = v.split(",")[0]?.trim();
        if (first) return first;
      }
      // Vercel 也会规范化 x-forwarded-for，但攻击者也能写
      // 在 Vercel 模式下若上面没拿到，退到 unknown 比读不可信头更安全
      return "unknown";
    }
    case "cloudflare": {
      const cf = req.headers.get("cf-connecting-ip")?.trim();
      if (cf) return cf;
      return "unknown";
    }
    case "xff": {
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
    case "none":
    default:
      return "unknown";
  }
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
