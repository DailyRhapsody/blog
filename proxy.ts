import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  mintScrapeGateValue,
  SCRAPE_GATE_COOKIE,
  verifyScrapeGateValue,
} from "@/lib/scrape-gate";
import { withAntiScrapeHeaders } from "@/lib/request-guard";

const ADMIN_COOKIE = "admin_session";

function verifyAdminSession(cookieValue: string): boolean {
  const i = cookieValue.lastIndexOf(".");
  if (i === -1) return false;
  try {
    const payloadStr = atob(cookieValue.slice(0, i).replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadStr) as { exp?: number };
    return !!payload.exp && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function passPublicDataApi(req: NextRequest): boolean {
  const admin = req.cookies.get(ADMIN_COOKIE)?.value;
  if (admin && verifyAdminSession(admin)) return true;
  const gate = req.cookies.get(SCRAPE_GATE_COOKIE)?.value;
  return verifyScrapeGateValue(gate);
}

function isProtectedPublicApi(pathname: string, method: string): boolean {
  if (method === "GET" && pathname === "/api/profile") return true;
  if (!pathname.startsWith("/api/diaries")) return false;
  if (method === "GET") return true;
  if (method === "POST") {
    return /\/api\/diaries\/[^/]+\/comments$/.test(pathname);
  }
  return false;
}

function isGateIssuingPage(pathname: string, method: string): boolean {
  if (method !== "GET") return false;
  return (
    pathname === "/" ||
    pathname === "/entries" ||
    pathname === "/the-moment" ||
    pathname === "/about"
  );
}

function attachScrapeGate(res: NextResponse, req: NextRequest): NextResponse {
  const existing = req.cookies.get(SCRAPE_GATE_COOKIE)?.value;
  if (!verifyScrapeGateValue(existing)) {
    res.cookies.set(SCRAPE_GATE_COOKIE, mintScrapeGateValue(), {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 48,
    });
  }
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;

  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") {
      if (method === "GET") {
        return attachScrapeGate(NextResponse.next(), req);
      }
      return NextResponse.next();
    }

    const cookie = req.cookies.get(ADMIN_COOKIE)?.value;
    if (!cookie || !verifyAdminSession(cookie)) {
      const login = new URL("/admin/login", req.url);
      login.searchParams.set("from", pathname);
      return NextResponse.redirect(login);
    }
    if (method === "GET") {
      return attachScrapeGate(NextResponse.next(), req);
    }
    return NextResponse.next();
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
    return NextResponse.next();
  }

  if (isGateIssuingPage(pathname, method)) {
    return attachScrapeGate(NextResponse.next(), req);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/diaries",
    "/api/diaries/:path*",
    "/api/profile",
    "/",
    "/entries",
    "/the-moment",
    "/about",
  ],
};
