"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { formatDate12h } from "@/lib/format";
import {
  clearAdminListRestoreIntent,
  persistAdminListState,
  shouldRestoreAdminList,
  readAdminListState,
} from "@/lib/admin-list-restore";
import { markdownPreviewProseClass, renderMarkdown } from "@/lib/markdown";
import Pagination from "../components/Pagination";
import ImageUpload from "./ImageUpload";

type Diary = {
  id: number;
  date: string;
  publishedAt?: string;
  isPublic?: boolean;
  summary: string;
  location?: string;
  tags?: string[];
  pinned?: boolean;
};

type Profile = {
  name: string;
  signature: string;
  avatar: string;
  headerBg: string;
};

const PAGE_SIZE = 20;
const MAX_SUMMARY_LINES = 5;

function getSizeClass(count: number, maxCount: number) {
  if (maxCount <= 0) return "text-xs";
  const r = count / maxCount;
  if (r >= 0.7) return "text-base sm:text-lg";
  if (r >= 0.4) return "text-sm sm:text-base";
  if (r >= 0.2) return "text-xs sm:text-sm";
  return "text-[0.65rem] sm:text-xs";
}

function AdminSummary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand =
    text.split(/\n/).length > MAX_SUMMARY_LINES || text.length > 280;
  const rendered = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div>
      <div
        className={`${markdownPreviewProseClass} text-[0.82rem] leading-relaxed text-zinc-600 dark:text-zinc-400 ${
          expanded ? "" : "line-clamp-6"
        }`}
      >
        <div
          className="space-y-[1.15em]"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      </div>
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
  onBeforeNavigateToEdit,
}: {
  d: Diary;
  onRemove: (id: number) => void;
  onBeforeNavigateToEdit?: () => void;
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
                  onClick={() => {
                    onBeforeNavigateToEdit?.();
                    setMenuOpen(false);
                  }}
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
      {d.isPublic === false && (
        <span className="w-fit rounded bg-zinc-200/80 px-1.5 py-0.5 text-[0.65rem] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
          私密
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
  const [tagCounts, setTagCounts] = useState<{ name: string; value: number }[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagDeleting, setTagDeleting] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const scrollPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredPageRef = useRef(false);

  const flushListScrollPosition = useCallback(() => {
    persistAdminListState({
      page,
      searchQuery,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
    });
  }, [page, searchQuery]);

  const load = useCallback(
    (pageNum: number = page, q: string = searchQuery) => {
      setLoading(true);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((pageNum - 1) * PAGE_SIZE),
      });
      if (q.trim()) params.set("q", q.trim());
      if (selectedTag) params.set("tag", selectedTag);
      fetch(`/api/diaries?${params}`)
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        })
        .then((data: { items?: Diary[]; total?: number; tagCounts?: { name: string; value: number }[] }) => {
          setDiaries(Array.isArray(data.items) ? data.items : []);
          setTotal(typeof data.total === "number" ? data.total : 0);
          if (Array.isArray(data.tagCounts)) setTagCounts(data.tagCounts);
        })
        .catch(() => {
          setDiaries([]);
          setTotal(0);
        })
        .finally(() => setLoading(false));
    },
    [page, searchQuery, selectedTag]
  );

  useEffect(() => {
    load(page, searchQuery);
  }, [load, page, searchQuery]);

  useLayoutEffect(() => {
    if (restoredPageRef.current) return;
    if (!shouldRestoreAdminList()) return;
    const s = readAdminListState();
    if (!s) return;
    restoredPageRef.current = true;
    setPage(s.page);
    setSearchQuery(s.searchQuery);
  }, []);

  useEffect(() => {
    persistAdminListState({
      page,
      searchQuery,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
    });
  }, [page, searchQuery]);

  useEffect(() => {
    const onScroll = () => {
      if (scrollPersistTimer.current) clearTimeout(scrollPersistTimer.current);
      scrollPersistTimer.current = setTimeout(() => {
        persistAdminListState({
          page,
          searchQuery,
          scrollY: window.scrollY,
        });
      }, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollPersistTimer.current) clearTimeout(scrollPersistTimer.current);
    };
  }, [page, searchQuery]);

  useEffect(() => {
    if (loading) return;
    if (!shouldRestoreAdminList()) return;
    const s = readAdminListState();
    const y = s?.scrollY ?? 0;
    window.scrollTo(0, y);
    requestAnimationFrame(() => window.scrollTo(0, y));
    const t = window.setTimeout(() => clearAdminListRestoreIntent(), 300);
    return () => clearTimeout(t);
  }, [loading]);

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
    if (selectedTag) params.set("tag", selectedTag);
    fetch(`/api/diaries?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data: { items?: Diary[]; total?: number; tagCounts?: { name: string; value: number }[] }) => {
        setDiaries(Array.isArray(data.items) ? data.items : []);
        setTotal(typeof data.total === "number" ? data.total : 0);
        if (Array.isArray(data.tagCounts)) setTagCounts(data.tagCounts);
      })
      .catch(() => {
        setDiaries([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [searchQuery, selectedTag]);

  // 已移除：一次性迁移用的「同步 WordPress 时间」与「仅首次初始化」。

  const maxTagCount = tagCounts[0]?.value ?? 1;
  const handleTagClick = (tag: string) => {
    setPage(1);
    setSelectedTag((prev) => (prev === tag ? null : tag));
  };

  async function deleteTag(tag: string) {
    if (!confirm(`确定删除标签「${tag}」？这会从所有文章正文中移除 #${tag}，不可撤销。`)) return;
    setTagDeleting(tag);
    try {
      const res = await fetch("/api/admin/tags/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        alert(data?.error ?? "删除失败");
        return;
      }
      setSelectedTag((cur) => (cur === tag ? null : cur));
      load(1, searchQuery);
    } catch {
      alert("删除失败：网络或服务异常");
    } finally {
      setTagDeleting(null);
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
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/diaries/new"
            onClick={flushListScrollPosition}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            新建
          </Link>
        </div>
      </div>

      {/* 标签词云：筛选 + 删除标签 */}
      {tagCounts.length > 0 && (
        <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-2">
            {tagCounts.map(({ name, value }) => (
              <div key={name} className="group relative inline-flex items-center">
                <button
                  type="button"
                  onClick={() => handleTagClick(name)}
                  className={`rounded-full px-2.5 py-1 pr-7 transition-apple focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900 ${getSizeClass(value, maxTagCount)} ${
                    selectedTag === name
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 hover:scale-105 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  }`}
                  title={`共 ${value} 篇`}
                >
                  {name}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteTag(name);
                  }}
                  disabled={tagDeleting !== null}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/10 p-1 text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-black/15 disabled:opacity-40 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/15"
                  aria-label={`删除标签 ${name}`}
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {selectedTag && (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              当前筛选：{selectedTag}（共 {total} 篇）
              <button
                type="button"
                onClick={() => handleTagClick(selectedTag)}
                className="ml-2 rounded underline transition-apple hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
              >
                取消
              </button>
            </p>
          )}
          {tagDeleting && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              正在删除标签：{tagDeleting}…
            </p>
          )}
        </section>
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
                <AdminCard
                  d={d}
                  onRemove={remove}
                  onBeforeNavigateToEdit={flushListScrollPosition}
                />
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
