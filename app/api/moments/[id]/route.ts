import { NextResponse } from "next/server";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { getMoments, isMomentsConfigured } from "@/lib/notion-moments";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const blocked = await guardApiRequest(req, {
    scope: "moments:one",
    limit: 40,
    windowMs: 60_000,
  });
  if (blocked) return blocked;

  if (!isMomentsConfigured()) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Not configured" }, { status: 503 })
    );
  }

  const { id } = await ctx.params;
  const all = await getMoments();
  const m = all.find((x) => x.id === id);
  if (!m) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Not found" }, { status: 404 })
    );
  }
  return withAntiScrapeHeaders(NextResponse.json(m));
}

// PUT/DELETE removed — moments are managed in Notion
export async function PUT() {
  return NextResponse.json(
    { error: "Moments are now managed in Notion. Please edit there." },
    { status: 410 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Moments are now managed in Notion. Please delete there." },
    { status: 410 }
  );
}
