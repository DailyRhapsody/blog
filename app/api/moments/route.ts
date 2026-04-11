import { NextResponse } from "next/server";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";
import { isAdmin } from "@/lib/auth";
import {
  createMoment,
  listMoments,
  toPublicMoment,
  type MomentMediaInput,
  type MomentType,
} from "@/lib/moments-store";

/** 解析 SUPABASE_URL 拿到 hostname，用于校验 media URL 是否来自我们的 bucket。 */
function getSupabaseHostname(): string | null {
  const raw = process.env.SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** 仅允许本站相对路径（/uploads/...）或 Supabase 存储域名。
 *  防止 admin 误存或 XSS 注入将 javascript: / 第三方域名写入数据库。 */
function isAllowedMediaUrl(value: string, supabaseHost: string | null): boolean {
  if (!value) return false;
  // 本站相对路径上传
  if (value.startsWith("/uploads/")) return true;
  // Supabase 公共 URL：必须是 https 且 hostname 与配置一致
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return false;
    if (!supabaseHost) return false;
    return u.hostname.toLowerCase() === supabaseHost;
  } catch {
    return false;
  }
}

function parseMedia(raw: unknown): MomentMediaInput[] {
  if (!Array.isArray(raw)) return [];
  const supabaseHost = getSupabaseHostname();
  const out: MomentMediaInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!isAllowedMediaUrl(url, supabaseHost)) continue;
    const thumbRaw = typeof o.thumbUrl === "string" ? o.thumbUrl.trim() : "";
    const thumbUrl = thumbRaw && isAllowedMediaUrl(thumbRaw, supabaseHost) ? thumbRaw : null;
    out.push({
      url,
      thumbUrl,
      mediaType: typeof o.mediaType === "string" ? o.mediaType : "image/jpeg",
      width: typeof o.width === "number" ? o.width : undefined,
      height: typeof o.height === "number" ? o.height : undefined,
      duration: typeof o.duration === "number" ? o.duration : undefined,
      sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : undefined,
    });
  }
  return out;
}

export async function GET(req: Request) {
  const blocked = await guardApiRequest(req, {
    scope: "moments:list",
    limit: 240,
    windowMs: 60_000,
  });
  if (blocked) return blocked;

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 10));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  try {
    const { items, total } = await listMoments({ limit, offset, includeDeleted: false });
    const publicItems = items.map(toPublicMoment);
    return withAntiScrapeHeaders(
      NextResponse.json({
        items: publicItems,
        total,
        hasMore: offset + items.length < total,
        nextOffset: offset + items.length,
      })
    );
  } catch (e) {
    console.error("[moments] list", e);
    const msg = e instanceof Error ? e.message : String(e);
    const pgHint =
      /ECONNREFUSED|ENOTFOUND|password authentication|timeout|certificate|SSL|5432/i.test(msg);
    const dev = process.env.NODE_ENV === "development";
    return withAntiScrapeHeaders(
      NextResponse.json(
        {
          error: "无法读取动态",
          ...(dev && {
            hint: pgHint
              ? "请检查 .env.local 里的 DATABASE_URL 是否正确；本地调试可不配置 DATABASE_URL，将使用 data/moments.json。"
              : "若为开发环境且终端出现 Failed to open database（Turbopack 缓存），请执行 npm run clean:next 后重试，或改用 npm run dev:webpack。",
            detail: msg.slice(0, 240),
          }),
        },
        { status: 503 }
      )
    );
  }
}

export async function POST(req: Request) {
  const badOrigin = rejectCrossSiteWrite(req);
  if (badOrigin) return badOrigin;
  const ok = await isAdmin();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const moment = await createMoment({ type: type as MomentType, media });
    return NextResponse.json(toPublicMoment(moment));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "发布失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
