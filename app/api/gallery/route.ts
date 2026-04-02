import { NextResponse } from "next/server";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { isAdmin } from "@/lib/auth";
import { addGalleryItem, getGalleryItems } from "@/lib/gallery-store";

export async function GET(req: Request) {
  const blocked = await guardApiRequest(req, {
    scope: "gallery:list",
    limit: 240,
    windowMs: 60_000,
  });
  if (blocked) return blocked;
  const admin = await isAdmin();
  const items = await getGalleryItems();
  const visible = admin ? items : items.filter((x) => x.isPublic !== false);
  return withAntiScrapeHeaders(NextResponse.json(visible));
}

export async function POST(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  const ok = await isAdmin();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { images?: unknown; isPublic?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const images = Array.isArray(body.images)
    ? body.images.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];
  if (images.length === 0) {
    return NextResponse.json({ error: "请至少上传一张图片" }, { status: 400 });
  }

  const item = await addGalleryItem({
    images: images.map((s) => s.trim()),
    isPublic: body.isPublic !== false,
  });
  return NextResponse.json(item);
}

