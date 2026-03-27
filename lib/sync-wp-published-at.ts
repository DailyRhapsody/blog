import { allDiaries } from "@/app/diaries.data";
import { getDiaries, saveDiaries, type Diary } from "@/lib/diaries-store";

const SITE = "dailyrhapsody.data.blog";
const PER_PAGE = 100;
const API_BASE = `https://public-api.wordpress.com/wp/v2/sites/${SITE}`;

export type SyncWpPublishedAtResult = {
  wpPostCount: number;
  localCount: number;
  matched: number;
  changed: number;
  previews: string[];
  applied: boolean;
};

type WpTime = { date: string; publishedAt: string };

function dateGmtToIso(dateGmt: string | undefined): string | null {
  if (!dateGmt || typeof dateGmt !== "string") return null;
  const norm = dateGmt.includes("T")
    ? dateGmt
    : dateGmt.trim().replace(" ", "T");
  const withZ = /[zZ]$|[+-][0-9]{2}:?[0-9]{2}$/.test(norm) ? norm : `${norm}Z`;
  const d = new Date(withZ);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchAllWpPosts(): Promise<
  { id: number; date?: string; date_gmt?: string }[]
> {
  const all: { id: number; date?: string; date_gmt?: string }[] = [];
  let page = 1;
  while (page <= 10) {
    const url = `${API_BASE}/posts?per_page=${PER_PAGE}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) break;
      throw new Error(`WordPress posts ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const row of data) {
      if (row && typeof row === "object" && "id" in row) {
        const id = (row as { id: unknown }).id;
        if (typeof id === "number") {
          all.push(row as { id: number; date?: string; date_gmt?: string });
        }
      }
    }
    if (data.length < PER_PAGE) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 600));
  }
  return all;
}

function wpPostsToTimeMap(
  posts: { id: number; date?: string; date_gmt?: string }[]
): Map<number, WpTime> {
  const map = new Map<number, WpTime>();
  for (const post of posts) {
    const publishedAt = dateGmtToIso(post.date_gmt);
    const rawDate = typeof post.date === "string" ? post.date : "";
    const date = rawDate.length >= 10 ? rawDate.slice(0, 10) : null;
    if (publishedAt && date) map.set(post.id, { date, publishedAt });
  }
  return map;
}

/**
 * 从 dailyrhapsody.data.blog 拉取各篇发布时间，按 WordPress 文章 id 与本地 diary.id 对齐并可选写回存储。
 */
export async function runSyncWpPublishedAt(
  apply: boolean
): Promise<SyncWpPublishedAtResult> {
  const posts = await fetchAllWpPosts();
  const timeMap = wpPostsToTimeMap(posts);
  const diaries = await getDiaries(allDiaries);

  let matched = 0;
  let changed = 0;
  const previews: string[] = [];

  for (const d of diaries) {
    const wp = timeMap.get(d.id);
    if (!wp) continue;
    matched += 1;
    const same = d.publishedAt === wp.publishedAt && d.date === wp.date;
    if (!same) {
      changed += 1;
      if (previews.length < 50) {
        previews.push(
          `id ${d.id}: date ${d.date} → ${wp.date}; publishedAt ${d.publishedAt ?? "(无)"} → ${wp.publishedAt}`
        );
      }
    }
    if (apply) {
      d.date = wp.date;
      d.publishedAt = wp.publishedAt;
    }
  }

  if (apply && changed > 0) {
    await saveDiaries(diaries);
  }

  return {
    wpPostCount: posts.length,
    localCount: diaries.length,
    matched,
    changed,
    previews,
    applied: apply && changed > 0,
  };
}
