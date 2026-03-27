"use client";

import { useState } from "react";

/**
 * 与之前浏览页一致的翻页组件：上一页、第 n 页（圆角数字框）、下一页；
 * 布局与样式对齐 d254f47 时的 entries 分页。
 */
export default function Pagination({
  page,
  totalPages,
  totalPosts,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalPosts: number;
  onPageChange: (page: number) => void;
}) {
  function stringifyPage(p: number) {
    return String(Math.max(1, Math.min(totalPages || 1, p)));
  }

  const [inputPage, setInputPage] = useState("");
  const displayPage = inputPage === "" ? stringifyPage(page) : inputPage;

  const applyPageInput = (raw: string) => {
    const target = Number(raw);
    if (!Number.isFinite(target)) {
      setInputPage(String(page));
      return;
    }
    const next = Math.min(Math.max(1, target), totalPages);
    onPageChange(next);
    setInputPage("");
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 text-[0.75rem] text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
      <button
        type="button"
        onClick={() => {
          if (canPrev) {
            onPageChange(page - 1);
          }
        }}
        disabled={!canPrev}
        className="rounded-full border border-zinc-300 px-3 py-1 transition-apple disabled:opacity-40 hover:scale-[1.02] hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:focus:ring-offset-zinc-950"
      >
        上一页
      </button>

      <div className="flex items-center gap-2">
        <span>第</span>
        <input
          type="number"
          min={1}
          max={Math.max(1, totalPages)}
          value={displayPage}
          onChange={(e) => setInputPage(e.target.value)}
          onBlur={() => applyPageInput(displayPage)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyPageInput(displayPage);
            }
          }}
          className="pagination-page-input flex h-7 w-14 items-center justify-center rounded-full border border-zinc-300 bg-transparent px-2 text-center text-[0.8rem] leading-none outline-none transition-apple focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:focus:border-zinc-400"
        />
        <span>
          页
          {totalPages ? ` / 共 ${totalPages} 页` : ""}
          {totalPosts ? ` · 共 ${totalPosts} 篇` : ""}
        </span>
      </div>

      <button
        type="button"
        onClick={() => {
          if (canNext) {
            onPageChange(page + 1);
          }
        }}
        disabled={!canNext}
        className="rounded-full border border-zinc-300 px-3 py-1 transition-apple disabled:opacity-40 hover:scale-[1.02] hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:focus:ring-offset-zinc-950"
      >
        下一页
      </button>
    </div>
  );
}
