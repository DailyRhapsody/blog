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
  BlockObjectResponse,
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

function richTextToMarkdown(items: RichTextItemResponse[]): string {
  return items
    .map((i) => {
      let t = i.plain_text;
      const a = i.annotations;
      if (a.code) t = `\`${t}\``;
      if (a.bold) t = `**${t}**`;
      if (a.italic) t = `*${t}*`;
      if (a.strikethrough) t = `~~${t}~~`;
      if (i.href) t = `[${t}](${i.href})`;
      return t;
    })
    .join("");
}

function blockToMarkdown(b: BlockObjectResponse): string {
  switch (b.type) {
    case "paragraph":
      return richTextToMarkdown(b.paragraph.rich_text);
    case "heading_1":
      return `# ${richTextToMarkdown(b.heading_1.rich_text)}`;
    case "heading_2":
      return `## ${richTextToMarkdown(b.heading_2.rich_text)}`;
    case "heading_3":
      return `### ${richTextToMarkdown(b.heading_3.rich_text)}`;
    case "bulleted_list_item":
      return `- ${richTextToMarkdown(b.bulleted_list_item.rich_text)}`;
    case "numbered_list_item":
      return `1. ${richTextToMarkdown(b.numbered_list_item.rich_text)}`;
    case "quote":
      return `> ${richTextToMarkdown(b.quote.rich_text)}`;
    case "to_do":
      return `- [${b.to_do.checked ? "x" : " "}] ${richTextToMarkdown(b.to_do.rich_text)}`;
    case "code": {
      const lang = b.code.language === "plain text" ? "" : b.code.language;
      return `\`\`\`${lang}\n${richTextToMarkdown(b.code.rich_text)}\n\`\`\``;
    }
    case "callout":
      return `> ${richTextToMarkdown(b.callout.rich_text)}`;
    case "divider":
      return "---";
    default:
      return "";
  }
}

async function extractBodyMarkdown(pageId: string): Promise<string> {
  const client = getClient();
  const parts: string[] = [];
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
        const md = blockToMarkdown(b as BlockObjectResponse);
        if (md) parts.push(md);
      }
      cursor = r.has_more ? r.next_cursor ?? undefined : undefined;
    } while (cursor);
  } catch (e) {
    console.warn(`[notion] extractBodyMarkdown failed for ${pageId}:`, e);
    return "";
  }
  return parts.join("\n\n");
}

async function extractBodyMarkdownBatch(
  pageIds: string[],
  concurrency = 3
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, pageIds.length) }, async () => {
    while (idx < pageIds.length) {
      const i = idx++;
      const id = pageIds[i];
      out.set(id, await extractBodyMarkdown(id));
    }
  });
  await Promise.all(workers);
  return out;
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

function mapPageToDiary(page: PageObjectResponse, bodyMarkdown: string): Diary {
  const title = extractTitle(page);
  const propSummary = extractSummary(page);

  return {
    id: page.id,
    date: extractDate(page),
    publishedAt: extractPublishedAt(page),
    pinned: extractPinned(page),
    isPublic: extractIsPublic(page),
    // Prefer page body (supports full markdown blocks); fall back to Summary
    // property for legacy entries, then title as last resort.
    summary: bodyMarkdown || propSummary || title,
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

  const bodies = await extractBodyMarkdownBatch(pages.map((p) => p.id));
  const diaries = pages.map((page) => mapPageToDiary(page, bodies.get(page.id) ?? ""));

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

    const body = await extractBodyMarkdown(id);
    return mapPageToDiary(page as PageObjectResponse, body);
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
