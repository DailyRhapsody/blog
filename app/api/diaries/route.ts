import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getDiaries, saveDiaries, nextId, type Diary } from "@/lib/diaries-store";
import { allDiaries } from "@/app/diaries.data";

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
  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit");

  const diaries = await getDiaries(allDiaries);

  if (limitParam == null || limitParam === "") {
    diaries.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (
        new Date(b.publishedAt ?? b.date).getTime() -
        new Date(a.publishedAt ?? a.date).getTime()
      );
    });
    return NextResponse.json(diaries);
  }

  diaries.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (
      new Date(b.publishedAt ?? b.date).getTime() -
      new Date(a.publishedAt ?? a.date).getTime()
    );
  });

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
      const text = [d.summary ?? "", (d.tags ?? []).join(" ")].join(" ");
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

  return NextResponse.json(body);
}

export async function POST(req: Request) {
  try {
    const ok = await isAdmin();
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    let body: { date?: string; summary?: string; tags?: string[]; images?: string[]; pinned?: boolean };
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
    const newDiary: Diary = {
      id,
      date: body.date ?? new Date().toISOString().slice(0, 10),
      pinned: !!body.pinned,
      summary: body.summary ?? "",
      tags: Array.isArray(body.tags) ? body.tags : [],
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
