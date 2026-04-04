"use client";

import { useEffect, useRef } from "react";

const GRID = 24;
const REVISIT_WINDOW_MS = 3200;
const MIN_SPEED_PX_S = 28;
const MAX_SPEED_PX_S = 2600;
const MIN_WARMUP_QUALIFIED_PX = 90;
const MIN_CELL_PASSES = 4;
const CLICK_SUPPRESS_MS = 500;
const HUE_DEG_PER_PX = 2.4;
const MICRO_STEP_PX = 2;
const MAX_MICRO_STEPS = 64;
const TRAIL_FADE_DEST_OUT = 0.04;
const IDLE_RESET_MS = 550;
const MAX_FADE_FRAMES = 96;
const MAX_CELL_KEYS = 400;

function cellKey(x: number, y: number) {
  return `${Math.floor(x / GRID)}_${Math.floor(y / GRID)}`;
}

function isInteractiveTarget(n: EventTarget | null): boolean {
  if (!(n instanceof Element)) return false;
  return !!n.closest(
    "button, a, input, textarea, select, option, label, summary, [role='button'], [role='tab'], [role='menuitem'], [role='link'], [contenteditable='true']",
  );
}

function recentCount(map: Map<string, number[]>, key: string, now: number): number {
  const arr = map.get(key);
  if (!arr?.length) return 0;
  return arr.filter((tm) => now - tm <= REVISIT_WINDOW_MS).length;
}

function bumpCell(map: Map<string, number[]>, key: string, now: number): number {
  let arr = map.get(key) ?? [];
  arr.push(now);
  arr = arr.filter((tm) => now - tm <= REVISIT_WINDOW_MS);
  map.set(key, arr);
  if (map.size > MAX_CELL_KEYS) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  return arr.length;
}

function strokeSmoothRainbow(
  paint: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lineW: number,
  alpha: number,
  hueBase: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 0.12) return hueBase;

  const n = Math.min(MAX_MICRO_STEPS, Math.max(1, Math.ceil(d / MICRO_STEP_PX)));
  let sx = x0;
  let sy = y0;
  let hue = hueBase;

  paint.lineCap = "round";
  paint.lineJoin = "round";

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    const stepLen = Math.hypot(x - sx, y - sy);
    if (stepLen < 0.01) continue;
    paint.strokeStyle = `hsla(${hue % 360}, 96%, 54%, ${alpha})`;
    paint.lineWidth = lineW;
    paint.beginPath();
    paint.moveTo(sx, sy);
    paint.lineTo(x, y);
    paint.stroke();
    hue += HUE_DEG_PER_PX * stepLen;
    sx = x;
    sy = y;
  }

  return hue % 360;
}

export default function RainbowBrushTrail() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function resize() {
      const node = canvasRef.current;
      const c = node?.getContext("2d", { alpha: true });
      if (!node || !c) return;
      w = window.innerWidth;
      h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      node.width = Math.floor(w * dpr);
      node.height = Math.floor(h * dpr);
      node.style.width = `${w}px`;
      node.style.height = `${h}px`;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (!canvasRef.current) return;
    const ctxMaybe = canvasRef.current.getContext("2d", { alpha: true });
    if (!ctxMaybe) return;
    const paint = ctxMaybe;

    let w = 0;
    let h = 0;
    resize();
    window.addEventListener("resize", resize);

    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let hasLast = false;
    let lastMoveAt = 0;
    const cellStamps = new Map<string, number[]>();
    let rainbowPhase = 0;
    let sessionQualifiedDist = 0;
    let suppressBrushUntil = 0;
    let rafLoop = 0;
    let pending: { x: number; y: number; now: number; buttons: number } | null =
      null;
    let fadeFramesLeft = 0;

    function onPointerDownCapture() {
      suppressBrushUntil = performance.now() + CLICK_SUPPRESS_MS;
      sessionQualifiedDist *= 0.15;
      cellStamps.clear();
      rainbowPhase = 0;
    }

    function onMove(e: MouseEvent) {
      const now = performance.now();
      if (now - lastMoveAt > IDLE_RESET_MS) {
        hasLast = false;
        cellStamps.clear();
        rainbowPhase = 0;
        sessionQualifiedDist = 0;
      }
      lastMoveAt = now;
      pending = {
        x: e.clientX,
        y: e.clientY,
        now,
        buttons: e.buttons,
      };
      fadeFramesLeft = MAX_FADE_FRAMES;
      if (!rafLoop) rafLoop = requestAnimationFrame(tick);
    }

    function tick() {
      rafLoop = 0;

      paint.save();
      paint.globalCompositeOperation = "destination-out";
      paint.fillStyle = `rgba(0,0,0,${TRAIL_FADE_DEST_OUT})`;
      paint.fillRect(0, 0, w, h);
      paint.restore();

      if (pending) {
        const { x, y, now: moveT, buttons } = pending;
        pending = null;

        const under = document.elementFromPoint(x, y);
        const onControl = isInteractiveTarget(under);
        const afterClickCooldown = moveT >= suppressBrushUntil;
        const dtMs = hasLast ? Math.max(moveT - lastT, 1) : 16;

        if (hasLast) {
          const dx = x - lastX;
          const dy = y - lastY;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.35) {
            const speed = (dist / dtMs) * 1000;
            const speedOk =
              speed >= MIN_SPEED_PX_S && speed <= MAX_SPEED_PX_S;
            const qualify =
              !onControl &&
              afterClickCooldown &&
              buttons === 0 &&
              speedOk;

            if (qualify) {
              sessionQualifiedDist += dist;
              const prevKey = cellKey(lastX, lastY);
              const currKey = cellKey(x, y);
              const prevPasses = recentCount(cellStamps, prevKey, moveT);
              const currPassesAfter = bumpCell(cellStamps, currKey, moveT);

              const warmedUp = sessionQualifiedDist >= MIN_WARMUP_QUALIFIED_PX;
              const revisitOk =
                prevKey === currKey
                  ? currPassesAfter >= MIN_CELL_PASSES
                  : prevPasses >= MIN_CELL_PASSES &&
                    currPassesAfter >= MIN_CELL_PASSES;

              if (warmedUp && revisitOk) {
                const depth = Math.min(
                  prevKey === currKey
                    ? currPassesAfter
                    : Math.min(prevPasses, currPassesAfter),
                  22,
                );
                const alpha = Math.min(0.88, 0.2 + depth * 0.03);
                const lineW = 1.3 + depth * 0.36;

                paint.save();
                paint.globalCompositeOperation = "source-over";
                rainbowPhase = strokeSmoothRainbow(
                  paint,
                  lastX,
                  lastY,
                  x,
                  y,
                  lineW,
                  alpha,
                  rainbowPhase,
                );
                paint.restore();
              }
            }
          }
        } else {
          hasLast = true;
        }

        lastX = x;
        lastY = y;
        lastT = moveT;
      }

      if (pending) {
        fadeFramesLeft = MAX_FADE_FRAMES;
      } else if (fadeFramesLeft > 0) {
        fadeFramesLeft -= 1;
      }

      const keepLoop = pending !== null || fadeFramesLeft > 0;
      if (keepLoop) {
        rafLoop = requestAnimationFrame(tick);
      } else {
        cellStamps.clear();
        rainbowPhase = 0;
        sessionQualifiedDist = 0;
      }
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDownCapture, true);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onPointerDownCapture, true);
      if (rafLoop) cancelAnimationFrame(rafLoop);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[9998]"
      aria-hidden
    />
  );
}
