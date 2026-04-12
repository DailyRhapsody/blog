/**
 * Migration: Production Supabase (REST API) → Notion database.
 *
 * Usage: node scripts/migrate-prod-to-notion.mjs
 */

import { Client } from "@notionhq/client";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load env
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
const SUPABASE_URL = "https://fesdmsjjlsuglinodcxq.supabase.co";
const SUPABASE_KEY = "REMOVED_SECRET";

const notion = new Client({ auth: NOTION_TOKEN });

// --- Step 1: Read from Supabase REST API ---
async function readFromSupabase() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/diaries?select=id,date,published_at,pinned,is_public,summary,location,tags,images&order=published_at.asc.nullslast,date.asc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

// --- Step 2: Create in Notion ---
function splitText(text, maxLen = 2000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks.length ? chunks : [""];
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (typeof tags === "string") {
    try { return JSON.parse(tags); } catch { return []; }
  }
  if (Array.isArray(tags)) return tags.filter(t => typeof t === "string");
  return [];
}

async function createPage(row) {
  const summary = row.summary || "";
  const tags = normalizeTags(row.tags);

  const properties = {
    Name: {
      title: [{ text: { content: summary.slice(0, 60) || `日记 ${row.id}` } }],
    },
    Date: {
      date: { start: row.published_at || row.date },
    },
    Summary: {
      rich_text: splitText(summary).map(chunk => ({ text: { content: chunk } })),
    },
    Public: {
      checkbox: row.is_public !== false,
    },
    Pinned: {
      checkbox: !!row.pinned,
    },
  };

  if (row.location) {
    properties.Location = {
      rich_text: [{ text: { content: row.location } }],
    };
  }

  if (tags.length > 0) {
    properties.Tags = {
      multi_select: tags.map(t => ({ name: t })),
    };
  }

  return notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties,
  });
}

// --- Main ---
console.log("Reading from production Supabase...");
const rows = await readFromSupabase();
console.log(`Found ${rows.length} diaries.\n`);

const BATCH_SIZE = 3;
const DELAY_MS = 1100;
let success = 0;
let failed = 0;

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const results = await Promise.allSettled(batch.map(r => createPage(r)));

  for (let j = 0; j < results.length; j++) {
    const r = results[j];
    const d = batch[j];
    if (r.status === "fulfilled") {
      success++;
      process.stdout.write(`\r✓ ${success}/${rows.length} migrated`);
    } else {
      failed++;
      console.error(`\n✗ Failed #${d.id} (${d.date}): ${r.reason?.message || r.reason}`);
    }
  }

  if (i + BATCH_SIZE < rows.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n\nDone! ✓ ${success} migrated, ✗ ${failed} failed.`);
