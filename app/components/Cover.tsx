"use client";

import Image from "next/image";
import Link from "next/link";

export default function Cover() {
  return (
    <header className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-zinc-900">
      {/* 背景图 */}
      <div className="absolute inset-0">
        <Image
          src="/cover.png"
          alt=""
          fill
          className="object-cover"
          priority
          sizes="100vw"
        />
        <div
          className="absolute inset-0 bg-black/40"
          aria-hidden
        />
      </div>

      {/* 标题 + 导航 */}
      <div className="relative z-10 flex flex-col items-center px-4 text-white">
        <h1 className="text-center text-5xl font-semibold tracking-tight drop-shadow-lg sm:text-7xl md:text-8xl">
          DailyRhapsody
        </h1>
        <p className="mt-4 text-sm tracking-[0.2em] opacity-90 sm:text-base">
          I think, therefore I am.
        </p>
        <nav className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm tracking-wide">
          <Link
            href="/entries"
            className="transition-opacity duration-200 ease-out hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent rounded"
          >
            博客
          </Link>
          <span className="text-white/50" aria-hidden>·</span>
          <Link
            href="/about"
            className="transition-opacity duration-200 ease-out hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent rounded"
          >
            关于
          </Link>
          <span className="text-white/50" aria-hidden>·</span>
          <Link
            href="/gallery"
            className="transition-opacity duration-200 ease-out hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent rounded"
          >
            画廊
          </Link>
        </nav>
      </div>

      {/* 进入博客列表 - 苹果风：带圈、透明背景、细边框 */}
      <Link
        href="/entries"
        className="absolute bottom-8 left-1/2 z-10 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-white/40 bg-transparent text-white/80 transition-all duration-200 ease-out hover:scale-105 hover:border-white/70 hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent"
        aria-label="进入博客列表"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </Link>
    </header>
  );
}
