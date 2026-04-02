import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { getDiaries, saveDiaries, type Diary } from "@/lib/diaries-store";
import { allDiaries } from "@/app/diaries.data";
import { extractHashtagsFromMarkdown, removeHashtagFromMarkdown } from "@/lib/hashtags";

export async function POST(req: Request) {
  const bad = rejectCrossSiteWrite(req);
  if (bad) return bad;
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { tag?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const tag = (body.tag ?? "").trim();
  if (!tag) {
    return NextResponse.json({ error: "Tag required" }, { status: 400 });
  }

  const diaries = await getDiaries(allDiaries);
  let touched = 0;
  for (const d of diaries) {
    const before = d.summary ?? "";
    const nextSummary = removeHashtagFromMarkdown(before, tag);
    if (nextSummary !== before) {
      (d as Diary).summary = nextSummary;
      (d as Diary).tags = extractHashtagsFromMarkdown(nextSummary);
      touched += 1;
    }
  }
  if (touched > 0) {
    await saveDiaries(diaries);
  }
  return NextResponse.json({ ok: true, tag, touched });
}

