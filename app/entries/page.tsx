"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import RainbowBrushTrail from "@/components/RainbowBrushTrail";
import StickyProfileHeader from "@/components/StickyProfileHeader";
import { MomentLightbox } from "@/components/entries/MomentLightbox";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { CalendarHeatmap } from "@/components/entries/CalendarHeatmap";
import { EntryCard } from "@/components/entries/EntryCard";
import { GalleryTab } from "@/components/entries/GalleryTab";
import { getSizeClass, legacyToMoment, PAGE_SIZE } from "@/components/entries/utils";
import type {
  Diary,
  GalleryTimelineRow,
} from "@/components/entries/types";
import { useProfile } from "@/hooks/useProfile";
import { useAdminSession } from "@/hooks/useAdminSession";
import { useGalleryLegacy } from "@/hooks/useGalleryLegacy";
import { useGalleryMoments } from "@/hooks/useGalleryMoments";
import { useTabSwipeNavigation } from "@/hooks/useTabSwipeNavigation";
export default function EntriesPage() {
  const [items, setItems] = useState<Diary[]>([]);
  const [total, setTotal] = useState(0);
  const [tagCounts, setTagCounts] = useState<{ name: string; value: number }[]>([]);
  const [datesFromApi, setDatesFromApi] = useState<string[]>([]);
  const { items: galleryLegacy } = useGalleryLegacy();
  const [activeTopTab, setActiveTopTab] = useState(0); // 0=博客, 1=画廊
  const {
    moments: galleryMoments,
    hasMore: galleryHasMore,
    loading: galleryLoading,
    loadingMore: galleryLoadingMore,
    sentinelRef: gallerySentinelRef,
  } = useGalleryMoments({ active: activeTopTab === 1 });
  const [lightbox, setLightbox] = useState<{ urls: string[]; i: number; lbKey: string } | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const profile = useProfile();
  const { isAdmin: isAdminSession } = useAdminSession();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [entriesFlipped, setEntriesFlipped] = useState(false);
  const [, setScrollYPos] = useState(0);
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

  useEffect(() => {
    hasMoreRef.current = hasMore;
    totalPostsRef.current = totalPosts;
  }, [hasMore, totalPosts]);

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

  const galleryThumbs = useMemo(() => {
    // 既要兼容老的 /api/gallery（galleryLegacy），也要展示新的 moments（galleryMoments）。
    // 后台 /admin/gallery 是 POST /api/moments，老的只读 /api/gallery 的话新图永远拉不到。
    // galleryTimeline 已经把两边按时间合并好了，从它取最近 4 张缩略图。
    const imgs: string[] = [];
    const pushIfValid = (raw: unknown) => {
      if (typeof raw !== "string") return;
      const s = raw.trim();
      if (!s) return;
      imgs.push(s);
    };
    for (const row of galleryTimeline) {
      const m = row?.moment;
      if (!m || !Array.isArray(m.media)) continue;
      for (const md of m.media) {
        const isImage = (md?.mediaType ?? "").startsWith("image/");
        // 视频也允许把 thumbUrl 当封面缩略图（视频本身不能 <Image fill> 渲染）
        pushIfValid(md?.thumbUrl || (isImage ? md?.url : ""));
        if (imgs.length >= 4) break;
      }
      if (imgs.length >= 4) break;
    }
    return imgs.slice(0, 4);
  }, [galleryTimeline]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  /* ── 读取 ?tab=gallery 初始化顶部 tab，让封面 Gallery 链接能直接落到画廊卡上 ── */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "gallery") {
      setActiveTopTab(1);
      activeTopTabRef.current = 1;
    }
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
    const t = setTimeout(() => setEntriesFlipped(true), 80);
    return () => clearTimeout(t);
  }, []);

  /* ── 同步 window.scrollY 到本地 state（供其他逻辑使用） ── */
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
    return () => {
      window.removeEventListener("scroll", syncScrollY);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  /* ── activeTopTab ref 同步 ── */
  useEffect(() => { activeTopTabRef.current = activeTopTab; }, [activeTopTab]);

  /* ── 横向滚轮 / 触屏左右滑动切 tab + 屏蔽浏览器自带的左右回退 ── */
  useTabSwipeNavigation(setActiveTopTab, { min: 0, max: 1 });

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
          <div className="entries-top-cards mb-5 -mx-4 flex items-start gap-4 overflow-x-auto px-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {/* 日历热力图：始终显示，无选中态 */}
            <div className="shrink-0">
              <CalendarHeatmap datesWithPosts={datesWithPosts} />
            </div>
            {/* 博客卡片：activeTopTab===0 选中 */}
            <button
              type="button"
              onClick={() => setActiveTopTab(0)}
              className={`inline-flex h-[148px] w-[168px] shrink-0 flex-col items-start justify-center rounded-xl border border-zinc-200 bg-white/80 px-5 shadow-sm transition-apple dark:border-zinc-700 dark:bg-zinc-800/80 ${activeTopTab === 0 ? "ring-2 ring-inset ring-zinc-400 dark:ring-zinc-500" : "opacity-60"}`}
            >
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{totalPosts}</p>
              <p className="text-[0.7rem] text-zinc-500 dark:text-zinc-400">篇文章</p>
              <p className="mt-1.5 text-[0.7rem] text-zinc-400 dark:text-zinc-500">
                本月 {thisMonthPostCount} 篇更新
              </p>
            </button>
            {/* 画廊卡片：activeTopTab===1 选中 */}
            <button
              type="button"
              onClick={() => setActiveTopTab(1)}
              className={`inline-grid h-[148px] w-[168px] shrink-0 rounded-xl border border-zinc-200 bg-white/80 p-2.5 shadow-sm transition-apple dark:border-zinc-700 dark:bg-zinc-800/80 ${activeTopTab === 1 ? "ring-2 ring-inset ring-zinc-400 dark:ring-zinc-500" : "opacity-60"}`}
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
