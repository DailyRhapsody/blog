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

export function getAllowedHostnames(): Set<string> {
  if (cached) return cached;
  const set = new Set<string>();

  const primary = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (primary) {
    try {
      set.add(new URL(primary).hostname.toLowerCase());
    } catch {
      /* ignore malformed env */
    }
  }

  // 逗号分隔的额外域名（多语言镜像 / staging / vanity 域名）
  const extra = process.env.SITE_HOSTNAMES?.trim();
  if (extra) {
    for (const h of extra.split(",")) {
      const t = h.trim().toLowerCase();
      if (t) set.add(t);
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
