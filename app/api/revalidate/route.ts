/**
 * On-demand revalidation endpoint.
 *
 * Call POST /api/revalidate?secret=<REVALIDATE_SECRET> to:
 * 1. Invalidate the Notion diary cache in Upstash
 * 2. Revalidate Next.js cached pages
 *
 * Use this with:
 * - Notion automations (via Make/Zapier webhook)
 * - Manual trigger after editing in Notion
 * - Cron job for periodic refresh
 */

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { invalidateCache } from "@/lib/notion";
import { invalidateMomentsCache } from "@/lib/notion-moments";

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const expected = process.env.REVALIDATE_SECRET?.trim();

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  try {
    // Clear Notion caches
    await invalidateCache();
    await invalidateMomentsCache();

    // Revalidate all pages that display diaries
    revalidatePath("/", "layout");

    return NextResponse.json({ revalidated: true, now: Date.now() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Revalidation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Also support GET for easy manual trigger / health check
export async function GET(req: NextRequest) {
  return POST(req);
}
