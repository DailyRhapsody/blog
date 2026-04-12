import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { listMoments, isMomentsConfigured } from "@/lib/notion-moments";

export async function GET(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isMomentsConfigured()) {
    return NextResponse.json({ error: "Moments not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  try {
    const { items, total, hasMore } = await listMoments({
      limit,
      offset,
      includePrivate: true,
    });
    return NextResponse.json({
      items,
      total,
      hasMore,
      nextOffset: offset + items.length,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "无法读取动态" }, { status: 503 });
  }
}
