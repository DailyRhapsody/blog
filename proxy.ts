import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  mintSeedValue,
  SCRAPE_GATE_COOKIE,
  SCRAPE_SEED_COOKIE,
  SEED_TTL_MS,
  verifyGateValue,
  verifySeedValue,
} from "@/lib/scrape-gate";
import { isLikelyBotUserAgent, withAntiScrapeHeaders } from "@/lib/request-guard";
import { isIpBlocked, recordViolation } from "@/lib/honeypot";
import { limitByIp } from "@/lib/upstash-rate-limit";
import { getClientIpFromRequest } from "@/lib/client-ip";

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

/**
 * 受保护 public API 的访问凭证：
 *  - admin_session 直接放行（管理员）。
 *  - dr_gate（HttpOnly，由 /api/gate/issue 经 PoW + 同源 + Sec-Fetch 校验签发）。
 *  - 不再接受 dr_seed 直接通过——这是关键改动，让"GET 一次首页就拿走 cookie"的爬虫
 *    彻底失效。
 */
function passPublicDataApi(req: NextRequest): boolean {
  const admin = req.cookies.get(ADMIN_COOKIE)?.value;
  if (admin && verifyAdminSession(admin)) return true;
  const gate = req.cookies.get(SCRAPE_GATE_COOKIE)?.value;
  return verifyGateValue(gate);
}

function isProtectedPublicApi(pathname: string, method: string): boolean {
  if (method === "GET" && pathname === "/api/profile") return true;
  if (pathname === "/api/gallery" && method === "GET") return true;
  if (method === "GET" && pathname.startsWith("/api/moments")) return true;
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

/**
 * 给普通页面 GET 签发短期 dr_seed（非 HttpOnly，5 分钟）。
 * 客户端 JS 读取这个 seed → 计算 PoW → POST /api/gate/issue 兑换 dr_gate。
 *
 * 关键：seed 本身不能访问受保护接口，必须经过二次握手。这样：
 *  - 服务器侧 fetch / curl 默认不带 Sec-Fetch-* 头，无法通过 issue 校验。
 *  - 即使脚本伪造 Sec-Fetch-* 头，还要在本机跑一次 65k 次 SHA-256 PoW。
 *
 * 进一步：要求页面请求带 Sec-Fetch-Dest: document（浏览器导航固有头）。缺失时不签发，
 * 让 curl 类客户端连 seed 都拿不到。
 */
function attachSeed(res: NextResponse, req: NextRequest, clientIp: string): NextResponse {
  // Sec-Fetch-Dest=document + Sec-Fetch-Mode=navigate 是浏览器导航的强指纹
  // 服务器侧 fetch / curl 默认不会发；缺失即不签发 seed
  const sfd = req.headers.get("sec-fetch-dest");
  const sfm = req.headers.get("sec-fetch-mode");
  // 兼容直接打开（书签、新标签）：sfd=document, sfm=navigate, sfs=none
  if (sfd && sfd !== "document") return res;
  if (sfm && sfm !== "navigate") return res;

  const existing = req.cookies.get(SCRAPE_SEED_COOKIE)?.value;
  // 已有 seed 且仍然绑当前 IP，直接复用；换 IP 则强制刷新
  if (verifySeedValue(existing, clientIp)) return res;

  res.cookies.set(SCRAPE_SEED_COOKIE, mintSeedValue(clientIp), {
    httpOnly: false, // 客户端 JS 必须能读到 nonce 来做 PoW
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SEED_TTL_MS / 1000),
  });
  return res;
}

