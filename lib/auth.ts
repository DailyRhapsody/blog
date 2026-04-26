import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "admin_session";
/** 未勾选「记住密码」时的会话时长 */
const MAX_AGE_DEFAULT = 60 * 60 * 24; // 1 day
/** 勾选后：延长登录，避免关闭标签页后很快失效 */
const MAX_AGE_REMEMBER = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("Set AUTH_SECRET (min 16 chars) in .env");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/** 生产环境（HTTPS）下追加 Secure 标记，防止 cookie 在 HTTP 链路被嗅探。 */
function secureFlag(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

/**
 * 纯函数版的 admin cookie 校验：HMAC 验签 + exp 检查。
 * 不依赖 next/headers cookies()，可被 Edge middleware 直接复用。
 *
 * 关键：必须 timingSafeEqual 验签后再看 exp，否则攻击者只用伪造 base64 payload
 * 就能让 middleware 把它当 admin（绕过 IP 黑名单 / 限流 / dr_gate）。
 */
export function verifyAdminCookieValue(raw: string | undefined): boolean {
  if (!raw) return false;
  const i = raw.lastIndexOf(".");
  if (i === -1) return false;
  const payloadB64 = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  let payloadStr: string;
  try {
    payloadStr = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return false;
  }
  let payload: { admin?: boolean; exp?: number };
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return false;
  }
  // 先验签再看 exp，避免 unauth payload 通过 exp 短路
  let sigOk = false;
  try {
    const expected = sign(payloadStr);
    sigOk = timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
  if (!sigOk) return false;
  if (!payload.admin || !payload.exp || payload.exp < Date.now()) return false;
  return true;
}

export function createSessionCookie(remember?: boolean): string {
  const maxAge = remember ? MAX_AGE_REMEMBER : MAX_AGE_DEFAULT;
  const payload = JSON.stringify({
    admin: true,
    exp: Date.now() + maxAge * 1000,
  });
  const sig = sign(payload);
  const value = Buffer.from(payload).toString("base64url") + "." + sig;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag()}`;
}

export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAdminCookieValue(cookieStore.get(COOKIE_NAME)?.value);
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}
