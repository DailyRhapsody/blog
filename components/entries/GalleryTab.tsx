"use client";

import { type RefObject } from "react";
import { formatMomentRelative } from "@/lib/moment-relative";
import { GalleryVideoCell } from "./GalleryVideoCell";
import { galleryGridClass } from "./utils";
import type { GalleryTimelineRow } from "./types";

export type GalleryLightboxOpen = {
  urls: string[];
  i: number;
  lbKey: string;
};

export function GalleryTab({
  timeline,
  loading,
  hasMore,
  loadingMore,
  sentinelRef,
  onOpenLightbox,
}: {
  timeline: GalleryTimelineRow[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  sentinelRef: RefObject<HTMLDivElement | null>;
  onOpenLightbox: (lb: GalleryLightboxOpen) => void;
}) {
  return (
    <section className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
      {loading && timeline.length === 0 && (
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
      {!loading && timeline.length === 0 && (
        <p className="px-4 py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
          暂无内容
        </p>
      )}
      {timeline.map((row) => {
        const m = row.moment;
        const sorted = [...m.media].sort((a, b) => a.sortOrder - b.sortOrder);
        const urls = sorted.map((x) => x.url);

        if (m.type === 2 && sorted[0]) {
          return (
            <article
              key={row.rowKey}
              className="border-b border-zinc-100 px-3 py-4 dark:border-zinc-800/50 sm:px-4"
            >
              <p className="mb-2 text-[13px] leading-none text-zinc-400 dark:text-zinc-500">
                {formatMomentRelative(m.createdAt)}
              </p>
              <div className="overflow-hidden rounded bg-black">
                <GalleryVideoCell
                  src={sorted[0].url}
                  posterUrl={sorted[0].thumbUrl || undefined}
                />
              </div>
            </article>
          );
        }

        if (sorted.length === 0) return null;
        const n = sorted.length;
        return (
          <article
            key={row.rowKey}
            className="border-b border-zinc-100 px-3 py-4 dark:border-zinc-800/50 sm:px-4"
          >
            <p className="mb-2 text-[13px] leading-none text-zinc-400 dark:text-zinc-500">
              {formatMomentRelative(m.createdAt)}
            </p>
            <div className={`grid ${galleryGridClass(n)} ${n <= 1 ? "" : "gap-0.5"}`}>
              {sorted.map((media, idx) => (
                <button
                  key={`${media.url}-${idx}`}
                  type="button"
                  className={`relative w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800 ${
                    n === 1 ? "aspect-auto max-h-[min(72vh,640px)]" : "aspect-square"
                  }`}
                  onClick={() =>
                    onOpenLightbox({ urls, i: idx, lbKey: `${row.rowKey}-${idx}` })
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={media.thumbUrl || media.url}
                    alt=""
                    className={`absolute inset-0 h-full w-full ${
                      n === 1 ? "object-contain" : "object-cover"
                    }`}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ))}
            </div>
          </article>
        );
      })}
      {hasMore && <div ref={sentinelRef} className="h-8" aria-hidden />}
      {loadingMore && (
        <div className="flex justify-center py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
        </div>
      )}
    </section>
  );
}
