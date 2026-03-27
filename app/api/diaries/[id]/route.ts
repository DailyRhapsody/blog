import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getDiaries, saveDiaries, type Diary } from "@/lib/diaries-store";
import { allDiaries } from "@/app/diaries.data";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { extractHashtagsFromMarkdown } from "@/lib/hashtags";
import { localYmd } from "@/lib/publish-datetime";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = await guardApiRequest(req, {
    scope: "diaries:detail",
    limit: 120,
    windowMs: 60_000,
  });
  if (blocked) return blocked;
  const { id } = await params;
  const diaries = await getDiaries(allDiaries);
  const diary = diaries.find((d) => String(d.id) === id);
  if (!diary) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Not found" }, { status: 404 })
    );
  }
  return withAntiScrapeHeaders(NextResponse.json(diary));
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const badOrigin = rejectCrossSiteWrite(req);
    if (badOrigin) return badOrigin;
    const ok = await isAdmin();
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    let body: { date?: string; publishedAt?: string; summary?: string; location?: string; tags?: string[]; images?: string[]; pinned?: boolean };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const diaries = await getDiaries(allDiaries);
    const index = diaries.findIndex((d) => String(d.id) === id);
    if (index === -1) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (body.pinned) {
      const otherPinned = diaries.find((d) => d.pinned && String(d.id) !== id);
      if (otherPinned) {
        return NextResponse.json(
          { error: "已有置顶博客，请先取消该篇置顶后再设置本文置顶。" },
          { status: 400 }
        );
      }
    }
    const summary = body.summary ?? diaries[index].summary;
    let nextDate = diaries[index].date;
    let nextPublished = diaries[index].publishedAt;
    if (body.publishedAt !== undefined) {
      const raw = typeof body.publishedAt === "string" ? body.publishedAt.trim() : "";
      if (raw) {
        const t = new Date(raw);
        if (Number.isNaN(t.getTime())) {
          return NextResponse.json({ error: "发布时间无效" }, { status: 400 });
        }
        nextPublished = t.toISOString();
        nextDate = localYmd(t);
      } else {
        nextPublished = undefined;
        if (body.date !== undefined) nextDate = body.date;
      }
    } else if (body.date !== undefined) {
      nextDate = body.date;
    }
    const updated: Diary = {
      ...diaries[index],
      date: nextDate,
      publishedAt: nextPublished,
      pinned: body.pinned !== undefined ? body.pinned : diaries[index].pinned,
      summary,
      location: body.location !== undefined ? body.location.trim() : diaries[index].location,
      tags: extractHashtagsFromMarkdown(summary),
      images: body.images !== undefined ? body.images : diaries[index].images,
    };
    diaries[index] = updated;
    diaries.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (
        new Date(b.publishedAt ?? b.date).getTime() -
        new Date(a.publishedAt ?? a.date).getTime()
      );
    });
    await saveDiaries(diaries);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  const ok = await isAdmin();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const diaries = await getDiaries(allDiaries);
  const index = diaries.findIndex((d) => String(d.id) === id);
  if (index === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  diaries.splice(index, 1);
  await saveDiaries(diaries);
  return NextResponse.json({ ok: true });
}
