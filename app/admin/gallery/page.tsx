"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type MediaItem = { url: string; mediaType: string; duration?: number };

type AdminMoment = {
  id: number;
  type: 1 | 2;
  createdAt: string;
  updatedAt?: string;
  status: number;
  media: {
    url: string;
    thumbUrl: string;
    mediaType: string;
    width: number;
    height: number;
    duration: number;
    sortOrder: number;
  }[];
};

async function uploadFiles(files: FileList | File[]): Promise<{ url: string; mediaType: string }[]> {
  const formData = new FormData();
  const arr = Array.from(files);
  for (const f of arr) formData.append("files", f);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "上传失败");
  const urls: string[] = Array.isArray(data.urls) ? data.urls : [];
  if (urls.length !== arr.length) {
    throw new Error("上传返回数量异常，请重试或检查文件格式");
  }
  const out: { url: string; mediaType: string }[] = [];
  for (let i = 0; i < urls.length; i++) {
    out.push({ url: urls[i]!, mediaType: arr[i]?.type ?? "image/jpeg" });
  }
  return out;
}

export default function AdminMomentsPage() {
  const [mode, setMode] = useState<1 | 2>(1);
  const [imageItems, setImageItems] = useState<MediaItem[]>([]);
  const [videoItem, setVideoItem] = useState<MediaItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [list, setList] = useState<AdminMoment[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetch("/api/admin/moments?limit=100&offset=0", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setList(data.items);
      else setList([]);
    } catch {
      setList([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  function resetForm() {
    setImageItems([]);
    setVideoItem(null);
    setEditingId(null);
    setError("");
  }

  async function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setError("");
    setUploading(true);
    try {
      const next = await uploadFiles(files);
      setImageItems((prev) =>
        [...prev, ...next.map((x) => ({ url: x.url, mediaType: x.mediaType }))].slice(0, 9)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function onPickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.[0]) return;
    setError("");
    setUploading(true);
    try {
      const next = await uploadFiles([files[0]!]);
      const one = next[0];
      if (one) setVideoItem({ url: one.url, mediaType: one.mediaType });
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function onDropZone(modeDrop: 1 | 2, e: React.DragEvent) {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    if (modeDrop === 1) {
      const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imgs.length) void (async () => {
        setUploading(true);
        setError("");
        try {
          const next = await uploadFiles(imgs);
          setImageItems((prev) =>
            [...prev, ...next.map((x) => ({ url: x.url, mediaType: x.mediaType }))].slice(0, 9)
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "上传失败");
        } finally {
          setUploading(false);
        }
      })();
    } else {
      const v = Array.from(files).find((f) => f.type.startsWith("video/"));
      if (v)
        void (async () => {
          setUploading(true);
          setError("");
          try {
            const next = await uploadFiles([v]);
            const one = next[0];
            if (one) setVideoItem({ url: one.url, mediaType: one.mediaType });
          } catch (err) {
            setError(err instanceof Error ? err.message : "上传失败");
          } finally {
            setUploading(false);
          }
        })();
    }
  }

  function moveImage(i: number, dir: -1 | 1) {
    setImageItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  async function submitPublish() {
    setError("");
    const type = mode;
    const media =
      type === 1
        ? imageItems.map((m, i) => ({
            url: m.url,
            thumbUrl: m.url,
            mediaType: m.mediaType,
            sortOrder: i,
          }))
        : videoItem
          ? [
              {
                url: videoItem.url,
                thumbUrl: videoItem.url,
                mediaType: videoItem.mediaType,
                duration: videoItem.duration ?? 0,
                sortOrder: 0,
              },
            ]
          : [];

    if (type === 1 && media.length === 0) {
      setError("请至少上传一张图片");
      return;
    }
    if (type === 2 && !videoItem) {
      setError("请上传一个视频");
      return;
    }

    try {
      const url = editingId != null ? `/api/moments/${editingId}` : "/api/moments";
      const method = editingId != null ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type, media }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "发布失败");
        return;
      }
      resetForm();
      setMode(1);
      await loadList();
    } catch {
      setError("网络错误");
    }
  }

  function startEdit(m: AdminMoment) {
    if (m.status !== 1) return;
    setEditingId(m.id);
    setMode(m.type);
    if (m.type === 1) {
      setImageItems(
        [...m.media]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((x) => ({ url: x.url, mediaType: x.mediaType }))
      );
      setVideoItem(null);
    } else {
      const v = m.media[0];
      setVideoItem(v ? { url: v.url, mediaType: v.mediaType, duration: v.duration } : null);
      setImageItems([]);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeMoment(id: number) {
    if (!confirm("确定删除这条动态？不可恢复。")) return;
    const res = await fetch(`/api/moments/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) await loadList();
    else alert("删除失败");
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">画廊</h1>
        <Link href="/admin" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← 返回
        </Link>
      </div>

      <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {editingId != null ? `编辑动态 #${editingId}` : "发布新动态"}
        </h2>

        <div className="mt-4 flex gap-6 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="momentMode"
              checked={mode === 1}
              onChange={() => {
                setMode(1);
                setVideoItem(null);
              }}
            />
            图片
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="momentMode"
              checked={mode === 2}
              onChange={() => {
                setMode(2);
                setImageItems([]);
              }}
            />
            视频
          </label>
        </div>

        {mode === 1 && (
          <div
            className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-6 dark:border-zinc-600 dark:bg-zinc-800/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDropZone(1, e)}
          >
            <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
              拖拽图片到此处，或点击选择（最多 9 张）
            </p>
            <label className="mt-3 flex cursor-pointer justify-center">
              <span className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
                {uploading ? "上传中…" : "选择图片"}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={onPickImages}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              {imageItems.map((it, i) => (
                <div
                  key={it.url}
                  className="relative h-24 w-24 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <Image src={it.url} alt="" fill className="object-cover" unoptimized sizes="96px" />
                  <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-0.5 bg-black/50 py-0.5">
                    <button
                      type="button"
                      className="px-1 text-[10px] text-white disabled:opacity-30"
                      disabled={i === 0}
                      onClick={() => moveImage(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="px-1 text-[10px] text-white disabled:opacity-30"
                      disabled={i === imageItems.length - 1}
                      onClick={() => moveImage(i, 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                    onClick={() => setImageItems((p) => p.filter((_, j) => j !== i))}
                    aria-label="移除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 2 && (
          <div
            className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-6 dark:border-zinc-600 dark:bg-zinc-800/40"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDropZone(2, e)}
          >
            <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
              拖拽视频到此处，或点击选择（单个）
            </p>
            <label className="mt-3 flex cursor-pointer justify-center">
              <span className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
                {uploading ? "上传中…" : "选择视频"}
              </span>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                disabled={uploading}
                onChange={onPickVideo}
              />
            </label>
            {videoItem && (
              <div className="mt-4 max-w-md">
                <video
                  src={videoItem.url}
                  className="max-h-48 w-full rounded-lg bg-black"
                  controls
                  muted
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration;
                    if (Number.isFinite(d))
                      setVideoItem((v) => (v ? { ...v, duration: Math.round(d) } : null));
                  }}
                />
                <button
                  type="button"
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                  onClick={() => setVideoItem(null)}
                >
                  移除视频
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void submitPublish()}
            className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {editingId != null ? "保存修改" : "发布"}
          </button>
          {editingId != null && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
            >
              取消编辑
            </button>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">全部动态</h2>
        {listLoading ? (
          <p className="text-sm text-zinc-500">加载中…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-zinc-500">暂无动态</p>
        ) : (
          <ul className="space-y-3">
            {list.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 px-3 py-3 dark:border-zinc-700"
              >
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                  {m.media[0] &&
                    (m.type === 2 ? (
                      <video
                        src={m.media[0].url}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                        aria-hidden
                      />
                    ) : (
                      <Image
                        src={m.media[0].thumbUrl}
                        alt=""
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ))}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    #{m.id} · {m.type === 1 ? `图片 ×${m.media.length}` : "视频"}
                    {m.status === 0 && (
                      <span className="ml-2 text-xs text-zinc-500">已删除</span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500">{new Date(m.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  {m.status === 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeMoment(m.id)}
                        className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 dark:border-red-900"
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
