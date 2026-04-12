/**
 * One-time migration: local diaries.json → Notion database.
 *
 * Usage: node scripts/migrate-to-notion.mjs
 *
 * Reads from data/diaries.json (159 entries) and creates pages in Notion.
 * Notion API rate limit is ~3 req/s, so we batch with delays.
 */

import { Client } from "@notionhq/client";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load env from .env.local
const envContent = readFileSync(join(ROOT, ".env.local"), "utf8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const val = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_TOKEN || !DATABASE_ID) {
  console.error("Missing NOTION_TOKEN or NOTION_DATABASE_ID in .env.local");
  process.exit(1);
}

const client = new Client({ auth: NOTION_TOKEN });

// Read diaries
const diaries = JSON.parse(
  readFileSync(join(ROOT, "data", "diaries.json"), "utf8")
);

console.log(`Found ${diaries.length} diaries to migrate.\n`);

// Notion rich_text has a 2000 char limit per block, so we split long text
function splitText(text, maxLen = 2000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks.length ? chunks : [""];
}

async function createPage(diary) {
  const properties = {
    // Title (Name)
    Name: {
      title: [{ text: { content: diary.summary?.slice(0, 60) || `日记 ${diary.id}` } }],
    },
    // Date
    Date: {
      date: {
        start: diary.publishedAt
          ? diary.publishedAt // ISO datetime
          : diary.date,       // YYYY-MM-DD
      },
    },
    // Summary (rich text, may need splitting)
    Summary: {
      rich_text: splitText(diary.summary || "").map((chunk) => ({
        text: { content: chunk },
      })),
    },
    // Public (default true)
    Public: {
      checkbox: diary.isPublic !== false,
    },
    // Pinned
    Pinned: {
      checkbox: !!diary.pinned,
    },
  };

  // Location (only if present)
  if (diary.location) {
    properties.Location = {
      rich_text: [{ text: { content: diary.location } }],
    };
  }

  // Tags (multi-select)
  if (diary.tags && diary.tags.length > 0) {
    properties.Tags = {
      multi_select: diary.tags.map((t) => ({ name: t })),
    };
  }

  return client.pages.create({
    parent: { database_id: DATABASE_ID },
    properties,
  });
}

// Migrate in batches of 3 (respect rate limits)
const BATCH_SIZE = 3;
const DELAY_MS = 1100; // ~3 req/s
let success = 0;
let failed = 0;

// Sort oldest first so Notion ordering is correct
const sorted = [...diaries].sort(
  (a, b) => new Date(a.publishedAt || a.date).getTime() - new Date(b.publishedAt || b.date).getTime()
);

for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
  const batch = sorted.slice(i, i + BATCH_SIZE);
  const results = await Promise.allSettled(batch.map((d) => createPage(d)));

  for (let j = 0; j < results.length; j++) {
    const r = results[j];
    const d = batch[j];
    if (r.status === "fulfilled") {
      success++;
      process.stdout.write(`\r✓ ${success}/${sorted.length} migrated`);
    } else {
      failed++;
      console.error(
        `\n✗ Failed diary #${d.id} (${d.date}): ${r.reason?.message || r.reason}`
      );
    }
  }

  // Rate limit delay
  if (i + BATCH_SIZE < sorted.length) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n\nDone! ✓ ${success} migrated, ✗ ${failed} failed.`);
