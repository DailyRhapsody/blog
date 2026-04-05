import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getProfile, saveProfile } from "@/lib/profile-store";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";

export async function GET(req: Request) {
  const blocked = await guardApiRequest(req, {
    scope: "profile:get",
    limit: 90,
    windowMs: 60_000,
  });
  if (blocked) return blocked;
  const profile = await getProfile();
  return withAntiScrapeHeaders(NextResponse.json(profile));
}

export async function PUT(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  const ok = await isAdmin();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Partial<{
    name: string;
    signature: string;
    avatar: string;
    headerBg: string;
    homeCoverUrl: string;
    homeCoverIsVideo: boolean;
  }>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const profile = await saveProfile({
    name: body.name,
    signature: body.signature,
    avatar: body.avatar,
    headerBg: body.headerBg,
    homeCoverUrl: body.homeCoverUrl,
    homeCoverIsVideo: body.homeCoverIsVideo,
  });
  return NextResponse.json(profile);
}
