"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RainbowBrushTrail from "@/components/RainbowBrushTrail";
import StickyProfileHeader, {
  type StickyProfileHeaderData,
} from "@/components/StickyProfileHeader";
import { formatMomentRelative } from "@/lib/moment-relative";
import { MomentLightbox } from "./MomentLightbox";

type Profile = StickyProfileHeaderData;

type PublicMedia = {
  url: string;
  thumbUrl: string;
  mediaType: string;
  width: number;
  height: number;
  duration: number;
  sortOrder: number;
};

type PublicMoment = {
  id: number;
  type: 1 | 2;
  createdAt: string;
  media: PublicMedia[];
};

type GalleryLegacyItem = {
  id: number;
  createdAt: string;
  isPublic?: boolean;
  images: string[];
};

function useIsAdmin() {
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : { ok: false }))
      .then((d) => setOk(!!d?.ok))
      .catch(() => setOk(false))
      .finally(() => setLoading(false));
  }, []);
  return { ok, loading };
}

function gridClass(n: number) {
  if (n <= 1) return "grid-cols-1";
  if (n <= 4) return "grid-cols-2";
  return "grid-cols-3";
}

function legacyToMoment(g: GalleryLegacyItem): PublicMoment {
  const imgs = (g.images ?? []).filter((u) => typeof u === "string" && u.trim());
  return {
    id: g.id,
    type: 1,
    createdAt: g.createdAt,
    media: imgs.map((url, i) => ({
      url: url.trim(),
      thumbUrl: url.trim(),
      mediaType: "image/jpeg",
      width: 0,
      height: 0,
      duration: 0,
      sortOrder: i,
    })),
  };
}

function MomentCard({
  moment,
  rowKey,
  onImageClick,
}: {
  moment: PublicMoment;
  rowKey: string;
  onImageClick: (urls: string[], i: number, rowKey: string) => void;
}) {
  const sorted = [...moment.media].sort((a, b) => a.sortOrder - b.sortOrder);
  const urls = sorted.map((m) => m.url);

  if (moment.type === 2 && sorted[0]) {
    const v = sorted[0]!;
    return (
      <article className="border-b border-zinc-100 px-3 py-4 dark:border-zinc-800/50 sm:px-4">
        <p className="mb-2 text-[13px] leading-none text-zinc-400 dark:text-zinc-500">
          {formatMomentRelative(moment.createdAt)}
        </p>
        <div className="overflow-hidden rounded bg-black">
          <video
            src={v.url}
            className="max-h-[min(70vh,520px)] w-full object-contain"
            controls
            playsInline
            preload="metadata"
            muted
          />
        </div>
      </article>
    );
  }

  if (sorted.length === 0) return null;

  const n = sorted.length;
  const gap = n <= 1 ? "" : "gap-0.5";

  return (
    <article className="border-b border-zinc-100 px-3 py-4 dark:border-zinc-800/50 sm:px-4">
      <p className="mb-2 text-[13px] leading-none text-zinc-400 dark:text-zinc-500">
        {formatMomentRelative(moment.createdAt)}
      </p>
      <div className={`grid ${gridClass(n)} ${gap}`}>
        {sorted.map((m, idx) => (
          <button
            key={`${m.url}-${idx}`}
            type="button"
            className={`relative w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800 ${
              n === 1 ? "aspect-auto max-h-[min(72vh,640px)]" : "aspect-square"
            }`}
            onClick={() => onImageClick(urls, idx, rowKey)}
          >
            <Image
              src={m.thumbUrl || m.url}
              alt=""
              fill
              className={n === 1 ? "object-contain" : "object-cover"}
              sizes={n === 1 ? "100vw" : "(max-width:768px) 33vw, 240px"}
              loading="lazy"
              unoptimized
            />
          </button>
        ))}
      </div>
    </article>
  );
}

type TimelineRow = { rowKey: string; createdAt: string; moment: PublicMoment };

