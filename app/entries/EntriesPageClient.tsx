"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import RainbowBrushTrail from "@/components/RainbowBrushTrail";
import StickyProfileHeader from "@/components/StickyProfileHeader";
import { MomentLightbox } from "@/components/entries/MomentLightbox";
import { CalendarHeatmap } from "@/components/entries/CalendarHeatmap";
import { EntryCard } from "@/components/entries/EntryCard";
import { GalleryTab } from "@/components/entries/GalleryTab";
import { getSizeClass, legacyToMoment } from "@/components/entries/utils";
import type { GalleryTimelineRow } from "@/components/entries/types";
import { useProfile, type Profile } from "@/hooks/useProfile";
import { useAdminSession } from "@/hooks/useAdminSession";
import { useGalleryLegacy } from "@/hooks/useGalleryLegacy";
import { useGalleryMoments } from "@/hooks/useGalleryMoments";
import { useTabSwipeNavigation } from "@/hooks/useTabSwipeNavigation";
import { useEntries } from "@/hooks/useEntries";
import { useEggPullToRefresh } from "@/hooks/useEggPullToRefresh";

export default function EntriesPageClient({
  initialProfile,
}: {
  initialProfile: Profile | null;
}) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const {
    items,
    total,
    tagCounts,
    loading,
    loadingMore,
    hasMore,
    maxTagCount,
    datesWithPosts,
    thisMonthPostCount,
    sentinelRef,
  } = useEntries(selectedTag);
  const totalPosts = total;
  const currentEntries = items;

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
  const profile = useProfile(initialProfile);
  const { isAdmin: isAdminSession } = useAdminSession();
  const [entriesFlipped, setEntriesFlipped] = useState(false);
  const [, setScrollYPos] = useState(0);
  /** 彩蛋只有在「最后一页且已有内容」时才允许触发 */
  const { eggPullY, isRebounding } = useEggPullToRefresh(!hasMore && totalPosts > 0);
  const contentWrapperRef = useRef<HTMLDivElement>(null);

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

  /* ── 读取 ?tab=gallery 初始化顶部 tab，让封面 Gallery 链接能直接落到画廊卡上。
       这是「读取一次外部 URL 状态、写回 React 状态」的合法用法，
       react-hooks/set-state-in-effect 的启发式会误报，这里显式关掉。 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "gallery") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTopTab(1);
    }
  }, []);

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

  /* ── 横向滚轮 / 触屏左右滑动切 tab + 屏蔽浏览器自带的左右回退 ── */
  useTabSwipeNavigation(setActiveTopTab, { min: 0, max: 1 });

  const handleTagClick = (tag: string) => {
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
