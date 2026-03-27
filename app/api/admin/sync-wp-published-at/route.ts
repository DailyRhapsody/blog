import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { runSyncWpPublishedAt } from "@/lib/sync-wp-published-at";
import { rejectCrossSiteWrite } from "@/lib/same-origin";

export async function POST(req: Request) {
  const bad = rejectCrossSiteWrite(req);
  if (bad) return bad;
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let apply = false;
  try {
    const body = (await req.json()) as { apply?: boolean };
    apply = body.apply === true;
  } catch {
    /* empty body */
  }
  try {
    const result = await runSyncWpPublishedAt(apply);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
