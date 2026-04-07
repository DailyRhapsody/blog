"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const [password, setPassword] = useState("");
  /** 默认勾选，登录 Cookie 约 30 天，减少反复输入密码 */
  const [rememberPassword, setRememberPassword] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from") ?? "/admin";
  // 防止开放重定向：只允许站内相对路径
  const from = rawFrom.startsWith("/") && !rawFrom.startsWith("//") ? rawFrom : "/admin";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, remember: rememberPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登录失败");
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
      <form
        method="post"
        action="/admin/login"
        autoComplete="on"
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          管理员登录
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          DailyRhapsody 后台
        </p>
        {/*
          隐藏 username + password 的规范 autocomplete，便于 Chromium / Safari 等保存并在下次登录时自动填充。
          登录接口仍只校验 password，此字段不会参与请求体。
        */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          defaultValue="admin"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <label
          htmlFor="admin-password"
          className="mt-6 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          密码
        </label>
        <input
          id="admin-password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:text-zinc-50 dark:focus:border-zinc-500"
          required
        />
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={rememberPassword}
            onChange={(e) => setRememberPassword(e.target.checked)}
            className="h-4 w-4 shrink-0 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:ring-zinc-500"
          />
          记住密码
        </label>
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {loading ? "登录中…" : "登录"}
        </button>
        <Link
          href="/"
          className="mt-4 block text-center text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
        >
          返回首页
        </Link>
      </form>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-zinc-500">加载中…</div>}>
      <LoginForm />
    </Suspense>
  );
}
