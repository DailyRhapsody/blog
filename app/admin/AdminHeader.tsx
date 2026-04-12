"use client";

import Link from "next/link";

export default function AdminHeader() {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link href="/admin" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          DailyRhapsody 后台
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/gallery"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
          >
            动态
          </Link>
          <Link
            href="/admin/analytics"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
          >
            流量
          </Link>
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
          >
            前台
          </Link>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
          >
            退出
          </button>
        </div>
      </div>
    </header>
  );
}
