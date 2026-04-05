import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  mintScrapeGateValue,
  SCRAPE_GATE_COOKIE,
  verifyScrapeGateValue,
} from "@/lib/scrape-gate";
import { isLikelyBotUserAgent, withAntiScrapeHeaders } from "@/lib/request-guard";

import { isIpBlocked } from "@/lib/honeypot";

const ADMIN_COOKIE = "admin_session";

function getClientIp(req: NextRequest) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;
  const ua = req.headers.get("user-agent");
  const ip = getClientIp(req);

  // 0. 黑名单 IP 检测
  if (await isIpBlocked(ip)) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "您的 IP 由于异常请求已被暂时限制访问。" }, { status: 403 })
    );
  }

  // 1. 全局机器人检测（API 路由必须）
  if (pathname.startsWith("/api/") && isLikelyBotUserAgent(ua)) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "请求被拒绝" }, { status: 403 })
    );
  }

  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") {
      if (method === "GET") {
        return withAntiScrapeHeaders(attachScrapeGate(NextResponse.next(), req));
      }
      return withAntiScrapeHeaders(NextResponse.next());
    }

    const cookie = req.cookies.get(ADMIN_COOKIE)?.value;
    if (!cookie || !verifyAdminSession(cookie)) {
      const login = new URL("/admin/login", req.url);
      login.searchParams.set("from", pathname);
      return NextResponse.redirect(login);
    }
    if (method === "GET") {
      return withAntiScrapeHeaders(attachScrapeGate(NextResponse.next(), req));
    }
    return withAntiScrapeHeaders(NextResponse.next());
  }

  if (isProtectedPublicApi(pathname, method)) {
    if (!passPublicDataApi(req)) {
      return withAntiScrapeHeaders(
        NextResponse.json(
          { error: "请先打开网站页面后再访问接口，或检查是否禁用 Cookie。" },
          { status: 403 }
        )
      );
    }
    return withAntiScrapeHeaders(NextResponse.next());
  }

  if (isGateIssuingPage(pathname, method)) {
    return withAntiScrapeHeaders(attachScrapeGate(NextResponse.next(), req));
  }

  return withAntiScrapeHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/diaries",
    "/api/diaries/:path*",
    "/api/gallery",
    "/api/profile",
    "/",
    "/entries",
    "/the-moment",
    "/gallery",
    "/about",
  ],
};
