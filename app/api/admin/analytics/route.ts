import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { queryAnalytics } from "@/lib/analytics-store";
import { rejectCrossSiteWrite } from "@/lib/same-origin";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseRangeBound(s: string | null, fallback: Date, endOfDay: boolean): Date {
  if (!s) return fallback;
  if (DAY_RE.test(s)) {
    const d = new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isFinite(d.getTime()) ? d : fallback;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

export async function GET(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;

  const ok = await isAdmin();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const from = parseRangeBound(
    url.searchParams.get("from"),
    new Date(now.getTime() - 7 * 86400000),
    false
  );
  const to = parseRangeBound(url.searchParams.get("to"), now, true);
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const includeBots = url.searchParams.get("bots") !== "0";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(url.searchParams.get("pageSize")) || 50));

  try {
    const report = await queryAnalytics({
      from,
      to,
      includeBots,
      page,
      pageSize,
    });
    return NextResponse.json(report);
  } catch (e) {
    console.error("[analytics] query", e);
    const message = e instanceof Error ? e.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
