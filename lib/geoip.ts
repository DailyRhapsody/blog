import type { NextRequest } from "next/server";
import { isProbablyPrivateOrLocalIp } from "@/lib/client-ip";

export type GeoHints = {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Vercel 注入的地理头（部署在 Vercel 时无需外呼 GeoIP）。
 */
export function geoFromVercelHeaders(req: Request | NextRequest): GeoHints {
  const country = req.headers.get("x-vercel-ip-country")?.trim() || null;
  const region = req.headers.get("x-vercel-ip-country-region")?.trim() || null;
  const city = req.headers.get("x-vercel-ip-city")?.trim() || null;
  const latS = req.headers.get("x-vercel-ip-latitude")?.trim();
  const lonS = req.headers.get("x-vercel-ip-longitude")?.trim();
  const latitude = latS != null && latS !== "" ? Number(latS) : null;
  const longitude = lonS != null && lonS !== "" ? Number(lonS) : null;
  return {
    country,
    region,
    city,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

/**
 * 非 Vercel 等环境：通过 ipwho.is 补全（HTTPS、无需 key；内网 IP 跳过）。
 */
export async function geoFromIpLookup(ip: string): Promise<GeoHints> {
  const empty: GeoHints = {
    country: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null,
  };
  if (isProbablyPrivateOrLocalIp(ip)) return empty;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      success?: boolean;
      country?: string;
      region?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
    };
    if (data.success === false) return empty;
    return {
      country: typeof data.country === "string" ? data.country : null,
      region: typeof data.region === "string" ? data.region : null,
      city: typeof data.city === "string" ? data.city : null,
      latitude: typeof data.latitude === "number" && Number.isFinite(data.latitude) ? data.latitude : null,
      longitude: typeof data.longitude === "number" && Number.isFinite(data.longitude) ? data.longitude : null,
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 合并 Vercel 头与按需外呼；若头里已有国家则不再请求第三方。
 */
export async function resolveGeoForRequest(req: Request | NextRequest, ip: string): Promise<GeoHints> {
  const fromHeaders = geoFromVercelHeaders(req);
  if (fromHeaders.country) return fromHeaders;
  return geoFromIpLookup(ip);
}
