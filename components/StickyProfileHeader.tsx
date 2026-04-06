"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AvatarLifeRing from "@/components/AvatarLifeRing";

export type StickyProfileHeaderData = {
  name: string;
  signature: string;
  avatar: string;
  /** 未设置时使用默认 `/header-bg.png` */
  headerBg?: string;
};

/**
 * 与 /entries 文章列表页一致的粘性顶栏：背景图、滚动收缩、点击栏展开、头像与签名。
 */
export default function StickyProfileHeader({
  profile,
}: {
  profile: StickyProfileHeaderData | null;
}) {
  const [scrollY, setScrollY] = useState(0);
  const [isReturnToTopAnimating, setIsReturnToTopAnimating] = useState(false);
  const [isHeaderExpanding, setIsHeaderExpanding] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const returnToTopPhaseRef = useRef<0 | 1 | 2>(0);
  const returnToTopRafRef = useRef<number>(0);

  const runReturnToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    const startY = window.scrollY;
    if (startY <= 0) return;

    const HEADER_EXPANDED = 260;
    const HEADER_COLLAPSED = 56;

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
        returnToTopPhaseRef.current = 2;
        setIsHeaderExpanding(true);

        const EXPAND_MS = 400;
        const expandStart = performance.now();

        function expandTick(now: number) {
          const elapsed = now - expandStart;
          const p = Math.min(elapsed / EXPAND_MS, 1);
          const eased = easeOutCubic(p);

          const h = HEADER_COLLAPSED + (HEADER_EXPANDED - HEADER_COLLAPSED) * eased;
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
  }, []);

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

  const HEADER_EXPANDED = 260;
  const HEADER_COLLAPSED = 56;
  const threshold = HEADER_EXPANDED - HEADER_COLLAPSED;
  const COLLAPSE_AT = threshold + 10;
  const nearTop = scrollY < 28;
  const isReturning = isReturnToTopAnimating;
  const signatureTrimmed = profile?.signature?.trim() ?? "";
  const hasSignature = signatureTrimmed.length > 0;

  const height = isReturning
    ? HEADER_COLLAPSED
    : nearTop
      ? HEADER_EXPANDED
      : Math.max(HEADER_COLLAPSED, HEADER_EXPANDED - scrollY);
  const isCollapsed = isReturning && !isHeaderExpanding ? true : scrollY >= COLLAPSE_AT;

  const bgUrl = profile?.headerBg?.trim() || "/header-bg.png";

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
          className={`absolute inset-0 flex items-center justify-center px-5 ${
            isCollapsed ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          <div
            className={`inline-flex transition-[transform,opacity] duration-400 ease-out ${
              isCollapsed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
          >
            <div className="inline-flex max-w-full items-center gap-2">
              <Link href="/" className="shrink-0 leading-none" aria-label="首页">
                <AvatarLifeRing src={profile?.avatar || "/avatar.png"} size="sm" />
              </Link>
              <Link href="/" className="inline-flex min-w-0 w-fit self-center">
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
            <Link href="/" className="shrink-0 leading-none" aria-label="首页">
              <AvatarLifeRing src={profile?.avatar || "/avatar.png"} size="lg" />
            </Link>
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
    </header>
  );
}
