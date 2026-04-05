"use client";

import { useEffect, useRef } from "react";

/* ── 手势识别配置 ── */
const BEARING_BINS = 8;
const MIN_SPEED_PX_S = 18;
const MAX_SPEED_PX_S = 2600;
const MIN_WARMUP_PX = 52;
const MIN_SEG_FOR_BIN = 3;
const GESTURE_BUF_MAX = 36;

/* ── 渲染配置 ── */
const LIFE_MS = 400;
const MIN_DIST = 2;
const BASE_R = 2.6;
const DOT_STEP = 1.8;
const CYCLE_PX = 240;
const MAX_PTS = 500;
const CLICK_COOL_MS = 400;
const IDLE_MS = 500;

/* ── sRGB 彩虹色标 ── */
const STOPS: [number, number, number][] = [
  [255, 50, 80],
  [255, 150, 40],
  [255, 225, 50],
  [80, 225, 110],
  [50, 195, 255],
  [105, 115, 255],
  [175, 80, 255],
  [255, 65, 155],
];

function rainbowRgb(t: number): [number, number, number] {
  const n = STOPS.length;
  const p = ((t % 1) + 1) % 1;
  const f = p * (n - 1);
  const i = Math.min(f | 0, n - 2);
  const u = f - i;
  return [
    (STOPS[i][0] + (STOPS[i + 1][0] - STOPS[i][0]) * u + 0.5) | 0,
    (STOPS[i][1] + (STOPS[i + 1][1] - STOPS[i][1]) * u + 0.5) | 0,
    (STOPS[i][2] + (STOPS[i + 1][2] - STOPS[i][2]) * u + 0.5) | 0,
  ];
}

/* ── 手势识别（8方位 bin） ── */
const TAU = Math.PI * 2;

function bearingBin8(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return Math.min(BEARING_BINS - 1, Math.floor((((a % TAU) + TAU) % TAU) / TAU * BEARING_BINS));
}

function signedBinDelta(prev: number, next: number): number {
  let d = next - prev;
  if (d > 4) d -= BEARING_BINS;
  if (d < -4) d += BEARING_BINS;
  return d;
}

/** 振荡检测：左右反复大掉头 */
function detectOscillation(bins: number[]): number {
  if (bins.length < 6) return 0;
  const s = bins.slice(-14);
  let sharp = 0;
  for (let i = 1; i < s.length; i++) {
    if (Math.abs(signedBinDelta(s[i - 1]!, s[i]!)) >= 3) sharp++;
  }
  return sharp >= 4 ? 4 : sharp >= 3 ? 3 : 0;
}

/** 画圈检测：持续同向拐弯 */
function detectWinding(bins: number[]): number {
  if (bins.length < 8) return 0;
  const s = bins.slice(-22);
  let totalAbs = 0;
  let net = 0;
  for (let i = 1; i < s.length; i++) {
    const d = signedBinDelta(s[i - 1]!, s[i]!);
    net += d;
    totalAbs += Math.abs(d);
  }
  if (Math.abs(net) >= 4 && totalAbs >= 6)
    return Math.min(6, 3 + Math.floor(Math.abs(net) / 2));
  if (totalAbs >= 11) return 4;
  return 0;
}

function gestureQuality(bins: number[]): number {
  return Math.max(detectOscillation(bins), detectWinding(bins));
}

/* ── 轨迹点 ── */
interface Pt { x: number; y: number; t: number; d: number }

