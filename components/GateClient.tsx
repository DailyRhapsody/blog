"use client";

import { useEffect } from "react";

const SEED_COOKIE = "dr_seed";
const GATE_COOKIE_HINT_KEY = "dr_gate_done"; // 仅 sessionStorage 提示，不当作凭据

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)")
  );
  return m ? decodeURIComponent(m[1]) : null;
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}

/**
 * 计算 PoW：找一个 counter（十进制字符串），使
 *   sha256(seedNonce + ":" + counter)
 * 的 hex 前 difficulty 位都是 0。
 */
async function solvePow(seedNonce: string, difficulty: number): Promise<string> {
  const prefix = "0".repeat(difficulty);
  let i = 0;
  // 设上限避免极端情况死循环（4 位 0 平均 65 536 次，给 50 万足够安全）
  while (i < 500000) {
    const counter = String(i);
    const h = await sha256Hex(seedNonce + ":" + counter);
    if (h.startsWith(prefix)) return counter;
    i++;
  }
  throw new Error("PoW timeout");
}

/**
 * 客户端二次握手：
 *  1) 中间件已通过 GET 页面签发 dr_seed（非 HttpOnly，5 分钟）。
 *  2) 这里读取 dr_seed → 解析 nonce → 计算 PoW → POST /api/gate/issue。
 *  3) 服务端校验 PoW + Sec-Fetch-Site 等指纹，签发 HttpOnly 的 dr_gate（48 小时）。
 *
 * 之后受保护接口（diaries/moments/profile）才会放行。
 *
 * 该过程对真人无感（~100ms），但对脚本爬虫意味着：
 *  - 必须执行 JavaScript 才能拿到 nonce；
 *  - 必须自己跑 SHA-256 PoW（curl 一行做不到）；
 *  - 必须伪造 Sec-Fetch-Site / Mode / Dest 一整套头；
 *  - 失败 N 次直接进 honeypot 黑名单。
 */
async function performHandshake(): Promise<void> {
  if (typeof window === "undefined") return;
  // 已经做过 → 直接返回
  if (sessionStorage.getItem(GATE_COOKIE_HINT_KEY) === "1") return;

  const seed = readCookie(SEED_COOKIE);
  if (!seed) return; // 中间件没签发（可能不是 gate-issuing page）
  const parts = seed.split(".");
  // seed 格式是 4 段：exp.nonce.ipBucket.sig
  if (parts.length !== 4) return;
  const nonce = parts[1];
  if (!nonce) return;

  // 拉取当前难度（也可硬编码 4，二者一致）
  let difficulty = 4;
  try {
    const r = await fetch("/api/gate/issue", { method: "GET", credentials: "same-origin" });
    if (r.ok) {
      const j = (await r.json()) as { difficulty?: number };
      if (typeof j.difficulty === "number" && j.difficulty > 0 && j.difficulty < 8) {
        difficulty = j.difficulty;
      }
    }
  } catch {
    /* 用默认 difficulty */
  }

  let counter: string;
  try {
    counter = await solvePow(nonce, difficulty);
  } catch {
    return;
  }

  try {
    const res = await fetch("/api/gate/issue", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counter }),
    });
    if (res.ok) {
      sessionStorage.setItem(GATE_COOKIE_HINT_KEY, "1");
      // 通知页面重新获取数据（如果某些组件早于握手完成就发起了请求）
      window.dispatchEvent(new Event("dr-gate-ready"));
    }
  } catch {
    /* 静默失败：用户可能没网，下次刷新再试 */
  }
}

export function GateClient() {
  useEffect(() => {
    void performHandshake();
  }, []);
  return null;
}
