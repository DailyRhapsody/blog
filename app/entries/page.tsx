"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { formatDate12h } from "@/lib/format";
import { markdownPreviewProseClass, renderMarkdown } from "@/lib/markdown";
import { createShareCardElement } from "@/lib/share-card";

type Diary = {
  id: number;
  date: string;
  publishedAt?: string;
  summary: string;
  location?: string;
  tags?: string[];
  images?: string[];
};

type Comment = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
};

const PAGE_SIZE = 30;

function legacyCopyTextToClipboard(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

type Profile = {
  name: string;
  signature: string;
  avatar: string;
  location: string;
  industry: string;
  zodiac: string;
  headerBg: string;
};

function getSizeClass(count: number, maxCount: number) {
  if (maxCount <= 0) return "text-xs";
  const r = count / maxCount;
  if (r >= 0.7) return "text-base sm:text-lg";
  if (r >= 0.4) return "text-sm sm:text-base";
  if (r >= 0.2) return "text-xs sm:text-sm";
  return "text-[0.65rem] sm:text-xs";
}

function DefaultAvatar({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const sizeClass = className ?? "h-10 w-10";
  if (failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-zinc-300 text-xs font-medium text-zinc-600 dark:bg-zinc-600 dark:text-zinc-300 ${sizeClass}`}
        aria-hidden
      >
        滕
      </div>
    );
  }
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700 ${sizeClass}`}
      aria-hidden
    >
      <Image
        src={src || "/avatar.png"}
        alt=""
        width={40}
        height={40}
        unoptimized
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

const MAX_SUMMARY_LINES = 5;

/** 本月日历热力图：仅方块，始终当前月，有发布的日期高亮；列顺序为周一至周日 */
const CalendarHeatmap = memo(function CalendarHeatmap({ datesWithPosts }: { datesWithPosts: Set<string> }) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);
  const startWeekday = firstDay.getDay();
  /** 首列对应周一：JS getDay 0=周日 → 周一占位索引为 (d+6)%7 */
  const leadingBlanks = (startWeekday + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) week.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  function toDateKey(day: number) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return (
    <div
      className="inline-grid h-[148px] grid-cols-7 gap-1 rounded-xl border border-zinc-200 bg-white/80 p-2.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-800/80"
      style={{ width: "min(100%, 168px)" }}
    >
      {weeks.flat().map((day, i) =>
        day === null ? (
          <div key={`e-${i}`} className="h-[18px] w-[18px] rounded-[4px] bg-zinc-100 dark:bg-zinc-700/60" />
        ) : (
          <div
            key={day}
            className={`h-[18px] w-[18px] rounded-[4px] transition-colors ${
              datesWithPosts.has(toDateKey(day))
                ? "bg-emerald-300/70 dark:bg-emerald-400/50"
                : "bg-zinc-200 dark:bg-zinc-600/80"
            }`}
            title={`${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}${datesWithPosts.has(toDateKey(day)) ? " 有发布" : ""}`}
          />
        )
      )}
    </div>
  );
});

function EntrySummary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = text.split(/\n/).length > MAX_SUMMARY_LINES || text.length > 280;
  const rendered = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div>
      <div
        className={`${markdownPreviewProseClass} text-[0.82rem] leading-relaxed ${
          expanded ? "" : "max-h-36 overflow-hidden"
        }`}
      >
        <div
          className="space-y-[1.15em]"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      </div>
      {needsExpand && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[0.75rem] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
}

function EntryComments({
  diaryId,
  open,
  onOpenChange,
}: {
  diaryId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/diaries/${diaryId}/comments`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => setComments(Array.isArray(data) ? data : []))
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  }, [diaryId, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const a = author.trim().slice(0, 64) || "匿名";
    const c = content.trim().slice(0, 2000);
    if (!c) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/diaries/${diaryId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: a, content: c }),
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as Comment | null;
      if (data?.id) setComments((prev) => [...prev, data]);
      setContent("");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/30">
      <div className="flex items-center justify-between">
        <span className="text-[0.75rem] text-zinc-500">评论</span>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="text-[0.75rem] text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-400"
        >
          收起（{comments.length}）
        </button>
      </div>
      {loading && <p className="text-xs text-zinc-500">加载中…</p>}
      {!loading && comments.length === 0 && (
        <p className="text-xs text-zinc-500">暂无评论</p>
      )}
      {!loading &&
        comments.map((c) => (
          <div key={c.id} className="text-[0.8rem]">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {c.author}
            </span>
            <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">
              {new Date(c.createdAt).toLocaleString("zh-CN", { hour12: false })}
            </span>
            <p className="mt-0.5 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
              {c.content}
            </p>
          </div>
        ))}
      <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
        <input
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="昵称（可选）"
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-[0.8rem] dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="写一条评论…"
          rows={2}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-[0.8rem] dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
          required
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-fit rounded bg-zinc-800 px-3 py-1 text-[0.8rem] text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {submitting ? "发送中…" : "发送"}
        </button>
      </form>
    </div>
  );
}

function EntryCard({
  item,
  authorName,
  avatarSrc,
  canEdit,
}: {
  item: Diary;
  authorName: string;
  avatarSrc: string;
  canEdit: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharePreviewSrc, setSharePreviewSrc] = useState<string | null>(null);
  const [shareModalError, setShareModalError] = useState<string | null>(null);
  const [copyLinkHint, setCopyLinkHint] = useState<"ok" | "fail" | null>(null);
  const copyLinkHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareUrlRef = useRef("");

  const closeShareModal = useCallback(() => {
    setShareModalOpen(false);
    setSharePreviewSrc(null);
    setShareModalError(null);
    setCopyLinkHint(null);
    if (copyLinkHintTimerRef.current) {
      clearTimeout(copyLinkHintTimerRef.current);
      copyLinkHintTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!shareModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeShareModal();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [shareModalOpen, closeShareModal]);

  async function copyShareUrl(shareUrl: string) {
    const trimmed = shareUrl.trim();
    if (copyLinkHintTimerRef.current) {
      clearTimeout(copyLinkHintTimerRef.current);
      copyLinkHintTimerRef.current = null;
    }
    if (!trimmed) {
      setCopyLinkHint("fail");
      copyLinkHintTimerRef.current = setTimeout(() => setCopyLinkHint(null), 2600);
      return;
    }
    let ok = false;
    try {
      await navigator.clipboard.writeText(trimmed);
      ok = true;
    } catch {
      ok = legacyCopyTextToClipboard(trimmed);
      if (!ok) window.prompt("复制以下链接分享：", trimmed);
    }
    setCopyLinkHint(ok ? "ok" : "fail");
    copyLinkHintTimerRef.current = setTimeout(() => setCopyLinkHint(null), 2600);
  }

  async function openShareImageModal() {
    if (typeof window === "undefined") return;
    const shareUrl = `${window.location.origin}${window.location.pathname}#entry-${item.id}`;
    shareUrlRef.current = shareUrl;
    setMenuOpen(false);
    setShareModalOpen(true);
    setSharePreviewSrc(null);
    setShareModalError(null);
    setSharing(true);

    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:-9999px;top:0;overflow:visible;opacity:1;pointer-events:none;z-index:-1";

    const card = createShareCardElement({
      summary: item.summary,
      date: item.date,
      publishedAt: item.publishedAt,
      entryId: item.id,
      authorName,
      tags: item.tags,
    });
    host.appendChild(card);
    document.body.appendChild(host);

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(card, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: "#F7F8FA",
      });
      setSharePreviewSrc(canvas.toDataURL("image/png", 0.95));
    } catch (err) {
      if ((err as Error).name !== "AbortError") console.error(err);
      setShareModalError("生成图片失败，请稍后重试");
    } finally {
      host.remove();
      setSharing(false);
    }
  }

  async function shareImageFromPreview() {
    const src = sharePreviewSrc;
    if (!src) return;
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const file = new File([blob], "DailyRhapsody.png", { type: "image/png" });
      const shareUrl = shareUrlRef.current;
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "DailyRhapsody",
          text: "分享自 DailyRhapsody",
          url: shareUrl,
        });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") await copyShareUrl(shareUrlRef.current);
    }
  }

  function downloadShareImage() {
    if (!sharePreviewSrc) return;
    const a = document.createElement("a");
    a.href = sharePreviewSrc;
    a.download = "DailyRhapsody.png";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function handleShare() {
    if (sharing) return;
    if (typeof window === "undefined") return;
    void openShareImageModal();
  }

  const timeStr = formatDate12h(
    item.publishedAt ?? item.date + "T12:00:00"
  );
  const locationMapUrl = item.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location)}`
    : "";

  return (
    <>
    <article
      id={`entry-${item.id}`}
      className="group relative flex flex-col gap-3 rounded-2xl px-3 py-4 transition-apple scroll-mt-24 hover:bg-zinc-100/70 hover:shadow-md dark:hover:bg-zinc-900/80 dark:hover:shadow-black/10"
    >
      <div className="flex items-start gap-3">
        <DefaultAvatar src={avatarSrc} className="h-10 w-10 shrink-0" />
                    <div className="min-h-10 flex min-w-0 flex-1 flex-col justify-center">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {authorName}
                      </p>
          <p className="text-[0.75rem] text-zinc-500 dark:text-zinc-400">
            {timeStr}
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            aria-label="更多"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                aria-hidden="true"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[6rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {canEdit && (
                  <Link
                    href={`/admin/diaries/${item.id}/edit`}
                    className="block w-full px-3 py-2 text-left text-[0.8rem] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    onClick={() => setMenuOpen(false)}
                  >
                    编辑
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCommentsOpen(true);
                    setMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-[0.8rem] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  评论
                </button>
                <button
                  type="button"
                  onClick={() => handleShare()}
                  disabled={sharing}
                  className="w-full px-3 py-2 text-left text-[0.8rem] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {sharing ? "生成中…" : "分享"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {(item.images ?? []).length > 0 && (
        <div className="flex gap-1 overflow-hidden rounded-xl">
          {(item.images ?? []).slice(0, 3).map((src) => (
            <div
              key={src}
              className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800 sm:h-20 sm:w-20"
            >
              <Image
                src={src}
                alt=""
                fill
                className="object-cover"
                sizes="96px"
              />
            </div>
          ))}
        </div>
      )}
      <EntrySummary text={item.summary} />
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          {(item.tags ?? []).length > 0 ? (
            <div className="min-w-0 flex flex-wrap gap-1">
              {(item.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-zinc-200/80 px-1.5 py-0.5 text-[0.65rem] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <div />
          )}
          {item.location && (
            <a
              href={locationMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[48%] shrink-0 truncate text-right text-[0.72rem] text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
              title={`在地图中打开：${item.location}`}
            >
              📍 {item.location}
            </a>
          )}
        </div>
        <EntryComments
          diaryId={item.id}
          open={commentsOpen}
          onOpenChange={setCommentsOpen}
        />
      </div>
    </article>

    {shareModalOpen &&
      typeof document !== "undefined" &&
      createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 z-0 cursor-default border-0 bg-transparent"
            aria-label="关闭浮层"
            onClick={closeShareModal}
          />
          <div
            className="relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900 dark:ring-1 dark:ring-zinc-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <h2
                id="share-modal-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
              >
                生成分享图片
              </h2>
              <button
                type="button"
                onClick={closeShareModal}
                className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="关闭"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex min-h-[120px] flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-4">
              {sharing && !sharePreviewSrc && !shareModalError && (
                <div className="flex flex-col items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <svg
                    className="h-8 w-8 animate-spin text-zinc-400"
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
                  <span>正在生成…</span>
                </div>
              )}
              {shareModalError && (
                <p className="text-center text-sm text-red-600 dark:text-red-400">{shareModalError}</p>
              )}
              {sharePreviewSrc && (
                // data URL 预览，不用 next/image
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sharePreviewSrc}
                  alt="分享卡片预览"
                  className="max-h-[min(60vh,520px)] max-w-full select-none rounded-lg shadow-md"
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <button
                type="button"
                onClick={downloadShareImage}
                disabled={!sharePreviewSrc}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                下载图片
              </button>
              {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                <button
                  type="button"
                  onClick={() => void shareImageFromPreview()}
                  disabled={!sharePreviewSrc}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  系统分享…
                </button>
              )}
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyShareUrl(shareUrlRef.current)}
                  className="rounded-lg px-3 py-2 text-xs text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                >
                  复制文章链接
                </button>
                {copyLinkHint === "ok" && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">已复制</span>
                )}
                {copyLinkHint === "fail" && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    未能复制，请用弹窗里的链接或浏览器权限允许剪贴板
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default function EntriesPage() {
  const [items, setItems] = useState<Diary[]>([]);
  const [total, setTotal] = useState(0);
  const [tagCounts, setTagCounts] = useState<{ name: string; value: number }[]>([]);
  const [datesFromApi, setDatesFromApi] = useState<string[]>([]);
  const [galleryThumbs, setGalleryThumbs] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdminSession, setIsAdminSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [entriesFlipped, setEntriesFlipped] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [eggPullY, setEggPullY] = useState(0);
  const [isRebounding, setIsRebounding] = useState(false);
  const [isReturnToTopAnimating, setIsReturnToTopAnimating] = useState(false);
  const [returnToTopProgress, setReturnToTopProgress] = useState<number | null>(null);
  const [headerExpandProgress, setHeaderExpandProgress] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const returnToTopPhaseRef = useRef<0 | 1 | 2>(0);
  const returnToTopRafRef = useRef<number>(0);
  const returnToTopProgressRef = useRef<number>(0);
  const headerExpandProgressRef = useRef<number>(0);
  const eggPullAccumRef = useRef(0);
  const eggReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchLastYRef = useRef(0);
  const hasMoreRef = useRef(true);
  const totalPostsRef = useRef(0);
  /** 防止无限滚动与 hash 深链同时触发同一 offset 的重复 append */
  const listAppendInFlightRef = useRef(false);

  const datesWithPosts = useMemo(() => new Set(datesFromApi), [datesFromApi]);
  const totalPosts = total;
  const currentEntries = items;
  const hasMore = items.length < total && total > 0;
  const maxTagCount = tagCounts[0]?.value ?? 1;

  useEffect(() => {
    hasMoreRef.current = hasMore;
    totalPostsRef.current = totalPosts;
  }, [hasMore, totalPosts]);

  useEffect(() => {
    fetch("/api/gallery")
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
      })
      .catch(() => setGalleryThumbs([]));
  }, []);

  const runReturnToTop = useCallback(() => {
    if (typeof window === "undefined" || !contentWrapperRef.current) return;
    const startY = window.scrollY;
    if (startY <= 0) return;

    returnToTopPhaseRef.current = 1;
    returnToTopProgressRef.current = 0;
    setScrollY(startY);
    setIsReturnToTopAnimating(true);
    setReturnToTopProgress(0);
    document.body.style.overflow = "hidden";

    const duration = Math.min(3000, 600 + 320 * Math.log(1 + startY / 300));
    const startT = performance.now();
    const el = contentWrapperRef.current;
    // 强 ease-out，末尾更慢，避免最后一段显得突然加速
    function easeOutQuart(x: number) {
      return 1 - (1 - x) ** 4;
    }
    function tick(now: number) {
      const elapsed = now - startT;
      const t = Math.min(elapsed / duration, 1);
      const progress = easeOutQuart(t);
      const offset = startY * (1 - progress);
      if (el.style) {
        el.style.willChange = "transform";
        el.style.transform = `translateY(-${offset}px)`;
      }
      returnToTopProgressRef.current = t;
      setReturnToTopProgress(t);
      if (t < 1) {
        returnToTopRafRef.current = requestAnimationFrame(tick);
      } else {
        el.style.willChange = "";
        el.style.transform = "";
        document.body.style.overflow = "";
        setIsReturnToTopAnimating(false);
        returnToTopProgressRef.current = 0;
        setReturnToTopProgress(null);
        setScrollY(0);
        window.scrollTo(0, 0);
        // 到顶后用与回顶相同的 easeOutQuart 曲线展开 header，时长略短以延续「到达」感
        const expandDuration = Math.min(420, 200 + duration * 0.2);
        const expandStartT = performance.now();
        headerExpandProgressRef.current = 0;
        setHeaderExpandProgress(0);
        function expandTick(now: number) {
          const elapsed = now - expandStartT;
          const u = Math.min(elapsed / expandDuration, 1);
          const eased = easeOutQuart(u);
          headerExpandProgressRef.current = eased;
          setHeaderExpandProgress(eased);
          if (u < 1) {
            returnToTopRafRef.current = requestAnimationFrame(expandTick);
          } else {
            setHeaderExpandProgress(null);
            headerExpandProgressRef.current = 0;
            returnToTopPhaseRef.current = 0;
          }
        }
        returnToTopRafRef.current = requestAnimationFrame(expandTick);
      }
    }
    requestAnimationFrame(() => {
      returnToTopRafRef.current = requestAnimationFrame(tick);
    });
  }, []);

  useEffect(() => {
    function onScroll() {
      if (returnToTopPhaseRef.current !== 0) return;
      const y = typeof window !== "undefined" ? window.scrollY : 0;
      setScrollY(y);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (returnToTopRafRef.current) cancelAnimationFrame(returnToTopRafRef.current);
    };
  }, []);

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
      return fetch(`/api/diaries?${params}`)
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
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProfile(data ?? null))
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    fetch("/api/auth/session")
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
      eggPullAccumRef.current = Math.min(
        MAX_EGG_PULL,
        eggPullAccumRef.current + Math.abs(e.deltaY)
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
      <div className="entries-flip-wrapper">
        <main
          id="entries"
          className={`entries-flip-panel mx-auto flex max-w-3xl flex-col pb-8 ${entriesFlipped ? "entries-flip-visible" : ""}`}
        >
          {/* 顶部 profile：随滚动逐渐收缩，收缩后固定、头像与姓名居中 */}
          {(() => {
            const HEADER_EXPANDED = 260;
            const HEADER_COLLAPSED = 56;
            const threshold = HEADER_EXPANDED - HEADER_COLLAPSED;
            const COLLAPSE_AT = threshold + 10;
            const nearTop = scrollY < 28;
            const isReturning = isReturnToTopAnimating || returnToTopProgress !== null;
            const isHeaderExpanding = headerExpandProgress !== null;
            const expandProgress = isHeaderExpanding ? (headerExpandProgress ?? 0) : 0;
            // 回顶过程中 header 保持收缩；到顶后按与回顶相同的 easeOutQuart 曲线展开
            const height =
              isHeaderExpanding
                ? HEADER_COLLAPSED + (HEADER_EXPANDED - HEADER_COLLAPSED) * expandProgress
                : isReturning
                  ? HEADER_COLLAPSED
                  : nearTop
                    ? HEADER_EXPANDED
                    : Math.max(HEADER_COLLAPSED, HEADER_EXPANDED - scrollY);
            let isCollapsed: boolean;
            if (isHeaderExpanding) {
              isCollapsed = expandProgress < 1;
            } else if (isReturning) {
              isCollapsed = true;
            } else {
              isCollapsed = scrollY >= COLLAPSE_AT;
            }
            return (
              <header
                className={`sticky top-0 z-30 w-full overflow-hidden rounded-b-2xl bg-gradient-to-b from-zinc-900 via-zinc-800 to-black transition-[height] ease-out ${
                  isReturning || isHeaderExpanding ? "duration-0" : "duration-250"
                }`}
                style={{
                  height: `${height}px`,
                }}
              >
                <div
                  className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                  style={{
                    backgroundImage: `url(${profile?.headerBg || "/header-bg.png"})`,
                  }}
                />
                <div className="absolute inset-0 bg-black/50" />
                {isCollapsed && !isReturning && !isHeaderExpanding && (
                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-pointer"
                    onClick={() => {
                      returnToTopPhaseRef.current = 1;
                      runReturnToTop();
                    }}
                    aria-label="回到顶部并展开"
                  />
                )}
                <div className="relative flex h-full w-full flex-col justify-center px-5">
                  {/* 收缩时：头像+名称从下边缘往上渐显，并在栏内上下居中 */}
                  <div
                    className={`absolute inset-0 flex items-center justify-center px-5 ${
                      isCollapsed ? "pointer-events-auto" : "pointer-events-none"
                    }`}
                  >
                    <div
                      className={`flex transition-[transform,opacity] duration-250 ease-out ${
                        isCollapsed ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                      }`}
                    >
                      <Link
                        href="/"
                        className="flex items-center gap-2"
                      >
                        <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border-2 border-white/80 ring-2 ring-white/20">
                          <Image
                            src={profile?.avatar || "/avatar.png"}
                            alt=""
                            width={28}
                            height={28}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                        <p className="whitespace-nowrap text-base font-bold text-white">
                          {profile?.name ?? "DailyRhapsody"}
                        </p>
                      </Link>
                    </div>
                  </div>
                  {/* 展开时：整块内容；收起时头像+名称向下渐隐 */}
                  <div
                    className={`min-w-0 flex-1 transition-[transform,opacity] duration-250 ease-out ${
                      isCollapsed
                        ? "translate-y-1 opacity-0 pointer-events-none"
                        : "flex flex-col justify-center translate-y-0 opacity-100"
                    }`}
                  >
                    <Link
                      href="/"
                      className="flex items-center gap-4"
                    >
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-white/80 ring-2 ring-white/20">
                        <Image
                          src={profile?.avatar || "/avatar.png"}
                          alt=""
                          width={64}
                          height={64}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                      <p className="text-lg font-bold text-white whitespace-nowrap">
                        {profile?.name ?? "DailyRhapsody"}
                      </p>
                    </Link>
                    <p className="mt-4 text-xs text-white/80">
                      {profile?.signature ?? "君子论迹不论心"}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {[
                        profile?.location ?? "杭州",
                        profile?.industry ?? "计算机硬件行业",
                        profile?.zodiac ?? "天秤座",
                      ]
                        .filter(Boolean)
                        .map((tag) => (
                          <span
                            key={tag}
                            className="rounded-lg bg-white/20 px-2 py-0.5 text-[0.7rem] text-white backdrop-blur-sm"
                          >
                            {tag}
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              </header>
            );
          })()}

          <div
            ref={contentWrapperRef}
            style={{
              transform: isReturnToTopAnimating
                ? undefined
                : !hasMore && (eggPullY > 0 || isRebounding)
                  ? `translate3d(0, -${eggPullY}px, 0)`
                  : undefined,
              willChange:
                isReturnToTopAnimating || (!hasMore && eggPullY > 0 && !isRebounding)
                  ? "transform"
                  : undefined,
              paddingBottom: !hasMore && (eggPullY > 0 || isRebounding) ? eggPullY + 88 : 0,
            }}
            className={!hasMore && isRebounding ? "rebound-transition" : ""}
          >
          <div className="px-4 pt-5">
          {/* 顶部功能区：日历热力图（左）+ 画廊入口（右）；contain 减轻回顶滚动时重绘 */}
          <div className="mb-5 flex flex-wrap items-start gap-6 [contain:layout_paint]">
            <CalendarHeatmap datesWithPosts={datesWithPosts} />
            <Link
              href="/gallery"
              aria-label="打开画廊"
              className="inline-grid h-[148px] rounded-xl border border-zinc-200 bg-white/80 p-2.5 shadow-sm transition-apple hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800/80"
              style={{ width: "min(100%, 168px)" }}
            >
              <div className="grid h-full w-full">
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
              </div>
            </Link>
          </div>

          {/* 标签词云 */}
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
          <section className="entries-page-fade-in space-y-4 border-t border-zinc-200 pt-5 text-sm dark:border-zinc-800">
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

          {/* 彩蛋：仅当流式加载全部展示完毕（滑完所有博客）后，出现在最底部；仅文字，与正文平滑过渡 */}
          {totalPosts > 0 && !hasMore && (eggPullY > 0 || isRebounding) && (
            <div className="pt-8 pb-10 text-center" role="status" aria-live="polite">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                被你发现了 ✨
              </span>
            </div>
          )}
          </div>
          </div>
        </main>
      </div>
    </div>
  );
}
