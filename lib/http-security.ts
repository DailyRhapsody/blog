/** 全站 HTTP 安全响应头（由 next.config 与需要时下发给 API）。 */
export const httpSecurityHeaders: { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
];

export function hstsHeader(): { key: string; value: string } | null {
  if (process.env.NODE_ENV !== "production") return null;
  return {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  };
}

export function allHttpSecurityHeaders(): { key: string; value: string }[] {
  const hsts = hstsHeader();
  return hsts ? [...httpSecurityHeaders, hsts] : [...httpSecurityHeaders];
}
