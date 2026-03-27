import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getDiaries, saveDiaries, nextId, type Diary } from "@/lib/diaries-store";
import { allDiaries } from "@/app/diaries.data";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { extractHashtagsFromMarkdown } from "@/lib/hashtags";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

function getTagCounts(diaries: Diary[]): { name: string; value: number }[] {
  const count = new Map<string, number>();
  for (const d of diaries) {
    for (const t of d.tags ?? []) {
      count.set(t, (count.get(t) ?? 0) + 1);
    }
  }
  return Array.from(count.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export async function GET(req: Request) {
  const blocked = await guardApiRequest(req, {
    scope: "diaries:list",
    limit: 90,
    windowMs: 60_000,
  });
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit");

  const diaries = await getDiaries(allDiaries);
  const admin = await isAdmin();
  diaries.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (
      new Date(b.publishedAt ?? b.date).getTime() -
      new Date(a.publishedAt ?? a.date).getTime()
    );
  });

  if (limitParam == null || limitParam === "") {
    if (!admin) {
      const limit = DEFAULT_PAGE_SIZE;
      const items = diaries.slice(0, limit);
      const body = {
        items,
        total: diaries.length,
        hasMore: diaries.length > items.length,
        tagCounts: getTagCounts(diaries),
        dates: [...new Set(diaries.map((d) => d.date))],
      };
      return withAntiScrapeHeaders(NextResponse.json(body));
    }
    return withAntiScrapeHeaders(NextResponse.json(diaries));
  }

  const limit = Math.min(
    Math.max(1, Number(limitParam) || DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
  const tag = searchParams.get("tag") ?? undefined;
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  let filtered = tag
    ? diaries.filter((d) => (d.tags ?? []).includes(tag))
    : diaries;
  if (q) {
    filtered = filtered.filter((d) => {
      const text = [d.summary ?? "", d.location ?? "", (d.tags ?? []).join(" ")].join(" ");
      return text.toLowerCase().includes(q);
    });
  }
  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);

  const hasMore = offset + items.length < total;

  const body: {
    items: Diary[];
    total: number;
    hasMore: boolean;
    tagCounts?: { name: string; value: number }[];
    dates?: string[];
  } = { items, total, hasMore };

  if (offset === 0) {
    body.tagCounts = getTagCounts(diaries);
    body.dates = [...new Set(diaries.map((d) => d.date))];
  }

  return withAntiScrapeHeaders(NextResponse.json(body));
}

export async function POST(req: Request) {
  try {
    const badOrigin = rejectCrossSiteWrite(req);
    if (badOrigin) return badOrigin;
    const ok = await isAdmin();
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    let body: { date?: string; summary?: string; location?: string; tags?: string[]; images?: string[]; pinned?: boolean };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const diaries = await getDiaries(allDiaries);
    if (body.pinned) {
      const existing = diaries.find((d) => d.pinned);
      if (existing) {
        return NextResponse.json(
          { error: "已有置顶博客，请先在编辑页取消该篇置顶后再设置本文置顶。" },
          { status: 400 }
        );
      }
    }
    const id = nextId(diaries);
    const summary = body.summary ?? "";
    const newDiary: Diary = {
      id,
      date: body.date ?? new Date().toISOString().slice(0, 10),
      pinned: !!body.pinned,
      summary,
      location: body.location?.trim() || "",
      tags: extractHashtagsFromMarkdown(summary),
      images: Array.isArray(body.images) ? body.images : [],
    };
    diaries.unshift(newDiary);
    diaries.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (
        new Date(b.publishedAt ?? b.date).getTime() -
        new Date(a.publishedAt ?? a.date).getTime()
      );
    });
    await saveDiaries(diaries);
    return NextResponse.json(newDiary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
