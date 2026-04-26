/**
 * Notion-backed moments store (read-only).
 *
 * Unified data source for the moments tab.
 * Reads from a Notion database with properties:
 *   Name (title), Date (date), Public (checkbox)
 *
 * 媒体（图片/视频）从页面正文 block 提取（不再使用 Images files 字段）：
 *   - 视频优先：正文有任何 video block，type=2，取首个视频
 *   - 否则：按 block 顺序收集 image block，最多 9 张
 *
 * Outputs PublicMoment format compatible with the frontend.
 *
 * Env: NOTION_MOMENTS_DATABASE_ID
 */

import { Client } from "@notionhq/client";
import type {
  BlockObjectResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";

// Match the frontend PublicMoment / PublicMedia types
export type PublicMedia = {
  url: string;
  thumbUrl: string;
  mediaType: string;
  width: number;
  height: number;
  duration: number;
  sortOrder: number;
};

export type PublicMoment = {
  id: string;
  type: 1 | 2;
  createdAt: string;
  media: PublicMedia[];
};

// Also export a legacy MomentsItem shape for backwards compatibility
export type MomentsItem = {
  id: string;
  createdAt: string;
  isPublic?: boolean;
  images: string[];
};

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) throw new Error("NOTION_TOKEN is required");
    _client = new Client({ auth: token });
  }
  return _client;
}

function getDatabaseId(): string {
  const id = (process.env.NOTION_MOMENTS_DATABASE_ID ?? process.env.NOTION_GALLERY_DATABASE_ID)?.trim();
  if (!id) throw new Error("NOTION_MOMENTS_DATABASE_ID is required");
  return id;
}

// ---------------------------------------------------------------------------
// Upstash cache
// ---------------------------------------------------------------------------

let _redis: import("@upstash/redis").Redis | null | undefined;

async function getRedis() {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const { Redis } = await import("@upstash/redis");
    _redis = new Redis({ url, token });
  } else {
    _redis = null;
  }
  return _redis;
}

const CACHE_KEY = "notion:moments";
const CACHE_STALE_MS = (Number(process.env.NOTION_CACHE_STALE_S) || 300) * 1000;
const CACHE_HARD_TTL_S = 24 * 60 * 60;

type CacheEntry = { data: (PublicMoment & { isPublic: boolean })[]; refreshedAt: number };

async function getCached(): Promise<CacheEntry | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const data = await redis.get<CacheEntry | (PublicMoment & { isPublic: boolean })[]>(CACHE_KEY);
    if (!data) return null;
    if (Array.isArray(data)) return { data, refreshedAt: 0 };
    return data;
  } catch {
    return null;
  }
}

async function setCache(items: (PublicMoment & { isPublic: boolean })[]): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    const ttl = Number(process.env.NOTION_CACHE_TTL) || CACHE_HARD_TTL_S;
    const entry: CacheEntry = { data: items, refreshedAt: Date.now() };
    await redis.set(CACHE_KEY, entry, { ex: ttl });
  } catch {
    // non-fatal
  }
}

export async function invalidateMomentsCache(): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(CACHE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Property extraction
// ---------------------------------------------------------------------------

const MAX_IMAGES_PER_MOMENT = 9;

function blockMediaUrl(block: BlockObjectResponse): string | null {
  if (block.type === "image") {
    const f = block.image;
    if (f.type === "file") return f.file.url;
    if (f.type === "external") return f.external.url;
  } else if (block.type === "video") {
    const f = block.video;
    if (f.type === "file") return f.file.url;
    if (f.type === "external") return f.external.url;
  }
  return null;
}

/**
 * 从 Notion 页面正文 block 提取图片/视频。
 * 规则（与产品定义一致）：
 *  - 一条 moment 是纯图或纯视频，不带文字
 *  - 视频优先：只要正文里有任何 video block，type=2，取首个视频
 *  - 否则按 block 顺序收集 image block，最多 9 张
 *
 * 旧字段 properties.Images 不再使用——用户会在 Notion 后台清空那个字段。
 */
async function extractMediaFromBody(pageId: string): Promise<PublicMedia[]> {
  const client = getClient();
  const imageBlocks: BlockObjectResponse[] = [];
  let firstVideo: BlockObjectResponse | null = null;
  try {
    let cursor: string | undefined;
    do {
      const r = await client.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      });
      for (const b of r.results) {
        if (!("type" in b)) continue;
        const block = b as BlockObjectResponse;
        if (block.type === "video" && !firstVideo) {
          firstVideo = block;
        } else if (block.type === "image") {
          imageBlocks.push(block);
        }
      }
      cursor = r.has_more ? r.next_cursor ?? undefined : undefined;
    } while (cursor);
  } catch (e) {
    console.warn(`[notion-moments] extractMediaFromBody failed for ${pageId}:`, e);
    return [];
  }

  // 视频优先
  if (firstVideo) {
    const url = blockMediaUrl(firstVideo);
    if (!url) return [];
    return [{
      url,
      thumbUrl: url,
      mediaType: "video/mp4",
      width: 0,
      height: 0,
      duration: 0,
      sortOrder: 0,
    }];
  }

  // 无视频：按顺序最多 9 张图片
  return imageBlocks
    .slice(0, MAX_IMAGES_PER_MOMENT)
    .map((b, idx): PublicMedia | null => {
      const url = blockMediaUrl(b);
      if (!url) return null;
      return {
        url,
        thumbUrl: url,
        mediaType: "image/jpeg",
        width: 0,
        height: 0,
        duration: 0,
        sortOrder: idx,
      };
    })
    .filter((x): x is PublicMedia => x !== null);
}

