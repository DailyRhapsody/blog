"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import RainbowBrushTrail from "@/components/RainbowBrushTrail";
import StickyProfileHeader from "@/components/StickyProfileHeader";
import { MomentLightbox } from "@/app/gallery/MomentLightbox";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { CalendarHeatmap } from "@/components/entries/CalendarHeatmap";
import { EntryCard } from "@/components/entries/EntryCard";
import { GalleryTab } from "@/components/entries/GalleryTab";
import { getSizeClass, legacyToMoment, PAGE_SIZE } from "@/components/entries/utils";
import type {
  Diary,
  GalleryLegacyItem,
  GalleryTimelineRow,
  Profile,
  PublicMoment,
} from "@/components/entries/types";

export default function EntriesPage() {
  const [items, setItems] = useState<Diary[]>([]);
  const [total, setTotal] = useState(0);
  const [tagCounts, setTagCounts] = useState<{ name: string; value: number }[]>([]);
  const [datesFromApi, setDatesFromApi] = useState<string[]>([]);
  const [galleryThumbs, setGalleryThumbs] = useState<string[]>([]);
  const [galleryLegacy, setGalleryLegacy] = useState<GalleryLegacyItem[]>([]);
  const [galleryMoments, setGalleryMoments] = useState<PublicMoment[]>([]);
  const [galleryOffset, setGalleryOffset] = useState(0);
  const [galleryHasMore, setGalleryHasMore] = useState(true);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryLoadingMore, setGalleryLoadingMore] = useState(false);
  const [lightbox, setLightbox] = useState<{ urls: string[]; i: number; lbKey: string } | null>(null);
  const galleryLoadLock = useRef(false);
  const gallerySentinelRef = useRef<HTMLDivElement>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdminSession, setIsAdminSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [entriesFlipped, setEntriesFlipped] = useState(false);
  const [, setScrollYPos] = useState(0);
  const [virtualScroll, setVirtualScroll] = useState(0);
  const virtualScrollRef = useRef(0);
  const [activeTopTab, setActiveTopTab] = useState(0); // 0=博客, 1=画廊
  const activeTopTabRef = useRef(0);
  const [eggPullY, setEggPullY] = useState(0);
  const [isRebounding, setIsRebounding] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const eggPullAccumRef = useRef(0);
  const eggReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchLastYRef = useRef(0);
  const hasMoreRef = useRef(true);
  const totalPostsRef = useRef(0);
  /** 防止无限滚动与 hash 深链同时触发同一 offset 的重复 append */
  const listAppendInFlightRef = useRef(false);

  const datesWithPosts = useMemo(() => new Set(datesFromApi), [datesFromApi]);
  const thisMonthPostCount = useMemo(() => {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let count = 0;
    datesWithPosts.forEach((d) => { if (d.startsWith(prefix)) count++; });
    return count;
  }, [datesWithPosts]);
  const totalPosts = total;
  const currentEntries = items;
  const hasMore = items.length < total && total > 0;
  const maxTagCount = tagCounts[0]?.value ?? 1;

  /* ── 两阶段收缩：virtualScroll 驱动 header → 原生滚动 ── */
  const HEADER_EXPANDED_H = 260;
  const HEADER_COLLAPSED_H = 56;
  const PHASE1_RANGE = HEADER_EXPANDED_H - HEADER_COLLAPSED_H; // 204: header 收缩量
  const TOTAL_ABSORB = PHASE1_RANGE; // header 收缩完即放行原生滚动

  useEffect(() => {
    hasMoreRef.current = hasMore;
    totalPostsRef.current = totalPosts;
  }, [hasMore, totalPosts]);

  useEffect(() => {
    fetchWithTimeout("/api/gallery")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        const imgs: string[] = [];
        for (const item of list) {
          const arr = Array.isArray(item?.images) ? item.images : [];
          for (const src of arr) {
            if (typeof src === "string" && src.trim()) imgs.push(src.trim());
            if (imgs.length >= 4) break;
          }
          if (imgs.length >= 4) break;
        }
        setGalleryThumbs(imgs.slice(0, 4));
        setGalleryLegacy(list);
      })
      .catch(() => { setGalleryThumbs([]); setGalleryLegacy([]); });
  }, []);

  /* ── 画廊：加载 moments 分页 ── */
  const loadGalleryPage = useCallback(async (fromOffset: number, replace: boolean) => {
    if (replace) setGalleryLoading(true);
    else {
      if (galleryLoadLock.current) return;
      galleryLoadLock.current = true;
      setGalleryLoadingMore(true);
    }
    try {
      const res = await fetchWithTimeout(`/api/moments?limit=8&offset=${fromOffset}`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (replace) setGalleryMoments([]);
        setGalleryHasMore(false);
        return;
      }
      const next: PublicMoment[] = Array.isArray(data.items) ? data.items : [];
      setGalleryHasMore(!!data.hasMore);
      setGalleryOffset(typeof data.nextOffset === "number" ? data.nextOffset : fromOffset + next.length);
      if (replace) setGalleryMoments(next);
      else setGalleryMoments((prev) => [...prev, ...next]);
    } catch {
      if (replace) setGalleryMoments([]);
      setGalleryHasMore(false);
    } finally {
      setGalleryLoading(false);
      setGalleryLoadingMore(false);
      if (!replace) galleryLoadLock.current = false;
    }
  }, []);

  useEffect(() => { void loadGalleryPage(0, true); }, [loadGalleryPage]);

  const galleryTimeline = useMemo(() => {
    const legacyVisible = galleryLegacy.filter((g) => g?.images?.length && (isAdminSession || g.isPublic !== false));
    const legacyRows: GalleryTimelineRow[] = legacyVisible.map((g) => ({
      rowKey: `legacy-${g.id}`, createdAt: g.createdAt, moment: legacyToMoment(g),
    }));
    const momentRows: GalleryTimelineRow[] = galleryMoments.map((m) => ({
      rowKey: `moment-${m.id}`, createdAt: m.createdAt, moment: m,
    }));
    return [...legacyRows, ...momentRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [galleryLegacy, galleryMoments, isAdminSession]);

  /* ── 画廊无限滚动 ── */
  useEffect(() => {
    if (activeTopTab !== 1) return;
    const el = gallerySentinelRef.current;
    if (!el || !galleryHasMore || galleryLoading || galleryLoadingMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || galleryLoadingMore) return;
        void loadGalleryPage(galleryOffset, false);
      },
      { rootMargin: "240px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [activeTopTab, galleryHasMore, galleryLoading, galleryLoadingMore, galleryOffset, loadGalleryPage]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const loadPage = useCallback(
    (offset: number, append: boolean, tag: string | null) => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (tag) params.set("tag", tag);
      return fetchWithTimeout(`/api/diaries?${params}`)
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        })
        .then((data: { items?: Diary[]; total?: number; tagCounts?: { name: string; value: number }[]; dates?: string[] }) => {
          const list = Array.isArray(data.items) ? data.items : [];
          if (append) setItems((prev) => [...prev, ...list]);
          else setItems(list);
          if (typeof data.total === "number") setTotal(data.total);
          if (Array.isArray(data.tagCounts)) setTagCounts(data.tagCounts);
          if (Array.isArray(data.dates)) setDatesFromApi(data.dates);
        });
    },
    []
  );

  useEffect(() => {
    loadPage(0, false, selectedTag)
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [selectedTag, loadPage]);

  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const anchor = window.location.hash.replace(/^#/, "");
    if (!anchor.startsWith("entry-")) return;
    const el = document.getElementById(anchor);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      return;
    }
    const idNum = Number(anchor.slice("entry-".length));
    if (!Number.isFinite(idNum)) return;
    const inList = items.some((d) => d.id === idNum);
    if (inList) {
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
      return;
    }
    if (total > 0 && items.length >= total) return;
    if (!hasMore || loadingMore || listAppendInFlightRef.current) return;
    listAppendInFlightRef.current = true;
    setLoadingMore(true);
    loadPage(items.length, true, selectedTag)
      .catch(() => {})
      .finally(() => {
        listAppendInFlightRef.current = false;
        setLoadingMore(false);
      });
  }, [loading, items, total, hasMore, loadingMore, selectedTag, loadPage]);

  useEffect(() => {
    fetchWithTimeout("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProfile(data ?? null))
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    fetchWithTimeout("/api/auth/session")
      .then((res) => (res.ok ? res.json() : { ok: false }))
      .then((data: { ok?: boolean }) => {
        setIsAdminSession(!!data?.ok);
      })
      .catch(() => setIsAdminSession(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setEntriesFlipped(true), 80);
    return () => clearTimeout(t);
  }, []);

  /* ── 三阶段滚动拦截：virtualScroll 吸收 header/tools 收缩，然后放行原生滚动 ── */
  useEffect(() => {
    let rafId = 0;
    const syncScrollY = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        setScrollYPos(window.scrollY);
      });
    };
    syncScrollY();
    window.addEventListener("scroll", syncScrollY, { passive: true });

    function onWheel(e: WheelEvent) {
      // 水平滑动用于切换 tab，不拦截
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 2) return;

      const vs = virtualScrollRef.current;

      if (e.deltaY > 0) {
        // 向下滚
        if (vs < TOTAL_ABSORB) {
          e.preventDefault();
          const next = Math.min(TOTAL_ABSORB, vs + e.deltaY);
          virtualScrollRef.current = next;
          setVirtualScroll(next);
          // 如果恰好满了，将剩余 delta 传给原生滚动
          if (next === TOTAL_ABSORB && vs < TOTAL_ABSORB) {
            const remaining = e.deltaY - (TOTAL_ABSORB - vs);
            if (remaining > 0) window.scrollBy(0, remaining);
          }
        }
        // 已满：放行原生滚动
      } else if (e.deltaY < 0) {
        // 向上滚
        const pageY = window.scrollY;
        if (pageY <= 0 && vs > 0) {
          e.preventDefault();
          const next = Math.max(0, vs + e.deltaY);
          virtualScrollRef.current = next;
          setVirtualScroll(next);
        }
        // pageY > 0：放行原生滚动
      }
    }

    // 触摸拦截
    let touchStartY = 0;
    let touchLastY = 0;
    let touchIntercepting = false;

    function onTouchStart(e: TouchEvent) {
      touchStartY = e.touches[0].clientY;
      touchLastY = touchStartY;
      const vs = virtualScrollRef.current;
      const pageY = window.scrollY;
      // 在顶部且 virtualScroll 未满时拦截
      touchIntercepting = (vs < TOTAL_ABSORB && pageY <= 0) || (vs > 0 && pageY <= 0);
    }

    function onTouchMove(e: TouchEvent) {
      const currentY = e.touches[0].clientY;
      const delta = touchLastY - currentY; // 正=下滚
      touchLastY = currentY;

      const vs = virtualScrollRef.current;
      const pageY = window.scrollY;

      if (delta > 0 && vs < TOTAL_ABSORB) {
        // 下滚，吸收
        e.preventDefault();
        const next = Math.min(TOTAL_ABSORB, vs + delta);
        virtualScrollRef.current = next;
        setVirtualScroll(next);
        touchIntercepting = true;
      } else if (delta < 0 && pageY <= 0 && vs > 0) {
        // 上滚，回退 virtualScroll
        e.preventDefault();
        const next = Math.max(0, vs + delta);
        virtualScrollRef.current = next;
        setVirtualScroll(next);
        touchIntercepting = true;
      } else {
        touchIntercepting = false;
      }
    }

    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      window.removeEventListener("scroll", syncScrollY);
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [TOTAL_ABSORB]);

  /* ── activeTopTab ref 同步 ── */
  useEffect(() => { activeTopTabRef.current = activeTopTab; }, [activeTopTab]);

  /* ── 全局：禁用浏览器左右滑动导航 + 水平滚轮切换 tab ── */
  useEffect(() => {
    let accum = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 2) {
        e.preventDefault();
        accum += e.deltaX;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (Math.abs(accum) > 30) {
            setActiveTopTab((prev) =>
              accum > 0 ? Math.min(prev + 1, 1) : Math.max(prev - 1, 0),
            );
          }
          accum = 0;
        }, 80);
      }
    }

    /* 全局 touch：页面任意位置左右滑动切 tab */
    let gStartX = 0, gStartY = 0;
    let gIsHz: boolean | null = null;

    function onGTouchStart(e: TouchEvent) {
      gStartX = e.touches[0].clientX;
      gStartY = e.touches[0].clientY;
      gIsHz = null;
    }
    function onGTouchMove(e: TouchEvent) {
      if (gIsHz === false) return;
      const dx = e.touches[0].clientX - gStartX;
      const dy = e.touches[0].clientY - gStartY;
      if (gIsHz === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        gIsHz = Math.abs(dx) > Math.abs(dy);
      }
      if (gIsHz) e.preventDefault();
    }
    function onGTouchEnd(e: TouchEvent) {
      if (!gIsHz) return;
      const dx = (e.changedTouches[0]?.clientX ?? gStartX) - gStartX;
      if (Math.abs(dx) > 50) {
        setActiveTopTab((prev) =>
          dx < 0 ? Math.min(prev + 1, 1) : Math.max(prev - 1, 0),
        );
      }
    }

    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("touchstart", onGTouchStart, { passive: true });
    document.addEventListener("touchmove", onGTouchMove, { passive: false });
    document.addEventListener("touchend", onGTouchEnd);
    document.documentElement.style.overscrollBehaviorX = "none";

    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("touchstart", onGTouchStart);
      document.removeEventListener("touchmove", onGTouchMove);
      document.removeEventListener("touchend", onGTouchEnd);
      document.documentElement.style.overscrollBehaviorX = "";
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (
          !entries[0]?.isIntersecting ||
          loadingMore ||
          listAppendInFlightRef.current
        )
          return;
        listAppendInFlightRef.current = true;
        setLoadingMore(true);
        const offset = items.length;
        loadPage(offset, true, selectedTag)
          .catch(() => {})
          .finally(() => {
            listAppendInFlightRef.current = false;
            setLoadingMore(false);
          });
      },
      { rootMargin: "200px", threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, loadingMore, items.length, selectedTag, loadPage]);

  useEffect(() => {
    const MAX_EGG_PULL = 120;
    const WHEEL_RELEASE_MS = 100;
    let rafId = 0;

    const isAtBottom = () => {
      const scrollTop = window.scrollY ?? document.documentElement.scrollTop;
      const scrollHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      return scrollTop + window.innerHeight >= scrollHeight - 80;
    };

    const hideEgg = () => {
      if (eggReleaseTimerRef.current) {
        clearTimeout(eggReleaseTimerRef.current);
        eggReleaseTimerRef.current = null;
      }
      eggPullAccumRef.current = 0;
      setIsRebounding(true);
      setEggPullY(0);
      eggReleaseTimerRef.current = setTimeout(() => {
        setIsRebounding(false);
        eggReleaseTimerRef.current = null;
      }, 400);
    };

    const flushPullY = () => {
      rafId = 0;
      setEggPullY(eggPullAccumRef.current);
    };

    const onWheel = (e: WheelEvent) => {
      if (hasMoreRef.current) return;
      if (totalPostsRef.current === 0) return;
      if (!isAtBottom()) return;
      if (e.deltaY === 0) return;

      // 仅在底部「继续往下滚」时累计彩蛋；向上滚用 deltaY<0，之前误用 abs 会把上滑也算成拉力
      if (e.deltaY < 0) {
        if (eggReleaseTimerRef.current) {
          clearTimeout(eggReleaseTimerRef.current);
          eggReleaseTimerRef.current = null;
        }
        eggPullAccumRef.current = 0;
        setEggPullY(0);
        setIsRebounding(false);
        return;
      }

      eggPullAccumRef.current = Math.min(
        MAX_EGG_PULL,
        eggPullAccumRef.current + e.deltaY
      );
      if (!rafId) rafId = requestAnimationFrame(flushPullY);
      if (eggReleaseTimerRef.current) clearTimeout(eggReleaseTimerRef.current);
      eggReleaseTimerRef.current = setTimeout(hideEgg, WHEEL_RELEASE_MS);
    };

    const onTouchStart = () => {
      touchLastYRef.current = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (hasMoreRef.current) return;
      if (totalPostsRef.current === 0) return;
      if (!isAtBottom()) return;
      const y = e.touches[0]?.clientY ?? 0;
      if (touchLastYRef.current === 0) touchLastYRef.current = y;
      const dy = y - touchLastYRef.current;
      touchLastYRef.current = y;
      if (dy < 0) {
        eggPullAccumRef.current = 0;
        setEggPullY(0);
        setIsRebounding(false);
        return;
      }
      if (dy > 0) {
        eggPullAccumRef.current = Math.min(
          MAX_EGG_PULL,
          eggPullAccumRef.current + dy
        );
        if (!rafId) rafId = requestAnimationFrame(flushPullY);
      }
    };
    const onTouchEnd = () => {
      hideEgg();
    };

    document.addEventListener("wheel", onWheel, { passive: true, capture: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      if (rafId) cancelAnimationFrame(rafId);
      if (eggReleaseTimerRef.current) clearTimeout(eggReleaseTimerRef.current);
    };
  }, []);

  const handleTagClick = (tag: string) => {
    setLoading(true);
    setSelectedTag((prev) => (prev === tag ? null : tag));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-100 to-white font-sans text-zinc-900 dark:from-black dark:via-zinc-950 dark:to-black dark:text-zinc-50">
      <RainbowBrushTrail />
      <div className="entries-flip-wrapper">
        <main
          id="entries"
          className="entries-flip-panel mx-auto flex max-w-4xl flex-col pb-8"
          data-flip-visible={entriesFlipped ? "true" : "false"}
        >
          <StickyProfileHeader
            profile={profile}
            entriesBgmSrc={
              process.env.NEXT_PUBLIC_ENTRIES_BGM_SRC?.trim() || undefined
            }
            externalScrollY={virtualScroll}
            onReturnToTop={() => {
              virtualScrollRef.current = 0;
              setVirtualScroll(0);
            }}
          />

          <div
            ref={contentWrapperRef}
            style={{
              transform: !hasMore && (eggPullY > 0 || isRebounding)
                ? `translate3d(0, -${eggPullY}px, 0)`
                : undefined,
              willChange: !hasMore && eggPullY > 0 && !isRebounding
                ? "transform"
                : undefined,
            }}
            className={!hasMore && isRebounding ? "rebound-transition" : ""}
          >
          <div className="px-4 pt-5">
          <div className="mb-5 flex flex-wrap items-start gap-4">
            {/* 日历热力图：始终显示，无选中态 */}
            <CalendarHeatmap datesWithPosts={datesWithPosts} />
            {/* 博客卡片：activeTopTab===0 选中 */}
            <button
              type="button"
              onClick={() => setActiveTopTab(0)}
              className={`inline-flex h-[148px] flex-col items-start justify-center rounded-xl border border-zinc-200 bg-white/80 px-5 shadow-sm transition-apple dark:border-zinc-700 dark:bg-zinc-800/80 ${activeTopTab === 0 ? "ring-2 ring-inset ring-zinc-400 dark:ring-zinc-500" : "opacity-60"}`}
              style={{ width: "min(100%, 168px)" }}
            >
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">博客</p>
              <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{totalPosts}</p>
              <p className="text-[0.7rem] text-zinc-500 dark:text-zinc-400">篇文章</p>
              <p className="mt-1.5 text-[0.7rem] text-zinc-400 dark:text-zinc-500">
                本月 {thisMonthPostCount} 篇更新
              </p>
            </button>
            {/* 画廊卡片：activeTopTab===1 选中 */}
            <button
              type="button"
              onClick={() => setActiveTopTab(1)}
              className={`inline-grid h-[148px] rounded-xl border border-zinc-200 bg-white/80 p-2.5 shadow-sm transition-apple dark:border-zinc-700 dark:bg-zinc-800/80 ${activeTopTab === 1 ? "ring-2 ring-inset ring-zinc-400 dark:ring-zinc-500" : "opacity-60"}`}
              style={{ width: "min(100%, 168px)" }}
            >
              <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-2">
                {Array.from({ length: 4 }).map((_, i) => {
                  const src = galleryThumbs[i];
                  return (
                    <div
                      key={src ? `${src}-${i}` : `ph-${i}`}
                      className="relative overflow-hidden rounded-[8px] bg-zinc-100 ring-1 ring-zinc-200/70 dark:bg-zinc-700/60 dark:ring-zinc-600/60"
                    >
                      {src ? (
                        <Image
                          src={src}
                          alt=""
                          fill
                          unoptimized
                          className="object-cover"
                          sizes="(max-width: 768px) 76px, 76px"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </button>
          </div>

          {activeTopTab === 0 ? (
            <>
              {/* 标签词云：正常参与滚动 */}
              {tagCounts.length > 0 && (
                <section className="mb-5 rounded-2xl border border-zinc-200 bg-white/60 px-4 py-5 shadow-sm transition-apple dark:border-zinc-800 dark:bg-zinc-900/40 [contain:layout_paint]">
                  <div className="flex flex-wrap items-center gap-2">
                    {tagCounts.map(({ name, value }) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleTagClick(name)}
                        className={`rounded-full px-2.5 py-1 transition-apple focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900 ${getSizeClass(value, maxTagCount)} ${
                          selectedTag === name
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 hover:scale-105 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {selectedTag && (
                    <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                      当前筛选：{selectedTag}（共 {totalPosts} 篇）
                      <button
                        type="button"
                        onClick={() => handleTagClick(selectedTag)}
                        className="ml-2 rounded underline transition-apple hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                      >
                        取消
                      </button>
                    </p>
                  )}
                </section>
              )}

              {/* 日记列表：流式滚动 */}
              <section className="entries-page-fade-in space-y-4 pt-5 text-sm">
                {loading && (
                  <p className="px-3 text-xs text-zinc-500 dark:text-zinc-400">
                    加载中…
                  </p>
                )}
                {!loading && currentEntries.length === 0 && (
                  <p className="px-3 text-xs text-zinc-500 dark:text-zinc-400">
                    暂无文章
                  </p>
                )}
                {!loading &&
                  currentEntries.map((item) => (
                    <EntryCard
                      key={item.id}
                      item={item}
                      authorName={profile?.name ?? "DailyRhapsody"}
                      avatarSrc={profile?.avatar ?? "/avatar.png"}
                      canEdit={isAdminSession}
                    />
                  ))}
                {hasMore && !loading && <div ref={sentinelRef} className="h-4" aria-hidden />}
                {loadingMore && (
                  <div className="flex justify-center py-6" role="status" aria-label="加载中">
                    <svg
                      className="h-6 w-6 animate-spin text-zinc-400 dark:text-zinc-500"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="32 24"
                      />
                    </svg>
                  </div>
                )}
              </section>

              {/* 彩蛋 */}
              {totalPosts > 0 && !hasMore && (eggPullY > 0 || isRebounding) && (
                <div className="pt-8 pb-10 text-center" role="status" aria-live="polite">
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    被你发现了 ✨
                  </span>
                </div>
              )}
              {totalPosts > 0 && !hasMore && (
                <div className="h-[140px] shrink-0" aria-hidden />
              )}
            </>
          ) : (
            <GalleryTab
              timeline={galleryTimeline}
              loading={galleryLoading}
              hasMore={galleryHasMore}
              loadingMore={galleryLoadingMore}
              sentinelRef={gallerySentinelRef}
              onOpenLightbox={(lb) => setLightbox(lb)}
            />
          )}
          </div>
          </div>
        </main>
      </div>

      <MomentLightbox
        key={lightbox?.lbKey ?? "closed"}
        open={lightbox != null}
        urls={lightbox?.urls ?? []}
        index={lightbox?.i ?? 0}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}
