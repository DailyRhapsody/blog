import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { getDiaries, saveDiaries, type Diary } from "@/lib/diaries-store";
import { allDiaries } from "@/app/diaries.data";
import { extractHashtagsFromMarkdown, mergeRenameTagInMarkdown } from "@/lib/hashtags";

export async function POST(req: Request) {
  const bad = rejectCrossSiteWrite(req);
  if (bad) return bad;
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const from = (body.from ?? "").trim();
  const to = (body.to ?? "").trim();
  if (!from || !to) {
    return NextResponse.json({ error: "from 与 to 均不能为空" }, { status: 400 });
  }
  if (from === to) {
    return NextResponse.json({ error: "新旧标签不能相同" }, { status: 400 });
  }

  const diaries = await getDiaries(allDiaries);
  let touched = 0;
  for (const d of diaries) {
    const before = d.summary ?? "";
    const nextSummary = mergeRenameTagInMarkdown(before, from, to);
    if (nextSummary !== before) {
      (d as Diary).summary = nextSummary;
      (d as Diary).tags = extractHashtagsFromMarkdown(nextSummary);
      touched += 1;
    }
  }
  if (touched > 0) {
    await saveDiaries(diaries);
  }
  return NextResponse.json({ ok: true, from, to, touched });
}