export default function RainbowBrushTrail() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cvs = ref.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d", { alpha: true });
    if (!ctx) return;

    let W = 0;
    let H = 0;
    const resize = () => {
      W = innerWidth;
      H = innerHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cvs.width = (W * dpr) | 0;
      cvs.height = (H * dpr) | 0;
      cvs.style.width = `${W}px`;
      cvs.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener("resize", resize);

    /* ── 状态 ── */
    const pts: Pt[] = [];          // 渲染用轨迹点
    const gestureBins: number[] = [];
    let lx = 0, ly = 0, lt = 0;
    let hasPrev = false;
    let cumDist = 0;               // 渲染色相累距
    let qualifiedDist = 0;         // 手势识别累距
    let raf = 0;
    let lastMove = 0;
    let suppressUntil = 0;
    let streamActive = false;      // 手势已识别，持续绘制
    let quality = 0;

    function resetAll() {
      pts.length = 0;
      gestureBins.length = 0;
      hasPrev = false;
      cumDist = 0;
      qualifiedDist = 0;
      streamActive = false;
      quality = 0;
    }

    const onMove = (e: MouseEvent) => {
      if (e.buttons) { streamActive = false; return; }
      const now = performance.now();
      if (now < suppressUntil) return;
      const x = e.clientX, y = e.clientY;

      if (now - lastMove > IDLE_MS) resetAll();
      lastMove = now;

      if (!hasPrev) { lx = x; ly = y; lt = now; hasPrev = true; return; }

      const dx = x - lx, dy = y - ly;
      const dist = Math.hypot(dx, dy);
      if (dist < MIN_DIST) return;

      const dt = Math.max(now - lt, 1);
      const speed = (dist / dt) * 1000;

      /* ── 手势采样：速度在合理范围内才计入 bin ── */
      if (speed >= MIN_SPEED_PX_S && speed <= MAX_SPEED_PX_S) {
        qualifiedDist += dist;
        if (dist >= MIN_SEG_FOR_BIN) {
          gestureBins.push(bearingBin8(dx, dy));
          while (gestureBins.length > GESTURE_BUF_MAX) gestureBins.shift();
        }
        // 累计足够距离后尝试识别
        if (qualifiedDist >= MIN_WARMUP_PX) {
          const q = gestureQuality(gestureBins);
          if (q > 0) {
            streamActive = true;
            quality = Math.max(quality, q, 3);
          }
        }
      }

      /* ── 如果手势已激活 → 记录渲染点 ── */
      if (streamActive) {
        cumDist += dist;
        pts.push({ x, y, t: now, d: cumDist });
        if (pts.length > MAX_PTS) pts.splice(0, pts.length - MAX_PTS);
      }

      lx = x; ly = y; lt = now;
      if (!raf) raf = requestAnimationFrame(draw);
    };

    const draw = () => {
      raf = 0;
      const now = performance.now();

      while (pts.length && now - pts[0].t > LIFE_MS) pts.shift();
      ctx.clearRect(0, 0, W, H);

      if (pts.length < 2) {
        if (pts.length) raf = requestAnimationFrame(draw);
        return;
      }

      const depth = Math.min(quality + 2, 22);
      const baseAlpha = Math.min(0.82, 0.22 + depth * 0.028);
      const baseR = BASE_R * (0.6 + depth * 0.04);
      const C = 6.2832;

      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (segLen < 0.01) continue;

        const steps = Math.max(1, Math.ceil(segLen / DOT_STEP));
        for (let s = 0; s <= steps; s++) {
          const frac = s / steps;
          const px = a.x + (b.x - a.x) * frac;
          const py = a.y + (b.y - a.y) * frac;
          const pt = a.t + (b.t - a.t) * frac;
          const pd = a.d + (b.d - a.d) * frac;

          const life = Math.max(0, 1 - (now - pt) / LIFE_MS);
          if (life <= 0) continue;

          const alpha = life * life * baseAlpha;
          const r = baseR * (0.25 + 0.75 * life);
          const [cr, cg, cb] = rainbowRgb(pd / CYCLE_PX);

          ctx.beginPath();
          ctx.arc(px, py, r, 0, C);
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    const onDown = () => {
      resetAll();
      suppressUntil = performance.now() + CLICK_COOL_MS;
    };

    addEventListener("mousemove", onMove, { passive: true });
    addEventListener("pointerdown", onDown, true);

    return () => {
      removeEventListener("resize", resize);
      removeEventListener("mousemove", onMove);
      removeEventListener("pointerdown", onDown, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 z-[9998]"
      aria-hidden
    />
  );
}
