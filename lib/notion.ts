/**
 * Notion CMS integration — read-only data source for diary entries.
 *
 * Replaces diaries-store.ts as the data layer. All writes happen in Notion UI;
 * the website only reads and caches.
 *
 * Required env vars:
 *   NOTION_TOKEN          – Internal integration token
 *   NOTION_DATABASE_ID    – 32-char hex ID of the diary database
 *
 * Optional:
 *   NOTION_CACHE_TTL      – Upstash cache TTL in seconds (default 60)
 */

import { Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";

// ---------------------------------------------------------------------------
// Types (compatible with existing Diary interface)
// ---------------------------------------------------------------------------

export type Diary = {
  id: string; // Notion page ID (uuid)
  date: string; // YYYY-MM-DD
  publishedAt?: string; // ISO UTC
  pinned?: boolean;
  isPublic?: boolean;
  summary: string; // rich text → plain text
  location?: string;
  tags?: string[];
  images?: string[]; // raw Notion file URL or external URL (max 1)
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
  const id = process.env.NOTION_DATABASE_ID?.trim();
  if (!id) throw new Error("NOTION_DATABASE_ID is required");
  return id;
}

// ---------------------------------------------------------------------------
// Upstash cache (optional — gracefully skips if not configured)
// ---------------------------------------------------------------------------

let _redis: import("@upstash/redis").Redis | null | undefined;

async function getRedis() {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const { Redis } = await import("@upstash/redis");
    _redis = new Redis({ url, token });
  } else {
    _redis = null;
  }
  return _redis;
}

const CACHE_KEY = "notion:diaries";

function cacheTtl(): number {
  return Number(process.env.NOTION_CACHE_TTL) || 60;
}

async function getCached(): Promise<Diary[] | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const data = await redis.get<Diary[]>(CACHE_KEY);
    return data ?? null;
  } catch {
    return null;
  }
}

async function setCache(diaries: Diary[]): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(CACHE_KEY, diaries, { ex: cacheTtl() });
  } catch {
    // cache write failure is non-fatal
  }
}

export async function invalidateCache(): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(CACHE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Notion property helpers
// ---------------------------------------------------------------------------

function richTextToPlain(items: RichTextItemResponse[]): string {
  return items.map((i) => i.plain_text).join("");
}

function extractDate(page: PageObjectResponse): string {
  const prop = page.properties["Date"];
  if (prop?.type === "date" && prop.date?.start) {
    return prop.date.start.slice(0, 10); // YYYY-MM-DD
  }
  // Fallback: use page created time
  return page.created_time.slice(0, 10);
}

function extractPublishedAt(page: PageObjectResponse): string | undefined {
  const prop = page.properties["Date"];
  if (prop?.type === "date" && prop.date?.start) {
    // If the date includes a time component, use it as publishedAt
    if (prop.date.start.length > 10) {
      return new Date(prop.date.start).toISOString();
    }
  }
  return undefined;
}

function extractSummary(page: PageObjectResponse): string {
  const prop = page.properties["Summary"];
  if (prop?.type === "rich_text") {
    return richTextToPlain(prop.rich_text);
  }
  return "";
}

function extractTitle(page: PageObjectResponse): string {
  // Notion databases always have a Title property
  for (const [, prop] of Object.entries(page.properties)) {
    if (prop.type === "title") {
      return richTextToPlain(prop.title);
    }
  }
  return "";
}

function extractLocation(page: PageObjectResponse): string | undefined {
  const prop = page.properties["Location"];
  if (prop?.type === "rich_text") {
    const text = richTextToPlain(prop.rich_text);
    return text || undefined;
  }
  return undefined;
}

function extractTags(page: PageObjectResponse): string[] {
  const prop = page.properties["Tags"];
  if (prop?.type === "multi_select") {
    return prop.multi_select.map((t) => t.name);
  }
  return [];
}

function extractPinned(page: PageObjectResponse): boolean {
  const prop = page.properties["Pinned"];
  if (prop?.type === "checkbox") {
    return prop.checkbox;
  }
  return false;
}

function extractIsPublic(page: PageObjectResponse): boolean {
  const prop = page.properties["Public"];
  if (prop?.type === "checkbox") {
    return prop.checkbox;
  }
  // Default to public if property doesn't exist
  return true;
}

// ---------------------------------------------------------------------------
// Image extraction from the "Image" Files property (max 1 image per entry)
// ---------------------------------------------------------------------------

function extractImages(page: PageObjectResponse): string[] {
  const prop = page.properties["Image"];
  if (prop?.type !== "files") return [];
  const first = prop.files[0];
  if (!first) return [];
  let url: string | undefined;
  if (first.type === "file") {
    url = first.file.url;
  } else if (first.type === "external") {
    url = first.external.url;
  }
  return url ? [url] : [];
}

// ---------------------------------------------------------------------------
// Core: fetch all diaries from Notion
// ---------------------------------------------------------------------------

function mapPageToDiary(page: PageObjectResponse): Diary {
  const title = extractTitle(page);
  const summary = extractSummary(page);

  return {
    id: page.id,
    date: extractDate(page),
    publishedAt: extractPublishedAt(page),
    pinned: extractPinned(page),
    isPublic: extractIsPublic(page),
    // If Summary property is filled, use it; otherwise fall back to title
    summary: summary || title,
    location: extractLocation(page),
    tags: extractTags(page),
    images: extractImages(page),
  };
}

/**
 * Fetch all diary entries from Notion, sorted by date descending.
 * Results are cached in Upstash for NOTION_CACHE_TTL seconds.
 */
export async function getDiaries(): Promise<Diary[]> {
  // Try cache first
  const cached = await getCached();
  if (cached) return cached;

  const client = getClient();
  const databaseId = getDatabaseId();

  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
      sorts: [
        { property: "Date", direction: "descending" },
      ],
    });

    for (const page of response.results) {
      if ("properties" in page) {
        pages.push(page as PageObjectResponse);
      }
    }

    cursor = response.has_more
      ? response.next_cursor ?? undefined
      : undefined;
  } while (cursor);

  const diaries = pages.map((page) => mapPageToDiary(page));

  // Sort: pinned first, then by publishedAt/date descending
  diaries.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (
      new Date(b.publishedAt ?? b.date).getTime() -
      new Date(a.publishedAt ?? a.date).getTime()
    );
  });

  await setCache(diaries);
  return diaries;
}

/**
 * Fetch a single diary entry by Notion page ID.
 */
export async function getDiaryById(id: string): Promise<Diary | null> {
  // Try to find in cache first
  const cached = await getCached();
  if (cached) {
    const found = cached.find((d) => d.id === id);
    if (found) return found;
  }

  try {
    const client = getClient();
    const page = await client.pages.retrieve({ page_id: id });

    if (!("properties" in page)) return null;

    return mapPageToDiary(page as PageObjectResponse);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Notion configuration check
// ---------------------------------------------------------------------------

export function isNotionConfigured(): boolean {
  return !!(
    process.env.NOTION_TOKEN?.trim() &&
    process.env.NOTION_DATABASE_ID?.trim()
  );
}
