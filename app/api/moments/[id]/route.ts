import { NextResponse } from "next/server";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { isAdmin } from "@/lib/auth";
import {
  getMomentById,
  softDeleteMoment,
  updateMoment,
  toPublicMoment,
  type MomentMediaInput,
  type MomentType,
} from "@/lib/moments-store";

function parseMedia(raw: unknown): MomentMediaInput[] {
  if (!Array.isArray(raw)) return [];
  const out: MomentMediaInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url) continue;
    out.push({
      url,
      thumbUrl: typeof o.thumbUrl === "string" ? o.thumbUrl : null,
      mediaType: typeof o.mediaType === "string" ? o.mediaType : "image/jpeg",
      width: typeof o.width === "number" ? o.width : undefined,
      height: typeof o.height === "number" ? o.height : undefined,
      duration: typeof o.duration === "number" ? o.duration : undefined,
      sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : undefined,
    });
  }
  return out;
}

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

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return withAntiScrapeHeaders(NextResponse.json({ error: "Invalid id" }, { status: 400 }));
  }
  const m = await getMomentById(id, false);
  if (!m) return withAntiScrapeHeaders(NextResponse.json({ error: "Not found" }, { status: 404 }));
  return withAntiScrapeHeaders(NextResponse.json(toPublicMoment(m)));
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: { type?: unknown; media?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const type = Number(body.type) === 2 ? 2 : 1;
  const media = parseMedia(body.media);

  try {
    const updated = await updateMoment(id, { type: type as MomentType, media });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(toPublicMoment(updated));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "更新失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const ok = await softDeleteMoment(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