/**
 * 并发抓多页 body 的媒体。Notion API 没有官方 RPS 文档但实测 3 并发安全；
 * 与 lib/notion.ts 的 extractBodyMarkdownBatch 保持一致。
 */
async function extractMediaBatch(
  pageIds: string[],
  concurrency = 3
): Promise<Map<string, PublicMedia[]>> {
  const out = new Map<string, PublicMedia[]>();
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, pageIds.length) }, async () => {
    while (idx < pageIds.length) {
      const i = idx++;
      const id = pageIds[i];
      out.set(id, await extractMediaFromBody(id));
    }
  });
  await Promise.all(workers);
  return out;
}

function extractDate(page: PageObjectResponse): string {
  const prop = page.properties["Date"];
  if (prop?.type === "date" && prop.date?.start) {
    return new Date(prop.date.start).toISOString();
  }
  return page.created_time;
}

function extractIsPublic(page: PageObjectResponse): boolean {
  const prop = page.properties["Public"];
  if (prop?.type === "checkbox") return prop.checkbox;
  return true;
}

function mapPageToMoment(
  page: PageObjectResponse,
  media: PublicMedia[]
): PublicMoment & { isPublic: boolean } {
  const hasVideo = media.some((m) => m.mediaType.startsWith("video/"));

  return {
    id: page.id,
    type: hasVideo ? 2 : 1,
    createdAt: extractDate(page),
    isPublic: extractIsPublic(page),
    media,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all moments from Notion, sorted by date descending.
 * Returns PublicMoment[] with an extra isPublic field for filtering.
 */
async function refreshMomentsFromNotion(): Promise<(PublicMoment & { isPublic: boolean })[]> {
  const client = getClient();
  const databaseId = getDatabaseId();

  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ property: "Date", direction: "descending" }],
    });
    for (const page of response.results) {
      if ("properties" in page) {
        pages.push(page as PageObjectResponse);
      }
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  const mediaMap = await extractMediaBatch(pages.map((p) => p.id));
  const items = pages.map((page) => mapPageToMoment(page, mediaMap.get(page.id) ?? []));
  await setCache(items);
  return items;
}

// 后台正在进行的重拉任务，避免多请求并发触发多次重拉
let _pendingRefresh: Promise<(PublicMoment & { isPublic: boolean })[]> | null = null;

function triggerBackgroundRefresh(): void {
  if (_pendingRefresh) return;
  const task = refreshMomentsFromNotion()
    .catch((e) => {
      console.warn("[notion-moments] background refresh failed:", e);
      return [] as (PublicMoment & { isPublic: boolean })[];
    })
    .finally(() => {
      _pendingRefresh = null;
    });
  _pendingRefresh = task;
  import("@vercel/functions").then(({ waitUntil }) => waitUntil(task)).catch(() => {
    // 不在 Vercel 环境：fire-and-forget
  });
}

/**
 * Fetch all moments from Notion, sorted by date descending.
 *
 * Stale-While-Revalidate（与 lib/notion.ts 同策略）：
 *  - 有缓存：立即返回旧数据。若超 NOTION_CACHE_STALE_S（5min）触发后台异步重拉。
 *  - 无缓存：同步拉。
 *
 * 注意：缓存里的 isPublic 必须保留真实值。之前为「兼容老缓存格式」无脑覆写为 true，
 * 导致 Public=false 的私密 moments 也对外公开（隐私泄露 bug）。
 */
export async function getMoments(): Promise<(PublicMoment & { isPublic: boolean })[]> {
  const cached = await getCached();
  if (cached) {
    const age = Date.now() - cached.refreshedAt;
    if (age > CACHE_STALE_MS) {
      triggerBackgroundRefresh();
    }
    return cached.data;
  }
  return refreshMomentsFromNotion();
}

/**
 * Paginated moments list (for /api/moments compatibility).
 */
export async function listMoments(opts: {
  limit: number;
  offset: number;
  includePrivate: boolean;
}): Promise<{ items: PublicMoment[]; total: number; hasMore: boolean }> {
  const all = await getMoments();
  const visible = opts.includePrivate ? all : all.filter((m) => m.isPublic);
  const items = visible.slice(opts.offset, opts.offset + opts.limit);
  return {
    items,
    total: visible.length,
    hasMore: opts.offset + items.length < visible.length,
  };
}

/**
 * Flat moments format for backwards compatibility.
 */
export async function getMomentsItems(): Promise<MomentsItem[]> {
  const all = await getMoments();
  return all.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    isPublic: m.isPublic,
    images: m.media.map((x) => x.url),
  }));
}

export function isMomentsConfigured(): boolean {
  return !!(
    process.env.NOTION_TOKEN?.trim() &&
    (process.env.NOTION_MOMENTS_DATABASE_ID ?? process.env.NOTION_GALLERY_DATABASE_ID)?.trim()
  );
}
