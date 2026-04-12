"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { PublicMoment } from "@/components/entries/types";

const PAGE_LIMIT = 8;
/** 提前 240px 触发加载下一页，避免动态滚动到底再 stall */
const SCROLL_ROOT_MARGIN = "240px";

export type UseMomentsState = {
  moments: PublicMoment[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * 拉 /api/moments 的分页 + 无限滚动逻辑。
 *
 * - 组件挂载时立刻拉首页（不论当前在哪个 tab，因为 entries 顶部缩略卡也要用 moments 数据）。
 * - 后续 IntersectionObserver 只在 active=true（即用户当前正看着动态 tab）时挂上，
 *   否则白白浪费一个 observer 持有 DOM 引用。
 *
 * 把这一坨从 page.tsx 抽出来主要是因为：state、ref、callback、两个 effect 互相耦合，
 * 留在 page 里会和文章列表 / tab 切换 / 彩蛋 / hash 深链等 7 个 effect 全部混在一个作用域。
 */
export function useMoments({ active }: { active: boolean }): UseMomentsState {
  const [moments, setMoments] = useState<PublicMoment[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadLock = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(async (fromOffset: number, replace: boolean) => {
    if (replace) {
      setLoading(true);
    } else {
      // 防止 observer 在 setLoadingMore 还没 flush 时把同一 offset 又触发一次
      if (loadLock.current) return;
      loadLock.current = true;
      setLoadingMore(true);
    }
    try {
      const res = await fetchWithTimeout(
        `/api/moments?limit=${PAGE_LIMIT}&offset=${fromOffset}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (replace) setMoments([]);
        setHasMore(false);
        return;
      }
      const next: PublicMoment[] = Array.isArray(data.items) ? data.items : [];
      setHasMore(!!data.hasMore);
      setOffset(typeof data.nextOffset === "number" ? data.nextOffset : fromOffset + next.length);
      if (replace) setMoments(next);
      else setMoments((prev) => [...prev, ...next]);
    } catch {
      if (replace) setMoments([]);
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      if (!replace) loadLock.current = false;
    }
  }, []);

  /* gate 就绪时重加载 */
  const [gateGen, setGateGen] = useState(0);
  useEffect(() => {
    const onGateReady = () => setGateGen((g) => g + 1);
    window.addEventListener("dr-gate-ready", onGateReady);
    return () => window.removeEventListener("dr-gate-ready", onGateReady);
  }, []);

  /* 首次拉取 + gate 就绪后重拉 */
  useEffect(() => {
    void loadPage(0, true);
  }, [loadPage, gateGen]);

  /* 无限滚动：仅在动态 tab 激活时挂 IntersectionObserver */
  useEffect(() => {
    if (!active) return;
    const el = sentinelRef.current;
    if (!el || !hasMore || loading || loadingMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingMore) return;
        void loadPage(offset, false);
      },
      { rootMargin: SCROLL_ROOT_MARGIN, threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [active, hasMore, loading, loadingMore, offset, loadPage]);

  return { moments, hasMore, loading, loadingMore, sentinelRef };
}
