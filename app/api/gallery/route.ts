import { NextResponse } from "next/server";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { isAdmin } from "@/lib/auth";
import { getGalleryItems, isGalleryConfigured } from "@/lib/notion-gallery";

export async function GET(req: Request) {
  const blocked = await guardApiRequest(req, {
    scope: "gallery:list",
    limit: 90,
    windowMs: 60_000,
  });
  if (blocked) return blocked;

  if (!isGalleryConfigured()) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Gallery is not configured" }, { status: 503 })
    );
  }

  const admin = await isAdmin();
  const items = await getGalleryItems();
  const visible = admin ? items : items.filter((x) => x.isPublic !== false);
  return withAntiScrapeHeaders(NextResponse.json(visible));
}
