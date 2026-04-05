import { NextResponse } from "next/server";
import { recordVisit } from "@/lib/analytics-store";
import { isAdmin } from "@/lib/auth";
import { getClientIpFromRequest } from "@/lib/client-ip";
import { resolveGeoForRequest } from "@/lib/geoip";
import {
  guardApiRequest,
  isLikelyBotUserAgent,
  withAntiScrapeHeaders,
} from "@/lib/request-guard";

function normalizeVisitPath(raw: unknown): { path: string; queryString: string | null } | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t.startsWith("/") || t.length > 2048 || t.includes("\n") || t.includes("\r")) return null;
  const q = t.indexOf("?");
  if (q === -1) return { path: t.slice(0, 512), queryString: null };
  return {
    path: t.slice(0, q).slice(0, 512),
    queryString: t.slice(q + 1).slice(0, 1536) || null,
  };
}

function clip(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return t.length <= max ? t : t.slice(0, max);
}

function numOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n < 1 || n > 65535) return null;
  return n;
}

export async function POST(req: Request) {
  // 管理员自身的浏览不计入统计
  if (await isAdmin()) return new NextResponse(null, { status: 204 });

  const blocked = await guardApiRequest(req, {
    scope: "analytics:collect",
    limit: 240,
    windowMs: 60_000,
    blockSuspicious: false,
    checkOrigin: false,
  });
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return withAntiScrapeHeaders(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const parsed = normalizeVisitPath(body.path);
  if (!parsed) {
    return withAntiScrapeHeaders(NextResponse.json({ error: "Invalid path" }, { status: 400 }));
  }

  const ua = req.headers.get("user-agent");
  const isBot = isLikelyBotUserAgent(ua);

  const ip = getClientIpFromRequest(req);
  const geo = await resolveGeoForRequest(req, ip);

  try {
    await recordVisit({
      ip,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      latitude: geo.latitude,
      longitude: geo.longitude,
      path: parsed.path,
      queryString: parsed.queryString,
      referrer: clip(body.referrer, 2048),
      userAgent: ua ? ua.slice(0, 1024) : null,
      acceptLanguage:
        clip(req.headers.get("accept-language"), 256) || clip(body.language, 256),
      utmSource: clip(body.utmSource, 128),
      utmMedium: clip(body.utmMedium, 128),
      utmCampaign: clip(body.utmCampaign, 128),
      visitorId: clip(body.visitorId, 128),
      isBot,
      screenWidth: numOrNull(body.screenWidth),
      screenHeight: numOrNull(body.screenHeight),
    });
  } catch (e) {
    console.error("[analytics] recordVisit", e);
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Analytics storage unavailable" }, { status: 503 })
    );
  }

  return new NextResponse(null, { status: 204 });
}
