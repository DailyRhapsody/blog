"use client";

import { useState } from "react";

/** 动态视频懒加载：默认只渲染缩略图占位 + 播放图标，
 *  避免 iOS Safari 在 mount `<video>` + 加载元数据时抢占音频会话，
 *  从而中断 StickyProfileHeader 里正在播放的背景音乐。
 *  用户点击后才插入真正的 <video> 并自动播放。 */
export function MomentsVideoCell({
  src,
  posterUrl,
}: {
  src: string;
  posterUrl?: string;
}) {
  const [activated, setActivated] = useState(false);
  if (activated) {
    return (
      <video
        src={src}
        poster={posterUrl}
        className="max-h-[min(70vh,520px)] w-full object-contain"
        controls
        playsInline
        autoPlay
        muted
        preload="metadata"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setActivated(true)}
      className="relative block w-full"
      aria-label="播放视频"
    >
      {posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterUrl}
          alt=""
          className="max-h-[min(70vh,520px)] w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-zinc-900" />
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
