import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { hasStoredDiaries, saveDiaries } from "@/lib/diaries-store";
import { allDiaries } from "@/app/diaries.data";

/** One-time: copy static allDiaries into current storage (PostgreSQL or local file). */
export async function POST() {
  const ok = await isAdmin();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const alreadySeeded = await hasStoredDiaries();
  if (alreadySeeded) {
    return NextResponse.json(
      { error: "已有数据，初始化仅允许首次执行，已阻止覆盖。" },
      { status: 409 }
    );
  }
  await saveDiaries([...allDiaries]);
  return NextResponse.json({ ok: true, count: allDiaries.length });
}
