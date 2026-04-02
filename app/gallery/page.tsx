"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { formatDate12h } from "@/lib/format";
import ImageUpload from "@/app/admin/ImageUpload";

type GalleryItem = {
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

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { ok: isAdmin, loading: adminLoading } = useIsAdmin();

  const [newImages, setNewImages] = useState<string[]>([]);
  const [privateOnly, setPrivateOnly] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");

  const canPost = isAdmin && newImages.length > 0 && !posting;

  useEffect(() => {
    fetch("/api/gallery")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const timeline = useMemo(
    () =>
      items
        .filter((x) => x && Array.isArray(x.images) && x.images.length > 0)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [items]
  );

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setPosting(true);
    setPostError("");
    try {
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: newImages,
          isPublic: !privateOnly,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPostError(data?.error ?? "发布失败");
        return;
      }
      setNewImages([]);
      setItems((prev) => [data as GalleryItem, ...prev]);
    } catch {
      setPostError("网络错误");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-100 to-white font-sans text-zinc-900 dark:from-black dark:via-zinc-950 dark:to-black dark:text-zinc-50">
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link
          href="/"
          className="mb-6 inline-block text-sm text-zinc-500 transition-opacity hover:opacity-80 dark:text-zinc-400"
        >
          ← 返回首页
        </Link>

        <p className="text-[0.7rem] uppercase tracking-[0.25em] text-zinc-500 dark:text-zinc-400">
          Gallery
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          画廊
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          历来照片时间线，类似朋友圈。
        </p>

        {!adminLoading && isAdmin && (
          <section className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              发布新的瞬间
            </h2>
            <form onSubmit={handlePost} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  照片
                </label>
                <div className="mt-1">
                  <ImageUpload value={newImages} onChange={setNewImages} maxCount={9} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="galleryPrivateOnly"
                  checked={privateOnly}
                  onChange={(e) => setPrivateOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
                />
                <label htmlFor="galleryPrivateOnly" className="text-sm text-zinc-700 dark:text-zinc-300">
                  仅自己可见
                </label>
              </div>
              {postError && (
                <p className="text-sm text-red-600 dark:text-red-400">{postError}</p>
              )}
              <button
                type="submit"
                disabled={!canPost}
                className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {posting ? "发布中…" : "发布"}
              </button>
            </form>
          </section>
        )}

        {loading && (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">加载中…</p>
        )}
        {!loading && timeline.length === 0 && (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
            暂无照片。
          </p>
        )}

        {!loading && timeline.length > 0 && (
          <div className="mt-6 space-y-6">
            {timeline.map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-apple hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/60"
              >
                <div className="flex flex-col">
                  <div className="relative aspect-[4/3] w-full bg-zinc-100 dark:bg-zinc-800">
                    <Image
                      src={(item.images ?? [])[0]}
                      alt=""
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="(max-width: 672px) 100vw, 672px"
                      priority={false}
                    />
                  </div>
                  {(item.images ?? []).length > 1 && (
                    <div className="flex gap-1 overflow-x-auto p-2">
                      {(item.images ?? []).slice(1, 9).map((src) => (
                        <div
                          key={src}
                          className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800"
                        >
                          <Image
                            src={src}
                            alt=""
                            fill
                            unoptimized
                            className="object-cover"
                            sizes="80px"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatDate12h(item.createdAt)}
                    </div>
                    {isAdmin && item.isPublic === false && (
                      <span className="rounded bg-zinc-200/80 px-1.5 py-0.5 text-[0.65rem] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        私密
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

