"use client";

import Image from "next/image";
import { useState } from "react";

type HomeCoverUploadProps = {
  url: string;
  isVideo: boolean;
  onChange: (url: string, isVideo: boolean) => void;
};

export default function HomeCoverUpload({ url, isVideo, onChange }: HomeCoverUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    const file = files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    const formData = new FormData();
    formData.append("files", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "上传失败");
        return;
      }
      const data = (await res.json()) as { urls?: string[] };
      const newUrl = Array.isArray(data.urls) ? data.urls[0] : "";
      if (!newUrl) {
        setError("未返回文件地址，请确认格式为图片或 MP4/WebM 视频");
        return;
      }
      const video = file.type.startsWith("video/");
      onChange(newUrl, video);
    } catch {
      setError("网络错误");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function clear() {
    onChange("", false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        {url ? (
          <div className="relative h-36 w-full max-w-md overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 dark:border-zinc-700">
            {isVideo ? (
              <video
                src={url}
                className="h-full w-full object-cover"
                muted
                loop
                autoPlay
                playsInline
                controls
              />
            ) : (
              <Image src={url} alt="" fill unoptimized className="object-cover" sizes="(max-width:448px) 100vw, 448px" />
            )}
            <button
              type="button"
              onClick={clear}
              className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs text-white hover:bg-black/80"
            >
              清除（恢复默认）
            </button>
          </div>
        ) : (
          <label className="flex h-36 w-full max-w-md cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 text-zinc-500 transition-colors hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/50 dark:hover:border-zinc-500 dark:hover:bg-zinc-800">
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
              className="hidden"
              disabled={uploading}
              onChange={handleFileSelect}
            />
            {uploading ? (
              <span className="text-sm">上传中…</span>
            ) : (
              <>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">点击上传图片或视频</span>
                <span className="mt-1 text-xs text-zinc-500">JPEG / PNG / GIF / WebP / MP4 / WebM / MOV</span>
              </>
            )}
          </label>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
