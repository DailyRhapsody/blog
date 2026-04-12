"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 1994.10.21 早上 5:05，东八区 */
const BIRTH_MS = Date.parse("1994-10-21T05:05:00+08:00");
/** 圆环满圈对应的寿命（年），仅用于可视化比例 */
const LIFE_RING_SPAN_YEARS = 80;
const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;
const LIFE_END_MS = BIRTH_MS + LIFE_RING_SPAN_YEARS * MS_PER_YEAR;

const SIZE_MAP = {
  sm: { outer: 36, image: 28, stroke: 2.5, imageClass: "h-7 w-7" },
  lg: { outer: 76, image: 64, stroke: 3, imageClass: "h-16 w-16" },
} as const;

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

/** 总秒数 → 「X日 X时 X分 X秒」 */
function formatElapsedDhms(totalSec: number) {
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor((totalSec / 3600) % 24);
  const d = Math.floor(totalSec / 86400);
  return `${d.toLocaleString("zh-CN")}日 ${h}时 ${m}分 ${s}秒`;
}

export default function AvatarLifeRing({
  src,
  size,
  className = "",
  spinState = "off",
  spinStartTime = 0,
}: {
  src: string;
  size: keyof typeof SIZE_MAP;
  className?: string;
  /**
   * 文章页背景音乐：播放中旋转；暂停时用 animation-play-state 冻结在当前角度（不回到 0°）
   */
  spinState?: "off" | "running" | "paused";
  /**
   * 播放开始时的时间戳（Date.now()）。
   * 用负 animation-delay 让多个头像实例同步到同一旋转角度，
   * 避免展开/收缩切换时角度跳变。
   */
  spinStartTime?: number;
}) {
  const { outer, image, stroke, imageClass } = SIZE_MAP[size];
  const haloStroke = Math.max(stroke * 2.4, stroke + 3);
  /** 为绿色光晕留出边距，避免 SVG 视口裁切描边外侧 */
  const viewPad = Math.max(10, Math.ceil(haloStroke / 2 + 4));
  const viewSize = outer + 2 * viewPad;
  const cx = viewPad + outer / 2;
  const cy = viewPad + outer / 2;
  const r = outer / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;

  // 仅在 spinStartTime 变化时重算一次（音乐开始播放那一刻），
  // 之后保持稳定，不会因其他 re-render 导致动画重启。
  // 两个头像实例（lg 展开 / sm 收缩）用同一个 spinStartTime，
  // 算出的负 delay 让它们对齐到同一旋转角度。
  const spinDelay = useMemo(
    () => (spinStartTime > 0 ? -(Date.now() - spinStartTime) : 0),
    [spinStartTime],
  );

  const [nowMs, setNowMs] = useState(0);
  const [hover, setHover] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const now = nowMs > 0 ? nowMs : BIRTH_MS;
  const elapsedMs = now - BIRTH_MS;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const progress = clamp01(elapsedMs / (LIFE_END_MS - BIRTH_MS));
  const dashOffset = c * (1 - progress);

  const updateTooltipPos = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTooltipPos({
      left: Math.round(rect.left),
      top: Math.round(rect.bottom + 6),
    });
  }, []);

  useEffect(() => {
    if (!hover) return;

    const touchUi =
      typeof window !== "undefined" &&
      (window.matchMedia("(pointer: coarse)").matches ||
        navigator.maxTouchPoints > 0);

    const dismiss = () => setHover(false);

    if (touchUi) {
      const pointerDownAway = (e: PointerEvent) => {
        const el = rootRef.current;
        const t = e.target;
        if (!el || !(t instanceof Node) || el.contains(t)) return;
        dismiss();
      };
      window.addEventListener("scroll", dismiss, true);
      window.addEventListener("touchmove", dismiss, { capture: true, passive: true });
      window.addEventListener("wheel", dismiss, { capture: true, passive: true });
      document.addEventListener("pointerdown", pointerDownAway, true);
      return () => {
        window.removeEventListener("scroll", dismiss, true);
        window.removeEventListener("touchmove", dismiss, true);
        window.removeEventListener("wheel", dismiss, true);
        document.removeEventListener("pointerdown", pointerDownAway, true);
      };
    }

    updateTooltipPos();
    window.addEventListener("scroll", updateTooltipPos, true);
    window.addEventListener("resize", updateTooltipPos);
    return () => {
      window.removeEventListener("scroll", updateTooltipPos, true);
      window.removeEventListener("resize", updateTooltipPos);
    };
  }, [hover, updateTooltipPos]);

  const tooltip =
    hover &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="pointer-events-none z-[200] rounded-lg border border-white/20 bg-zinc-950/95 px-3 py-2 text-left text-[11px] leading-snug text-white shadow-lg backdrop-blur-sm"
        style={{
          position: "fixed",
          left: tooltipPos.left,
          top: tooltipPos.top,
          maxWidth: `min(280px, calc(100vw - ${tooltipPos.left}px - 12px))`,
        }}
        role="tooltip"
      >
        <p className="tabular-nums text-amber-100/95">{formatElapsedDhms(elapsedSec)}</p>
      </div>,
      document.body,
    );

  return (
    <div
      ref={rootRef}
      className={`relative shrink-0 ${className}`}
      style={{ width: viewSize, height: viewSize }}
      onMouseEnter={() => {
        setHover(true);
        queueMicrotask(updateTooltipPos);
      }}
      onMouseLeave={() => setHover(false)}
    >
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={viewSize}
        height={viewSize}
        viewBox={`0 0 ${viewSize} ${viewSize}`}
        aria-hidden
      >
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            className="stroke-white/25"
            strokeWidth={stroke}
          />
          {/* 睡眠灯式：底层淡绿白光晕 + 前景进度弧同相位呼吸 */}
          <g className="dr-life-ring-sleep-led">
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="rgba(186, 245, 208, 0.5)"
              strokeWidth={haloStroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={dashOffset}
            />
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              className="stroke-amber-200/95 transition-[stroke-dashoffset] duration-1000 ease-linear"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={dashOffset}
            />
          </g>
        </g>
      </svg>
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full ${imageClass}`}
      >
        <div
          className={`h-full w-full ${spinState !== "off" ? "dr-avatar-spin-slow" : ""}`}
          style={
            spinState !== "off"
              ? {
                  animationPlayState: spinState === "paused" ? ("paused" as const) : ("running" as const),
                  // 负 delay = 从动画时间线的「已过去」位置开始，
                  // 这样不同时刻挂载的 sm / lg 头像都对齐到同一角度。
                  // 用挂载时算好的 spinDelay，避免每次渲染重算导致动画重启。
                  animationDelay: spinDelay !== 0 ? `${spinDelay}ms` : undefined,
                }
              : undefined
          }
        >
          <Image
            src={src || "/avatar.png"}
            alt=""
            width={image}
            height={image}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      </div>
      {tooltip}
    </div>
  );
}
