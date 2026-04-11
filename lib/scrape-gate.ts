import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 防爬「双 cookie + 客户端二次握手」机制：
 *  1) 中间件在 GET 页面时签发 dr_seed（短期、非 HttpOnly，绑定 client IP）。
 *     它本身不能访问受保护接口。
 *  2) 客户端 JS 必须用 fetch() 调用 /api/gate/issue（同源 + Sec-Fetch-Site 强校验
 *     + 计算 PoW），换取真正的 dr_gate（长 TTL、HttpOnly）。
 *  3) 受保护接口只接受 dr_gate。
 *
 * 二轮渗透发现的关键加固：
 *  - seed 现在 HMAC 绑定 client IP bucket：换 IP 就废，杜绝"算一次 PoW 给整个代理池用"。
 *  - issue 接口配合 markNonceUsed() 让同一 seed nonce 只能兑换一次（如果配了 Upstash）。
 */

export const SCRAPE_SEED_COOKIE = "dr_seed";
export const SCRAPE_GATE_COOKIE = "dr_gate";

export const SEED_TTL_MS = 5 * 60 * 1000;
export const GATE_TTL_MS = 48 * 60 * 60 * 1000;

/** PoW 难度：要求 SHA-256(seedNonce + ":" + counter) 的 hex 前 N 位等于 0。
 *  4 ≈ 平均 65 536 次哈希，浏览器 ~100ms；不影响真人体验，但给批量自动化加成本。 */
export const POW_DIFFICULTY = 4;

function gateSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET (min 16 chars) is required for scrape gate");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", gateSecret()).update(payload).digest("hex");
}

/**
 * 把 client IP 折叠成一个 16 字符的 bucket。
 * 用 HMAC 而不是裸 sha256，避免攻击者离线穷举所有 /24 子网映射。
 * "unknown" / 空字符串视为同一桶（dev 直连场景），但 verify 时仍要求一致。
 */
function ipBucket(clientIp: string | null | undefined): string {
  const ip = (clientIp ?? "").trim() || "unknown";
  return createHmac("sha256", gateSecret()).update(`ip:${ip}`).digest("hex").slice(0, 16);
}

/** 3 段 token：用于 dr_gate（不绑 IP，允许真人换 WiFi）。 */
function mintGateToken(ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  const nonce = randomBytes(12).toString("hex");
  const payload = `${exp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function parseAndVerifyGate(raw: string | undefined):
  | { exp: number; nonce: string }
  | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = sign(`${expStr}.${nonce}`);
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { exp, nonce };
}

/** 4 段 token：用于 dr_seed（绑定 client IP）。 */
export function mintSeedValue(clientIp: string): string {
  const exp = Date.now() + SEED_TTL_MS;
  const nonce = randomBytes(12).toString("hex");
  const bucket = ipBucket(clientIp);
  const payload = `${exp}.${nonce}.${bucket}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * 校验 seed cookie。
 *  - exp 未过期
 *  - HMAC 签名正确
 *  - 绑定的 ipBucket 等于当前请求的 ipBucket（关键：换 IP 即废）
 */
export function verifySeedValue(
  raw: string | undefined,
  clientIp: string
): { nonce: string } | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [expStr, nonce, bucket, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = sign(`${expStr}.${nonce}.${bucket}`);
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  // 关键防重放：bucket 必须与当前 IP 匹配
  const currentBucket = ipBucket(clientIp);
  const ba = Buffer.from(bucket, "hex");
  const bb = Buffer.from(currentBucket, "hex");
  if (ba.length !== bb.length) return null;
  if (!timingSafeEqual(ba, bb)) return null;
  return { nonce };
}

export function mintGateValue(): string {
  return mintGateToken(GATE_TTL_MS);
}

export function verifyGateValue(raw: string | undefined): boolean {
  return parseAndVerifyGate(raw) !== null;
}

/** 校验客户端提交的 PoW：sha256(seedNonce + ":" + counter) 必须以 difficulty 个 0 开头。 */
export function checkPow(
  seedNonce: string,
  counter: string,
  difficulty: number = POW_DIFFICULTY
): boolean {
  if (typeof counter !== "string") return false;
  if (counter.length === 0 || counter.length > 32) return false;
  // 限制只允许十进制数字，避免攻击者塞入超长 utf-8
  if (!/^\d+$/.test(counter)) return false;
  const h = createHash("sha256")
    .update(`${seedNonce}:${counter}`)
    .digest("hex");
  const prefix = "0".repeat(difficulty);
  return h.startsWith(prefix);
}
