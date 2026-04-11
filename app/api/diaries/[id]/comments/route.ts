import { NextResponse } from "next/server";
import { getComments, addComment } from "@/lib/comments-store";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardApiRequest(req, {
    scope: "comments:list",
    limit: 60,
    windowMs: 60_000,
  });
  if (blocked) return blocked;
  const { id } = await params;
  const diaryId = Number(id);
  if (!Number.isInteger(diaryId)) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Invalid id" }, { status: 400 })
    );
  }
  const comments = await getComments(diaryId);
  return withAntiScrapeHeaders(NextResponse.json(comments));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  const blocked = await guardApiRequest(req, {
    scope: "comments:create",
    limit: 20,
    windowMs: 60_000,
    blockSuspicious: false,
  });
  if (blocked) return blocked;
  const { id } = await params;
  const diaryId = Number(id);
  if (!Number.isInteger(diaryId)) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Invalid id" }, { status: 400 })
    );
  }
  const lenHeader = req.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > 8 * 1024) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Payload too large" }, { status: 413 })
    );
  }
  let body: { author?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "Invalid body" }, { status: 400 })
    );
  }
  const author = (body.author ?? "").trim().slice(0, 64) || "匿名";
  const content = (body.content ?? "").trim().slice(0, 2000);
  if (!content) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "内容不能为空" }, { status: 400 })
    );
  }
  const comment = await addComment({ diaryId, author, content });
  return withAntiScrapeHeaders(NextResponse.json(comment));
}
