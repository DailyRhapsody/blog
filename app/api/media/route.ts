/**
 * Media proxy for Notion-hosted images.
 *
 * Notion file URLs expire after ~1 hour. This endpoint fetches the current
 * signed URL from the Notion API and streams the image back, with Upstash
 * caching to avoid hitting Notion on every request.
 *
 * Usage: /api/media?block=<notion-block-id>
 */

import { NextResponse, type NextRequest } from "next/server";
import { Client } from "@notionhq/client";

const CACHE_TTL = 50 * 60; // 50 minutes (Notion URLs expire in ~60 min)

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

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) throw new Error("NOTION_TOKEN is required");
    _client = new Client({ auth: token });
  }
  return _client;
}

async function getSignedUrl(blockId: string): Promise<string | null> {
  const redis = await getRedis();
  const cacheKey = `notion:media:${blockId}`;

  // Try cache
  if (redis) {
    try {
      const cached = await redis.get<string>(cacheKey);
      if (cached) return cached;
    } catch {
      // cache miss
    }
  }

  // Fetch from Notion
  try {
    const block = await getClient().blocks.retrieve({ block_id: blockId });
    if (!("type" in block) || block.type !== "image") return null;

    const img = block.image;
    let url: string | undefined;
    if (img.type === "file") {
      url = img.file.url;
    } else if (img.type === "external") {
      url = img.external.url;
    }

    if (url && redis) {
      try {
        await redis.set(cacheKey, url, { ex: CACHE_TTL });
      } catch {
        // non-fatal
      }
    }

    return url ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const blockId = req.nextUrl.searchParams.get("block");
  if (!blockId) {
    return NextResponse.json({ error: "Missing block parameter" }, { status: 400 });
  }

  // Validate block ID format (UUID with or without dashes)
  if (!/^[a-f0-9-]{32,36}$/i.test(blockId)) {
    return NextResponse.json({ error: "Invalid block ID" }, { status: 400 });
  }

  const url = await getSignedUrl(blockId);
  if (!url) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Fetch the actual image and stream it back
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const body = response.body;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
  }
}
