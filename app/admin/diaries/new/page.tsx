"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ImageUpload from "../../ImageUpload";
import TagInput from "../../TagInput";
import LocationPicker from "../../LocationPicker";

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

export default function NewDiaryPage() {
  const [date, setDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [summary, setSummary] = useState("");
  const [location, setLocation] = useState("");
  const [tagsStr, setTagsStr] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const tags = tagsStr
      .split(/[,，、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    let success = false;
    try {
      const res = await fetch("/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, summary, location, tags, images, pinned }),
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
          新建文章
        </h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            发布到博客
          </label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={12}
            placeholder="写点什么…"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
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
            图片（可多张，用于 THE MOMENT 与博客列表展示）
          </label>
          <div className="mt-1">
            <ImageUpload value={images} onChange={setImages} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            标签
          </label>
          <div className="mt-1">
            <TagInput value={tagsStr} onChange={setTagsStr} />
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
            发布时置顶（最多一篇，若已有置顶需先取消该篇）
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
