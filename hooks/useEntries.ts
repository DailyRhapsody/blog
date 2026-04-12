"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { PAGE_SIZE } from "@/components/entries/utils";
import type { Diary } from "@/components/entries/types";

type DiariesResponse = {
  items?: Diary[];
  total?: number;
  tagCounts?: { name: string; value: number }[];
  dates?: string[];
};

export type UseEntriesState = {
  /** 当前已加载的文章列表 */
  items: Diary[];
  /** 后端返回的总篇数（用于「篇文章」卡片 + 是否还有下一页判定） */
  total: number;
  /** 标签词云数据，按出现次数倒序 */
  tagCounts: { name: string; value: number }[];
  /** 首屏 / 切标签时的 loading；分页 append 时不会拉起这个 */
  loading: boolean;
  /** 分页 append loading */
  loadingMore: boolean;
  /** 是否还有下一页（items.length < total） */
  hasMore: boolean;
  /** 当前最大 tag 计数，用于词云字号映射 */
  maxTagCount: number;
  /** 后端返回的所有有发文的日期，用于日历热力图 */
  datesWithPosts: Set<string>;
  /** 本月发文篇数（来自 datesWithPosts） */
  thisMonthPostCount: number;
  /** 文章列表底部的 sentinel，挂在 IntersectionObserver 上做无限滚动 */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * 文章列表 + 标签 + 热力图所需的全部数据层。
 *
 * 会做四件事：
 * 1. 首屏加载：组件挂载或 selectedTag 切换时拉首页
 * 2. 无限滚动：sentinel 进入视窗时 append 下一页
 * 3. hash 深链：URL 带 #entry-123 时如果文章不在当前页就一直翻页直到拉到（或翻完）
 * 4. 把 dates / tagCounts 派生成 datesWithPosts / thisMonthPostCount / maxTagCount
 *
 * 之前这些状态、callback、4 个 effect 全在 entries page 里和彩蛋、tab 切换、滚动同步混在
 * 一起；抽出来后调用方只需要 `const { items, ... } = useEntries(selectedTag)` 一行。
 */
export function useEntries(selectedTag: string | null): UseEntriesState {
  const [items, setItems] = useState<Diary[]>([]);
  const [total, setTotal] = useState(0);
  const [tagCounts, setTagCounts] = useState<{ name: string; value: number }[]>([]);
  const [datesFromApi, setDatesFromApi] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  /** 防止「无限滚动 observer」与「hash 深链补页」同时触发同一 offset 的重复 append */
  const appendInFlightRef = useRef(false);

  const hasMore = items.length < total && total > 0;

  const datesWithPosts = useMemo(() => new Set(datesFromApi), [datesFromApi]);
  const thisMonthPostCount = useMemo(() => {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let count = 0;
    datesWithPosts.forEach((d) => {
      if (d.startsWith(prefix)) count++;
    });
    return count;
  }, [datesWithPosts]);
  const maxTagCount = tagCounts[0]?.value ?? 1;

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
        .then((data: DiariesResponse) => {
          const list = Array.isArray(data.items) ? data.items : [];
          if (append) setItems((prev) => [...prev, ...list]);
          else setItems(list);
          if (typeof data.total === "number") setTotal(data.total);
          if (Array.isArray(data.tagCounts)) setTagCounts(data.tagCounts);
          if (Array.isArray(data.dates)) setDatesFromApi(data.dates);
        });
    },
    [],
  );

  /* ── 首屏 / selectedTag 切换：从头拉一页 ── */
  useEffect(() => {
    setLoading(true);
    loadPage(0, false, selectedTag)
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [selectedTag, loadPage]);

  /* ── hash 深链 #entry-N：如果目标文章不在当前已加载列表里，就 append 下一页 ── */
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
    const targetId = anchor.slice("entry-".length);
    if (!targetId) return;
    const inList = items.some((d) => d.id === targetId);
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
    if (!hasMore || loadingMore || appendInFlightRef.current) return;
    appendInFlightRef.current = true;
    setLoadingMore(true);
    loadPage(items.length, true, selectedTag)
      .catch(() => {})
      .finally(() => {
        appendInFlightRef.current = false;
        setLoadingMore(false);
      });
  }, [loading, items, total, hasMore, loadingMore, selectedTag, loadPage]);

  /* ── 无限滚动：sentinel 进视窗就 append ── */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (
          !entries[0]?.isIntersecting ||
          loadingMore ||
          appendInFlightRef.current
        )
          return;
        appendInFlightRef.current = true;
        setLoadingMore(true);
        const offset = items.length;
        loadPage(offset, true, selectedTag)
          .catch(() => {})
          .finally(() => {
            appendInFlightRef.current = false;
            setLoadingMore(false);
          });
      },
      { rootMargin: "200px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, loadingMore, items.length, selectedTag, loadPage]);

  return {
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
  };
}
