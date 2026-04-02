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
  const items = await getGalleryItems();
  return withAntiScrapeHeaders(NextResponse.json(items));
}

export async function POST(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  const ok = await isAdmin();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { text?: string; images?: unknown };
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
    text: body.text,
    images: images.map((s) => s.trim()),
  });
  return NextResponse.json(item);
}

