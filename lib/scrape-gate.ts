import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SCRAPE_GATE_COOKIE = "dr_gate";

const MAX_AGE_MS = 48 * 60 * 60 * 1000;

function gateSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET (min 16 chars) is required for scrape gate");
  }
  return s;
}

/** 新签发的原始 Cookie 值（不含属性）。 */
export function mintScrapeGateValue(): string {
  const exp = Date.now() + MAX_AGE_MS;
  const nonce = randomBytes(10).toString("hex");
  const payload = `${exp}.${nonce}`;
  const sig = createHmac("sha256", gateSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyScrapeGateValue(raw: string | undefined): boolean {
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const expStr = parts[0];
  const nonce = parts[1];
  const sig = parts[2];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const payload = `${expStr}.${nonce}`;
  const expected = createHmac("sha256", gateSecret()).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
