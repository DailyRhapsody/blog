/**
 * 站点 hostname 白名单。**故意不读 Host / X-Forwarded-Host 等请求头**，
 * 因为攻击者可以任意 spoof 这些头，让原来的"自家"集合包含 evil.com。
 *
 * 二轮渗透发现：
 *   curl -H "Host: attacker.example.com" -H "Origin: https://attacker.example.com" \
 *        ... /api/gate/issue
 * → 200，因为 expectedHostnames 把请求的 Host 加进了白名单。
 *
 * 现在改用 NEXT_PUBLIC_SITE_URL（必填）+ 可选 SITE_HOSTNAMES 多域名扩展。
 * dev 模式默认追加 localhost / 127.0.0.1。
 */

let cached: Set<string> | null = null;

/**
 * 给一个 hostname 自动派生 www ↔ 裸域双向变体。
 * 仅对顶级域 + 二级域这种结构生效（example.com / sub.example.com / www.example.com），
 * 避免在 localhost / IP / 纯顶级 TLD 上做无意义补齐。
 */
function expandWwwVariants(host: string): string[] {
  const h = host.toLowerCase();
  if (!h || !h.includes(".")) return [h];
  if (/^[\d.:]+$/.test(h)) return [h]; // IP
  if (h.startsWith("www.")) {
    const bare = h.slice(4);
    return bare.includes(".") ? [h, bare] : [h];
  }
  // 裸域或 non-www 子域 → 同时允许 www 前缀版本
  return [h, `www.${h}`];
}

export function getAllowedHostnames(): Set<string> {
  if (cached) return cached;
  const set = new Set<string>();

  const add = (raw: string) => {
    for (const v of expandWwwVariants(raw)) set.add(v);
  };

  const primary = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (primary) {
    try {
      add(new URL(primary).hostname);
    } catch {
      /* ignore malformed env */
    }
  }

  // 逗号分隔的额外域名（多语言镜像 / staging / vanity 域名）
  const extra = process.env.SITE_HOSTNAMES?.trim();
  if (extra) {
    for (const h of extra.split(",")) {
      const t = h.trim();
      if (t) add(t);
    }
  }

  if (process.env.NODE_ENV !== "production") {
    set.add("localhost");
    set.add("127.0.0.1");
    set.add("::1");
  }

  cached = set;
  return set;
}

export function isAllowedHostname(host: string | null | undefined): boolean {
  if (!host) return false;
  return getAllowedHostnames().has(host.toLowerCase());
}
