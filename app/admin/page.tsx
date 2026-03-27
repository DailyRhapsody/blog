"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDate12h } from "@/lib/format";
import Pagination from "../components/Pagination";
import ImageUpload from "./ImageUpload";

type Diary = {
  id: number;
  date: string;
  publishedAt?: string;
  summary: string;
  location?: string;
  tags?: string[];
  pinned?: boolean;
};

type Profile = {
  name: string;
  signature: string;
  avatar: string;
  location: string;
  industry: string;
  zodiac: string;
  headerBg: string;
};

const PAGE_SIZE = 20;
const MAX_SUMMARY_LINES = 5;

function AdminSummary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand =
    text.split(/\n/).length > MAX_SUMMARY_LINES || text.length > 280;
  return (
    <div>
      <p
        className={`whitespace-pre-line text-[0.82rem] leading-relaxed text-zinc-600 dark:text-zinc-400 ${
          expanded ? "" : "line-clamp-6"
        }`}
      >
        {text}
      </p>
      {needsExpand && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[0.75rem] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
}

function AdminCard({
  d,
  onRemove,
}: {
  d: Diary;
  onRemove: (id: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const timeStr = formatDate12h(d.publishedAt ?? d.date + "T12:00:00");

  return (
    <article className="group relative flex flex-col gap-3 rounded-2xl px-3 py-4 transition-apple hover:bg-zinc-100/70 hover:shadow-md dark:hover:bg-zinc-900/80 dark:hover:shadow-black/10">
      <div className="flex items-start gap-3">
        <div className="min-h-10 flex min-w-0 flex-1 flex-col justify-center">
          <p className="text-[0.75rem] text-zinc-500 dark:text-zinc-400">
            {timeStr}
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            aria-label="更多"
          >
            <svg
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="6" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="18" r="1.5" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                aria-hidden="true"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[6rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                <Link
                  href={`/admin/diaries/${d.id}/edit`}
                  className="block w-full px-3 py-2 text-left text-[0.8rem] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => setMenuOpen(false)}
                >
                  编辑
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove(d.id);
                  }}
                  className="w-full px-3 py-2 text-left text-[0.8rem] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {d.pinned && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          置顶
        </span>
      )}
      <AdminSummary text={d.summary || ""} />
      <div className="flex items-center justify-between gap-2">
        {(d.tags ?? []).length > 0 ? (
          <div className="min-w-0 flex flex-wrap gap-1">
            {(d.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="rounded bg-zinc-200/80 px-1.5 py-0.5 text-[0.65rem] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <div />
        )}
        {d.location && (
          <span className="max-w-[48%] shrink-0 truncate text-right text-[0.72rem] text-zinc-500 dark:text-zinc-400">
            📍 {d.location}
          </span>
        )}
      </div>
    </article>
  );
}

export default function AdminPage() {
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [total, setTotal] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string>("");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  const load = useCallback(
    (pageNum: number = page, q: string = searchQuery) => {
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((pageNum - 1) * PAGE_SIZE),
      });
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/diaries?${params}`)
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        })
        .then((data: { items?: Diary[]; total?: number }) => {
          setDiaries(Array.isArray(data.items) ? data.items : []);
          setTotal(typeof data.total === "number" ? data.total : 0);
        })
        .catch(() => {
          setDiaries([]);
          setTotal(0);
        })
        .finally(() => setLoading(false));
    },
    [page, searchQuery]
  );

  useEffect(() => {
    load(page, searchQuery);
  }, [page]);

  useEffect(() => {
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setProfile(data ?? null))
      .catch(() => setProfile(null));
  }, []);

  const handleSearch = useCallback(() => {
    setPage(1);
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: "0",
    });
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    fetch(`/api/diaries?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data: { items?: Diary[]; total?: number }) => {
        setDiaries(Array.isArray(data.items) ? data.items : []);
        setTotal(typeof data.total === "number" ? data.total : 0);
      })
      .catch(() => {
        setDiaries([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [searchQuery]);

  async function seed() {
    if (!confirm("将用静态数据覆盖当前存储中的文章，确定继续？")) return;
    setSeedLoading(true);
    setSeedMessage("");
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSeedMessage(data?.error ?? "初始化失败");
        return;
      }
      const count = typeof data?.count === "number" ? data.count : 0;
      setSeedMessage(`初始化成功，共导入 ${count} 篇`);
      setPage(1);
      load(1, searchQuery);
    } catch {
      setSeedMessage("初始化失败：网络或服务异常");
    } finally {
      setSeedLoading(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("确定删除这篇？")) return;
    const res = await fetch(`/api/diaries/${id}`, { method: "DELETE" });
    if (res.ok) load(page, searchQuery);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileDraft) return;
    setProfileSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileDraft),
      });
      if (res.ok) {
        setProfile(await res.json());
        setProfileEditing(false);
        setProfileDraft(null);
      }
    } finally {
      setProfileSaving(false);
    }
  }

  function startEditProfile() {
    if (!profile) return;
    setProfileDraft(profile);
    setProfileEditing(true);
  }

  function cancelEditProfile() {
    setProfileEditing(false);
    setProfileDraft(null);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* 个人信息 */}
      {profile && (
        <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              个人信息（博客顶部展示）
            </h2>
            {!profileEditing && (
              <button
                type="button"
                onClick={startEditProfile}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                编辑资料
              </button>
            )}
          </div>

          {!profileEditing && (
            <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              <p><span className="mr-2 text-zinc-500 dark:text-zinc-400">姓名</span>{profile.name || "-"}</p>
              <p><span className="mr-2 text-zinc-500 dark:text-zinc-400">签名</span>{profile.signature || "-"}</p>
              <p><span className="mr-2 text-zinc-500 dark:text-zinc-400">位置</span>{profile.location || "-"}</p>
              <p><span className="mr-2 text-zinc-500 dark:text-zinc-400">行业</span>{profile.industry || "-"}</p>
              <p><span className="mr-2 text-zinc-500 dark:text-zinc-400">星座</span>{profile.zodiac || "-"}</p>
            </div>
          )}

          {profileEditing && profileDraft && (
            <form onSubmit={saveProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">姓名</label>
                <input
                  type="text"
                  value={profileDraft.name}
                  onChange={(e) => setProfileDraft((p) => (p ? { ...p, name: e.target.value } : p))}
                  className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">签名</label>
                <input
                  type="text"
                  value={profileDraft.signature}
                  onChange={(e) => setProfileDraft((p) => (p ? { ...p, signature: e.target.value } : p))}
                  placeholder="君子论迹不论心"
                  className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">头像</label>
                <div className="mt-1">
                  <ImageUpload
                    value={profileDraft.avatar ? [profileDraft.avatar] : []}
                    onChange={(urls) => setProfileDraft((p) => (p ? { ...p, avatar: urls[0] ?? "" } : p))}
                    maxCount={1}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">位置</label>
                <input
                  type="text"
                  value={profileDraft.location}
                  onChange={(e) => setProfileDraft((p) => (p ? { ...p, location: e.target.value } : p))}
                  placeholder="杭州"
                  className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">行业</label>
                <input
                  type="text"
                  value={profileDraft.industry}
                  onChange={(e) => setProfileDraft((p) => (p ? { ...p, industry: e.target.value } : p))}
                  placeholder="计算机硬件行业"
                  className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">星座</label>
                <input
                  type="text"
                  value={profileDraft.zodiac}
                  onChange={(e) => setProfileDraft((p) => (p ? { ...p, zodiac: e.target.value } : p))}
                  placeholder="天秤座"
                  className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">顶部背景图</label>
                <div className="mt-1">
                  <ImageUpload
                    value={profileDraft.headerBg ? [profileDraft.headerBg] : []}
                    onChange={(urls) => setProfileDraft((p) => (p ? { ...p, headerBg: urls[0] ?? "" } : p))}
                    maxCount={1}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {profileSaving ? "保存中…" : "保存个人信息"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditProfile}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  取消
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          文章列表（共 {total} 篇）
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={seed}
            disabled={seedLoading}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {seedLoading ? "初始化中…" : "仅首次初始化"}
          </button>
          <Link
            href="/admin/diaries/new"
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            新建
          </Link>
        </div>
      </div>
      {seedMessage && (
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">{seedMessage}</p>
      )}

      {/* 文章内容模糊搜索 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜索正文、标签…"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        <button
          type="button"
          onClick={handleSearch}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          搜索
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500">加载中…</p>
      ) : (
        <>
          <ul className="entries-page-fade-in space-y-4">
            {diaries.map((d) => (
              <li key={d.id}>
                <AdminCard d={d} onRemove={remove} />
              </li>
            ))}
          </ul>
          {diaries.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-500">暂无文章</p>
          )}

          {/* 翻页：与之前浏览页一致组件 */}
          {total > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalPosts={total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