export default function GalleryPage() {
  const { ok: isAdmin, loading: adminLoading } = useIsAdmin();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [legacyItems, setLegacyItems] = useState<GalleryLegacyItem[]>([]);
  const [momentItems, setMomentItems] = useState<PublicMoment[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    urls: string[];
    i: number;
    lbKey: string;
  } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreLock = useRef(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Profile | null) => setProfile(p))
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    fetch("/api/gallery")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setLegacyItems(Array.isArray(data) ? data : []))
      .catch(() => setLegacyItems([]));
  }, []);

  const loadMomentsPage = useCallback(async (fromOffset: number, replace: boolean) => {
    if (replace) setLoading(true);
    else {
      if (loadMoreLock.current) return;
      loadMoreLock.current = true;
      setLoadingMore(true);
    }
    try {
      const res = await fetch(`/api/moments?limit=8&offset=${fromOffset}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (replace) setMomentItems([]);
        setHasMore(false);
        const hint =
          typeof data.hint === "string"
            ? data.hint
            : typeof data.error === "string"
              ? data.error
              : "加载失败";
        setLoadError((prev) => (replace ? hint : prev));
        return;
      }
      setLoadError(null);
      const next: PublicMoment[] = Array.isArray(data.items) ? data.items : [];
      setHasMore(!!data.hasMore);
      setOffset(typeof data.nextOffset === "number" ? data.nextOffset : fromOffset + next.length);
      if (replace) setMomentItems(next);
      else setMomentItems((prev) => [...prev, ...next]);
    } catch {
      if (replace) {
        setMomentItems([]);
        setLoadError("网络异常，请稍后重试");
      }
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      if (!replace) loadMoreLock.current = false;
    }
  }, []);

  useEffect(() => {
    void loadMomentsPage(0, true);
  }, [loadMomentsPage]);

  const merged = useMemo(() => {
    const legacyVisible = legacyItems.filter((g) => {
      if (!g?.images?.length) return false;
      return isAdmin || g.isPublic !== false;
    });
    const legacyRows: TimelineRow[] = legacyVisible.map((g) => ({
      rowKey: `legacy-${g.id}`,
      createdAt: g.createdAt,
      moment: legacyToMoment(g),
    }));
    const momentRows: TimelineRow[] = momentItems.map((m) => ({
      rowKey: `moment-${m.id}`,
      createdAt: m.createdAt,
      moment: m,
    }));
    return [...legacyRows, ...momentRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [legacyItems, momentItems, isAdmin]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setOffset(0);
    setHasMore(true);
    void fetch("/api/gallery")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setLegacyItems(Array.isArray(data) ? data : []))
      .catch(() => setLegacyItems([]));
    void loadMomentsPage(0, true);
  }, [loadMomentsPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading || loadingMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingMore) return;
        void loadMomentsPage(offset, false);
      },
      { rootMargin: "240px", threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMomentsPage, loading, loadingMore, offset]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-100 to-white font-sans text-zinc-900 dark:from-black dark:via-zinc-950 dark:to-black dark:text-zinc-50">
      <RainbowBrushTrail />
      <main className="mx-auto flex max-w-4xl flex-col pb-8">
        <StickyProfileHeader profile={profile} />

        <div className="bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <Link href="/entries" className="hover:text-zinc-800 dark:hover:text-zinc-200">
              ← 博客
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/" className="hover:text-zinc-800 dark:hover:text-zinc-200">
                首页
              </Link>
              {!adminLoading && isAdmin && (
                <Link
                  href="/admin/gallery"
                  className="hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  管理
                </Link>
              )}
              <button
                type="button"
                onClick={() => refresh()}
                disabled={refreshing}
                className="hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
              >
                {refreshing ? "刷新中…" : "刷新"}
              </button>
            </div>
          </div>
        {loadError && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">画廊内容加载失败</p>
            <p className="mt-1 opacity-90">{loadError}</p>
          </div>
        )}

        {!adminLoading && isAdmin && (
          <div className="border-b border-zinc-200 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            发布图片或视频请使用后台{" "}
            <Link href="/admin/gallery" className="text-zinc-900 underline dark:text-zinc-200">
              画廊
            </Link>
            。
          </div>
        )}

        {loading && merged.length === 0 && (
          <div className="space-y-6 px-4 py-8">
            {[1, 2, 3].map((k) => (
              <div key={k} className="animate-pulse space-y-3">
                <div className="h-3 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="grid grid-cols-3 gap-1">
                  <div className="aspect-square rounded bg-zinc-200 dark:bg-zinc-700" />
                  <div className="aspect-square rounded bg-zinc-200 dark:bg-zinc-700" />
                  <div className="aspect-square rounded bg-zinc-200 dark:bg-zinc-700" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && merged.length === 0 && (
          <p className="px-4 py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
            暂无内容
          </p>
        )}

        {merged.map((row) => (
          <MomentCard
            key={row.rowKey}
            rowKey={row.rowKey}
            moment={row.moment}
            onImageClick={(urls, i, rk) =>
              setLightbox({ urls, i, lbKey: `${rk}-${i}` })
            }
          />
        ))}

        {hasMore && <div ref={sentinelRef} className="h-8" aria-hidden />}

        {loadingMore && (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
          </div>
        )}
        </div>
      </main>

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
