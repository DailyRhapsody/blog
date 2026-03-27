// 一次性：从 dailyrhapsody.data.blog 的 WordPress REST API 拉取每篇的 date / date_gmt，
// 按文章 id（与迁移后本地 diary.id 一致）更新本地存储中的 publishedAt 与 date。
// 非持续同步，跑完即结束。
//
// 预览（不写库）：node scripts/sync-wp-published-at.mjs
// 写入：         node scripts/sync-wp-published-at.mjs --apply
//
// 使用 PostgreSQL 时请先载入 DATABASE_URL（例如 Node 20+：
// node --env-file=.env.local scripts/sync-wp-published-at.mjs --apply）

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const SITE = "dailyrhapsody.data.blog";
const PER_PAGE = 100;
const API_BASE = `https://public-api.wordpress.com/wp/v2/sites/${SITE}`;

const DATA_FILE = path.join(process.cwd(), "data", "diaries.json");

function isLocalDbUrl(url) {
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("@db:") ||
    url.includes("@postgres:")
  );
}

/** 与 lib/diaries-store 一致，便于连接 Neon 等 */
function pgPoolOptions(connectionString) {
  const ssl =
    process.env.PGSSLMODE === "disable" || isLocalDbUrl(connectionString)
      ? undefined
      : { rejectUnauthorized: false };
  return { connectionString, ssl };
}

function mergeEnvFile(filename) {
  const p = path.join(process.cwd(), filename);
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function loadEnvLocal() {
  try {
    mergeEnvFile(".env.local");
    mergeEnvFile(".env");
  } catch {
    /* ignore */
  }
}

/** WordPress date_gmt → 存库用 ISO UTC */
function dateGmtToIso(dateGmt) {
  if (!dateGmt || typeof dateGmt !== "string") return null;
  const norm = dateGmt.includes("T") ? dateGmt : dateGmt.trim().replace(" ", "T");
  const withZ = /[zZ]$|[+-][0-9]{2}:?[0-9]{2}$/.test(norm) ? norm : `${norm}Z`;
  const d = new Date(withZ);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchAllPosts() {
  const all = [];
  let page = 1;
  while (page <= 10) {
    const url = `${API_BASE}/posts?per_page=${PER_PAGE}&page=${page}`;
    console.log(`GET ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) break;
      throw new Error(`posts ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < PER_PAGE) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 600));
  }
  return all;
}

/** @returns {Map<number, { date: string, publishedAt: string }>} */
function wpPostsToTimeMap(posts) {
  const map = new Map();
  for (const post of posts) {
    const id = post.id;
    if (typeof id !== "number") continue;
    const publishedAt = dateGmtToIso(post.date_gmt);
    const rawDate = typeof post.date === "string" ? post.date : "";
    const date = rawDate.length >= 10 ? rawDate.slice(0, 10) : null;
    if (publishedAt && date) map.set(id, { date, publishedAt });
  }
  return map;
}

async function loadDiariesFromPg(pool) {
  const res = await pool.query(
    `SELECT id, date, published_at, pinned, summary, location, tags, images FROM diaries ORDER BY id`
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    date: row.date,
    publishedAt:
      row.published_at == null
        ? undefined
        : new Date(row.published_at).toISOString(),
    pinned: !!row.pinned,
    summary: row.summary ?? "",
    location: row.location ?? "",
    tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags ?? "[]"),
    images: Array.isArray(row.images) ? row.images : JSON.parse(row.images ?? "[]"),
  }));
}

function loadDiariesFromFile() {
  if (!fs.existsSync(DATA_FILE)) return null;
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return Array.isArray(raw) ? raw : null;
}

async function saveDiariesPg(pool, diaries) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM diaries");
    for (const d of diaries) {
      await client.query(
        `
          INSERT INTO diaries (id, date, published_at, pinned, summary, location, tags, images, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW())
        `,
        [
          d.id,
          d.date,
          d.publishedAt ?? null,
          !!d.pinned,
          d.summary ?? "",
          d.location?.trim() || null,
          JSON.stringify(Array.isArray(d.tags) ? d.tags : []),
          JSON.stringify(Array.isArray(d.images) ? d.images : []),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function saveDiariesFile(diaries) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(diaries, null, 2), "utf8");
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");

  console.log(`站点: ${SITE}`);
  console.log(apply ? "模式: 写入本地存储\n" : "模式: 仅预览（加 --apply 才会写入）\n");

  const posts = await fetchAllPosts();
  console.log(`WordPress 文章数: ${posts.length}\n`);
  const timeMap = wpPostsToTimeMap(posts);

  const dbUrl = process.env.DATABASE_URL?.trim();
  let diaries;
  let storage = "file";

  if (dbUrl) {
    storage = "postgres";
    const pool = new pg.Pool(pgPoolOptions(dbUrl));
    try {
      diaries = await loadDiariesFromPg(pool);
    } finally {
      await pool.end();
    }
  } else {
    diaries = loadDiariesFromFile();
  }

  if (!diaries || diaries.length === 0) {
    console.error(
      "本地没有文章（未配置 DATABASE_URL 且没有 data/diaries.json）。请确认环境或先初始化数据。"
    );
    process.exit(1);
  }

  console.log(`本地存储 (${storage}) 文章数: ${diaries.length}`);

  let matched = 0;
  let changed = 0;
  const lines = [];

  for (const d of diaries) {
    const wp = timeMap.get(d.id);
    if (!wp) continue;
    matched += 1;
    const same =
      d.publishedAt === wp.publishedAt &&
      d.date === wp.date;
    if (!same) {
      changed += 1;
      lines.push(
        `  id ${d.id}: date ${d.date} → ${wp.date} | publishedAt ${d.publishedAt ?? "(无)"} → ${wp.publishedAt}`
      );
    }
    if (apply) {
      d.date = wp.date;
      d.publishedAt = wp.publishedAt;
    }
  }

  console.log(`与 WordPress id 能对上的篇数: ${matched}`);
  console.log(`其中时间字段需要更新的篇数: ${changed}`);
  if (lines.length > 0) {
    console.log("");
    console.log(lines.slice(0, 40).join("\n"));
    if (lines.length > 40) console.log(`  … 另有 ${lines.length - 40} 条`);
  }

  if (!apply) {
    console.log("\n未写入。确认无误后执行: node scripts/sync-wp-published-at.mjs --apply");
    return;
  }

  if (changed === 0) {
    console.log("\n无需写入。");
    return;
  }

  if (dbUrl) {
    const pool = new pg.Pool(pgPoolOptions(dbUrl));
    try {
      await saveDiariesPg(pool, diaries);
    } finally {
      await pool.end();
    }
    console.log(`\n已写入 PostgreSQL（共 ${diaries.length} 条）。`);
  } else {
    saveDiariesFile(diaries);
    console.log(`\n已写入 ${DATA_FILE}（共 ${diaries.length} 条）。`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