function tooManyResponse(retryAfterS: number) {
  return withAntiScrapeHeaders(
    NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, retryAfterS)) },
      }
    )
  );
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;
  const ua = req.headers.get("user-agent");
  const ip = getClientIpFromRequest(req);

  // 管理员会话直接放行（避免自己被全局限流误伤）
  const adminCookie = req.cookies.get(ADMIN_COOKIE)?.value;
  const isAdminReq = !!(adminCookie && verifyAdminSession(adminCookie));

  // 0. 黑名单 IP 检测
  // /admin/login（GET/POST）与 /api/admin/unblock-ip 始终绕过 IP 黑名单，
  // 否则管理员一旦被误封就无法从同一 IP 登陆自救（鸡生蛋）。爆破风险依然由
  // 全局 burst/sustained 速率限制兜底，不会放大攻击面。
  const isAdminRescue =
    pathname === "/admin/login" || pathname === "/api/admin/unblock-ip";
  if (!isAdminReq && !isAdminRescue && (await isIpBlocked(ip))) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "您的 IP 由于异常请求已被暂时限制访问。" }, { status: 403 })
    );
  }

  // 1. 全局机器人检测（API 路由必须）
  if (pathname.startsWith("/api/") && isLikelyBotUserAgent(ua)) {
    if (!isAdminReq) {
      await recordViolation(ip, `bot UA on ${pathname}`);
    }
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "请求被拒绝" }, { status: 403 })
    );
  }

  // 2. 全局 per-IP 限流（覆盖所有匹配的页面 + API）
  if (!isAdminReq && ip && ip !== "unknown") {
    const burstOk = await limitByIp("global:burst", ip, 40, "10 s");
    if (!burstOk) {
      await recordViolation(ip, `burst on ${pathname}`);
      return tooManyResponse(10);
    }
    const sustainedOk = await limitByIp("global:sustained", ip, 150, "1 m");
    if (!sustainedOk) {
      await recordViolation(ip, `sustained on ${pathname}`);
      return tooManyResponse(60);
    }
  }

  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") {
      // 登录页也签发 seed，让 admin 登陆时同样支持 client gate
      if (method === "GET") {
        return withAntiScrapeHeaders(attachSeed(NextResponse.next(), req, ip));
      }
      return withAntiScrapeHeaders(NextResponse.next());
    }

    if (!isAdminReq) {
      const login = new URL("/admin/login", req.url);
      login.searchParams.set("from", pathname);
      return NextResponse.redirect(login);
    }
    // 管理员页面：admin_session 已经能通过 passPublicDataApi，无需 dr_gate
    return withAntiScrapeHeaders(NextResponse.next());
  }

  if (isProtectedPublicApi(pathname, method)) {
    if (!passPublicDataApi(req)) {
      // 合法浏览器在 GateClient 完成 PoW 握手前会带着 dr_seed 先发出若干并发请求，
      // 此时尚未拥有 dr_gate 是预期状态 → 返回 403 但不计违规（否则首屏 3 个并发
      // 受保护请求就会瞬间逼近阈值，刷新一次直接把真人封掉）。
      // 完全没有 dr_seed 的请求才是典型的脚本/curl 直连抓取，仍需记违规。
      const seedRaw = req.cookies.get(SCRAPE_SEED_COOKIE)?.value;
      const hasLegitSeed = verifySeedValue(seedRaw, ip);
      if (!hasLegitSeed) {
        await recordViolation(ip, `no gate cookie on ${pathname}`);
      }
      return withAntiScrapeHeaders(
        NextResponse.json(
          {
            error:
              "请先打开网站页面，等待安全校验完成后再访问接口（或检查是否禁用 Cookie / JavaScript）。",
          },
          { status: 403 }
        )
      );
    }
    return withAntiScrapeHeaders(NextResponse.next());
  }

  if (isGateIssuingPage(pathname, method)) {
    return withAntiScrapeHeaders(attachSeed(NextResponse.next(), req, ip));
  }

  return withAntiScrapeHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/diaries",
    "/api/diaries/:path*",
    "/api/gallery",
    "/api/moments",
    "/api/moments/:path*",
    "/api/profile",
    "/api/analytics/collect",
    "/api/gate/:path*",
    "/",
    "/entries",
    "/the-moment",
    "/about",
  ],
};
