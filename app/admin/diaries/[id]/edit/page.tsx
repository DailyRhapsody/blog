"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import ImageUpload from "../../../ImageUpload";
import LocationPicker from "../../../LocationPicker";
import MarkdownEditor from "../../../MarkdownEditor";

async function readApiError(res: Response, fallback: string) {
  try {
    const data = await res.json();
    return data?.error ?? fallback;
  } catch {
    try {
      const text = await res.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}

export default function EditDiaryPage() {
  const params = useParams();
  const id = params.id as string;
  const [date, setDate] = useState("");
  const [summary, setSummary] = useState("");
  const [location, setLocation] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/diaries/${id}`);
        if (!res.ok) {
          setError("文章不存在");
          return;
        }
        const d = await res.json();
        setDate(d.date ?? "");
        setSummary(d.summary ?? "");
        setLocation(d.location ?? "");
        setImages(Array.isArray(d.images) ? d.images : []);
        setPinned(!!d.pinned);
      } finally {
        setFetchLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    let success = false;
    try {
      const res = await fetch(`/api/diaries/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, summary, location, images, pinned }),
      });
      if (!res.ok) {
        const message = await readApiError(res, "保存失败");
        setError(message);
        return;
      }
      success = true;
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
    if (success) {
      router.push("/admin");
      router.refresh();
    }
  }

  if (fetchLoading) {
    return <p className="text-zinc-500">加载中…</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/admin"
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
        >
          ← 返回列表
        </Link>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          编辑文章
        </h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            发布到博客（支持 Markdown）
          </label>
          <MarkdownEditor
            value={summary}
            onChange={setSummary}
            rows={14}
            placeholder="Notion 式 Markdown：`# ` / `## ` 标题；`#标签` 无空格。整行 #标签 + Enter 续标签。Shift+Enter 普通换行"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            日期
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full max-w-xs rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            定位
          </label>
          <div className="mt-1">
            <LocationPicker value={location} onChange={setLocation} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            图片（可多张）
          </label>
          <div className="mt-1">
            <ImageUpload value={images} onChange={setImages} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="pinned"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
          />
          <label htmlFor="pinned" className="text-sm text-zinc-700 dark:text-zinc-300">
            置顶本文（最多一篇，若已有置顶需先取消该篇置顶）
          </label>
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {loading ? "保存中…" : "保存"}
          </button>
          <Link
            href="/admin"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            取消
          </Link>
        </div>
      </form>
    </div>
  );
}
