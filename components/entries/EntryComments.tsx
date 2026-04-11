"use client";

import { useEffect, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { Comment } from "./types";

export function EntryComments({
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
    fetchWithTimeout(`/api/diaries/${diaryId}/comments`)
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
      const res = await fetchWithTimeout(`/api/diaries/${diaryId}/comments`, {
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
