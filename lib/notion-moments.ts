/**
 * Notion-backed moments store (read-only).
 *
 * Unified data source for the moments tab.
 * Reads from a Notion database with properties:
 *   Name (title), Date (date), Images (files), Public (checkbox)
 *
 * Outputs PublicMoment format compatible with the frontend.
 *
 * Env: NOTION_MOMENTS_DATABASE_ID
 */

import { Client } from "@notionhq/client";
import type {
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

async function getCached(): Promise<PublicMoment[] | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    return (await redis.get<PublicMoment[]>(CACHE_KEY)) ?? null;
  } catch {
    return null;
  }
}

async function setCache(items: PublicMoment[]): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    const ttl = Number(process.env.NOTION_CACHE_TTL) || 60;
    await redis.set(CACHE_KEY, items, { ex: ttl });
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

function extractImages(page: PageObjectResponse): PublicMedia[] {
  const prop = page.properties["Images"];
  if (prop?.type !== "files") return [];

  return prop.files.map((f, idx) => {
    let url = "";
    if (f.type === "file") {
      url = f.file.url;
    } else if (f.type === "external") {
      url = f.external.url;
    }
    if (!url) return null;

    // Detect video by file extension or name
    const isVideo = /\.(mp4|webm|mov)$/i.test(f.name ?? url);

    return {
      url,
      thumbUrl: url, // Notion doesn't provide separate thumbnails
      mediaType: isVideo ? "video/mp4" : "image/jpeg",
      width: 0,
      height: 0,
      duration: 0,
      sortOrder: idx,
    } satisfies PublicMedia;
  }).filter((x): x is PublicMedia => x !== null);
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

function mapPageToMoment(page: PageObjectResponse): PublicMoment & { isPublic: boolean } {
  const media = extractImages(page);
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
export async function getMoments(): Promise<(PublicMoment & { isPublic: boolean })[]> {
  const cached = await getCached();
  if (cached) {
    // cached items don't have isPublic, treat as public
    return cached.map((m) => ({ ...m, isPublic: true }));
  }

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

  const items = pages.map(mapPageToMoment);

  // Cache without isPublic (it's in the cached version anyway)
  await setCache(items);
  return items;
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
