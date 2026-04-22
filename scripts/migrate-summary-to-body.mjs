/**
 * One-time migration: Notion `Summary` rich_text property → page body blocks.
 *
 * Usage:
 *   node scripts/migrate-summary-to-body.mjs --dry-run
 *   node scripts/migrate-summary-to-body.mjs
 *   node scripts/migrate-summary-to-body.mjs --drop-property
 *
 * Behavior:
 *   1. Query all pages in NOTION_DATABASE_ID.
 *   2. For each page:
 *        - Read Summary property.
 *        - If Summary is empty → skip.
 *        - Check if body has any existing blocks:
 *            * body non-empty → skip body write (display already uses body).
 *            * body empty → append Summary as paragraph blocks (split on `\n\n`,
 *              preserving empty paragraphs so extra blank lines survive).
 *   3. Clear the Summary property value on every page that had content.
 *   4. With --drop-property, remove the Summary column from the database
 *      schema after all page writes succeed.
 *
 * Time safety:
 *   - `created_time` is immutable.
 *   - `last_edited_time` will update, but no blog code reads it (only Date
 *     property drives display).
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

const DRY_RUN = process.argv.includes("--dry-run");
const DROP_PROPERTY = process.argv.includes("--drop-property");

const client = new Client({ auth: NOTION_TOKEN });

const RICH_TEXT_MAX = 2000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function richTextToPlain(items) {
  return items.map((i) => i.plain_text).join("");
}

/**
 * Split a chunk of text into multiple rich_text items, each ≤ 2000 chars,
 * so it fits inside a single Notion paragraph block.
 */
function textToRichTextItems(text) {
  if (!text) return [];
  const items = [];
  for (let i = 0; i < text.length; i += RICH_TEXT_MAX) {
    items.push({
      type: "text",
      text: { content: text.slice(i, i + RICH_TEXT_MAX) },
    });
  }
  return items;
}

/**
 * Split Summary plain text into Notion paragraph blocks.
 *
 * - Split on `\n\n` so paragraph boundaries in the source become block
 *   boundaries. Empty paragraphs (`\n\n\n\n`) are preserved as empty blocks,
 *   which is how extra vertical space is represented after the round-trip.
 * - Single `\n` inside a chunk is kept inside the rich_text content; the
 *   blog renderer uses `marked` with `breaks: true`, so it becomes `<br>`,
 *   matching the pre-migration appearance.
 */
function summaryToBlocks(summaryText) {
  const normalized = summaryText.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const blocks = [];
  for (const part of parts) {
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: textToRichTextItems(part) },
    });
  }
  return blocks;
}

async function bodyHasContent(pageId) {
  // Check only the first page of children; any existing block = "has content"
  const r = await client.blocks.children.list({
    block_id: pageId,
    page_size: 5,
  });
  return r.results.length > 0;
}

async function appendBlocks(pageId, blocks) {
  // Notion limits to 100 children per request
  for (let i = 0; i < blocks.length; i += 100) {
    const chunk = blocks.slice(i, i + 100);
    await client.blocks.children.append({
      block_id: pageId,
      children: chunk,
    });
    await sleep(350);
  }
}

async function clearSummaryProperty(pageId) {
  await client.pages.update({
    page_id: pageId,
    properties: {
      Summary: { rich_text: [] },
    },
  });
  await sleep(350);
}

async function fetchAllPages() {
  const pages = [];
  let cursor;
  do {
    const r = await client.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of r.results) {
      if ("properties" in p) pages.push(p);
    }
    cursor = r.has_more ? r.next_cursor ?? undefined : undefined;
  } while (cursor);
  return pages;
}

function extractSummary(page) {
  const prop = page.properties["Summary"];
  if (prop?.type !== "rich_text") return "";
  return richTextToPlain(prop.rich_text);
}

function extractTitle(page) {
  for (const [, prop] of Object.entries(page.properties)) {
    if (prop.type === "title") return richTextToPlain(prop.title);
  }
  return "(untitled)";
}

async function dropSummaryColumn() {
  console.log("\nDropping Summary column from database schema...");
  if (DRY_RUN) {
    console.log("  [dry-run] would call databases.update with { Summary: null }");
    return;
  }
  await client.databases.update({
    database_id: DATABASE_ID,
    properties: { Summary: null },
  });
  console.log("  ✓ Summary column removed.");
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}${DROP_PROPERTY ? " (+ drop column)" : ""}`);
  console.log(`Database: ${DATABASE_ID}\n`);

  const pages = await fetchAllPages();
  console.log(`Fetched ${pages.length} pages.\n`);

  const stats = {
    withSummary: 0,
    migrated: 0,
    skippedBodyHasContent: 0,
    cleared: 0,
    errors: 0,
  };

  for (const page of pages) {
    const title = extractTitle(page);
    const summary = extractSummary(page);
    if (!summary) continue;

    stats.withSummary++;
    const label = `${page.id.slice(0, 8)}… "${title.slice(0, 30)}"`;

    try {
      const bodyFilled = await bodyHasContent(page.id);
      if (bodyFilled) {
        console.log(`[skip-body] ${label} — body already has content (${summary.length} chars in Summary will just be cleared)`);
        stats.skippedBodyHasContent++;
      } else {
        const blocks = summaryToBlocks(summary);
        console.log(`[migrate]   ${label} — writing ${blocks.length} paragraph block(s), ${summary.length} chars`);
        if (!DRY_RUN) await appendBlocks(page.id, blocks);
        stats.migrated++;
      }

      if (!DRY_RUN) await clearSummaryProperty(page.id);
      stats.cleared++;
    } catch (e) {
      stats.errors++;
      console.error(`[error]     ${label} —`, e.message || e);
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Pages with Summary content: ${stats.withSummary}`);
  console.log(`Migrated to body:           ${stats.migrated}`);
  console.log(`Body already had content:   ${stats.skippedBodyHasContent}`);
  console.log(`Summary property cleared:   ${stats.cleared}${DRY_RUN ? " (would be)" : ""}`);
  console.log(`Errors:                     ${stats.errors}`);

  if (DROP_PROPERTY) {
    if (stats.errors > 0) {
      console.log("\nSkipping column drop due to errors above.");
    } else {
      await dropSummaryColumn();
    }
  } else {
    console.log("\n(Pass --drop-property to also remove the Summary column from the database schema.)");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
