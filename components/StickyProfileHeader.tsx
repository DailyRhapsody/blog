"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AvatarLifeRing from "@/components/AvatarLifeRing";
import {
  HEADER_COLLAPSED_H,
  HEADER_COLLAPSE_AT,
  HEADER_COLLAPSE_RANGE,
  HEADER_EXPANDED_H,
} from "@/lib/layout-constants";

export type StickyProfileHeaderData = {
  name: string;
  signature: string;
  avatar: string;
  /** 未设置时使用默认 `/header-bg.png` */
  headerBg?: string;
};

/**
 * 与 /entries 文章列表页一致的粘性顶栏：背景图、滚动收缩、点击栏展开、头像与签名。
 * 传入 `entriesBgmSrc` 时（仅文章页）：进入后尝试播放该音频，头像慢转；点头像暂停/继续，点昵称回首页。
 */
export default function StickyProfileHeader({
  profile,
  entriesBgmSrc,
  externalScrollY,
  onReturnToTop,
}: {
  profile: StickyProfileHeaderData | null;
  /** 文章页背景音乐 URL（如 `/audio/houlai-dewomen.mp3`）；不传则头像仍可点进首页 */
  entriesBgmSrc?: string;
  /** 外部传入的虚拟 scrollY，用于三阶段收缩；不传则使用内部 window.scrollY */
  externalScrollY?: number;
  /** 回到顶部时通知父组件重置 virtualScroll */
  onReturnToTop?: () => void;
}) {
  const [scrollY, setScrollY] = useState(0);
  const [isReturnToTopAnimating, setIsReturnToTopAnimating] = useState(false);
  const [isHeaderExpanding, setIsHeaderExpanding] = useState(false);
  const [bgmPlaying, setBgmPlaying] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const returnToTopPhaseRef = useRef<0 | 1 | 2>(0);
  const returnToTopRafRef = useRef<number>(0);

  const hasEntriesBgm = Boolean(entriesBgmSrc?.trim());

  const toggleBgm = useCallback(() => {
    const a = audioRef.current;
    if (!a || !hasEntriesBgm) return;
    if (a.paused) {
      void a.play()
        .then(() => setBgmPlaying(true))
        .catch(() => setBgmPlaying(false));
    } else {
      a.pause();
      setBgmPlaying(false);
    }
  }, [hasEntriesBgm]);

  useEffect(() => {
    if (!hasEntriesBgm) return;
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setBgmPlaying(true);
    const onPause = () => setBgmPlaying(false);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, [hasEntriesBgm]);

  useEffect(() => {
    if (!hasEntriesBgm) return;
    const a = audioRef.current;
    if (!a) return;
    void a.play().catch(() => setBgmPlaying(false));
  }, [hasEntriesBgm]);

  const runReturnToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    const startY = window.scrollY;
    // 如果页面没滚动但 virtualScroll 有值，直接重置 virtualScroll
    if (startY <= 0) {
      onReturnToTop?.();
      return;
    }

    returnToTopPhaseRef.current = 1;
    setIsReturnToTopAnimating(true);

    const scrollDuration = Math.min(
      1200,
      300 + 180 * Math.log(1 + startY / 200),
    );

    const startT = performance.now();

    function easeOutCubic(x: number) {
      return 1 - (1 - x) ** 3;
    }

    function scrollTick(now: number) {
      const elapsed = now - startT;
      const progress = Math.min(elapsed / scrollDuration, 1);
      const eased = easeOutCubic(progress);

      window.scrollTo(0, Math.round(startY * (1 - eased)));

      if (progress < 1) {
        returnToTopRafRef.current = requestAnimationFrame(scrollTick);
      } else {
        window.scrollTo(0, 0);
        setScrollY(0);
        // 通知父组件重置 virtualScroll
        onReturnToTop?.();
        returnToTopPhaseRef.current = 2;
        setIsHeaderExpanding(true);

        const EXPAND_MS = 400;
        const expandStart = performance.now();

        function expandTick(now: number) {
          const elapsed = now - expandStart;
          const p = Math.min(elapsed / EXPAND_MS, 1);
          const eased = easeOutCubic(p);

          const h = HEADER_COLLAPSED_H + HEADER_COLLAPSE_RANGE * eased;
          if (headerRef.current) {
            headerRef.current.style.height = `${h}px`;
          }

          if (p < 1) {
            returnToTopRafRef.current = requestAnimationFrame(expandTick);
          } else {
            setIsReturnToTopAnimating(false);
            setIsHeaderExpanding(false);
            returnToTopPhaseRef.current = 0;
          }
        }

        returnToTopRafRef.current = requestAnimationFrame(expandTick);
      }
    }

    returnToTopRafRef.current = requestAnimationFrame(scrollTick);
  }, [onReturnToTop]);

  useEffect(() => {
    let scrollRaf = 0;
    function onScroll() {
      if (returnToTopPhaseRef.current !== 0) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        setScrollY(typeof window !== "undefined" ? window.scrollY : 0);
      });
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      if (returnToTopRafRef.current) cancelAnimationFrame(returnToTopRafRef.current);
    };
  }, []);

  // externalScrollY (entries 页的 virtualScroll) 上限只到 HEADER_COLLAPSE_RANGE=204，
  // 小于 HEADER_COLLAPSE_AT=214，单独用它 isCollapsed 永远无法触发。
  // 叠加 window.scrollY：virtualScroll 先吸收到 204，之后原生滚动继续累加，
  // 总和越过 214 才进入吸顶 pill 态，保证收起后显示小头像 + 昵称。
  const effectiveScrollY =
    typeof externalScrollY === "number" ? externalScrollY + scrollY : scrollY;
  const nearTop = effectiveScrollY < 28;
  const isReturning = isReturnToTopAnimating;
  const signatureTrimmed = profile?.signature?.trim() ?? "";
  const hasSignature = signatureTrimmed.length > 0;

  const height = isReturning
    ? HEADER_COLLAPSED_H
    : nearTop
      ? HEADER_EXPANDED_H
      : Math.max(HEADER_COLLAPSED_H, HEADER_EXPANDED_H - effectiveScrollY);
  const isCollapsed =
    isReturning && !isHeaderExpanding ? true : effectiveScrollY >= HEADER_COLLAPSE_AT;

  const bgUrl = profile?.headerBg?.trim() || "/header-bg.png";

  function renderAvatar(size: "sm" | "lg") {
    const ring = (
      <AvatarLifeRing
        src={profile?.avatar || "/avatar.png"}
        size={size}
        spinState={
          hasEntriesBgm ? (bgmPlaying ? "running" : "paused") : "off"
        }
      />
    );
    if (!hasEntriesBgm) {
      return (
        <Link href="/" className="shrink-0 leading-none" aria-label="首页">
          {ring}
        </Link>
      );
    }
    return (
      <button
        type="button"
        className="shrink-0 cursor-pointer leading-none"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleBgm();
        }}
        aria-label={bgmPlaying ? "暂停音乐" : "播放音乐"}
      >
        {ring}
      </button>
    );
  }

  return (
    <header
      ref={headerRef}
      className={`sticky top-0 z-30 w-full overflow-hidden rounded-b-2xl bg-gradient-to-b from-zinc-900 via-zinc-800 to-black transition-[height] ease-out ${
        isReturning ? "duration-0" : "duration-300"
      }`}
      style={{
        height: `${height}px`,
      }}
    >
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${bgUrl})`,
        }}
      />
      <div className="absolute inset-0 bg-black/50" />
      {isCollapsed && !isReturning && (
        <button
          type="button"
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={runReturnToTop}
          aria-label="回到顶部并展开"
        />
      )}
      <div className="relative flex h-full w-full flex-col justify-center px-5">
        <div
          className={`absolute inset-0 z-20 flex items-center justify-center px-5 ${
            isCollapsed ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          <div
            className={`inline-flex transition-[transform,opacity] duration-400 ease-out ${
              isCollapsed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
          >
            <div className="inline-flex max-w-full items-center gap-2">
              <span className="shrink-0 leading-none">{renderAvatar("sm")}</span>
              <Link href="/" className="inline-flex min-w-0 w-fit self-center" aria-label="首页">
                <p className="whitespace-nowrap text-base font-bold leading-tight text-white">
                  {profile?.name ?? "DailyRhapsody"}
                </p>
              </Link>
            </div>
          </div>
        </div>
        <div
          className={`min-w-0 flex-1 transition-[transform,opacity] duration-400 ease-out ${
            isCollapsed
              ? "translate-y-1 opacity-0 pointer-events-none"
              : "flex flex-col justify-center translate-y-0 opacity-100"
          }`}
        >
          <div
            className={`inline-flex w-fit max-w-full shrink-0 items-center gap-4 ${
              hasSignature ? "self-start" : "self-center mx-auto"
            }`}
          >
            {renderAvatar("lg")}
            <div
              className={`flex min-w-0 flex-col justify-center gap-1 ${
                hasSignature ? "" : "items-center text-center"
              }`}
            >
              <Link
                href="/"
                className={`inline-flex w-fit ${hasSignature ? "self-start" : "self-center"}`}
              >
                <p className="whitespace-nowrap text-lg font-bold text-white">
                  {profile?.name ?? "DailyRhapsody"}
                </p>
              </Link>
              {hasSignature && (
                <p className="max-w-[min(100%,calc(100vw-6rem))] self-start text-left text-xs leading-snug text-white/80">
                  {signatureTrimmed}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      {hasEntriesBgm && entriesBgmSrc && (
        <audio
          ref={audioRef}
          src={entriesBgmSrc.trim()}
          loop
          playsInline
          preload="auto"
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          aria-hidden
        />
      )}
    </header>
  );
}
