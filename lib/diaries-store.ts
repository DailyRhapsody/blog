import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  USE_DATABASE,
  assertWritableStorage,
  ensureSchemaOnce,
  getPool,
} from "./db";

export type Diary = {
  id: number;
  date: string;
  /** 可选，精确发布时间（ISO UTC）；有则列表按此排序并展示到秒，否则用 date 本地中午 */
  publishedAt?: string;
  /** 是否置顶，最多一篇 */
  pinned?: boolean;
  /** 是否公开展示（默认 true）；false 则仅管理员可见 */
  isPublic?: boolean;
  summary: string;
  location?: string;
  tags?: string[];
  images?: string[];
};

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "diaries.json");

async function ensureSchema(): Promise<void> {
  await ensureSchemaOnce("diaries", async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS diaries (
        id BIGINT PRIMARY KEY,
        date TEXT NOT NULL,
        published_at TIMESTAMPTZ NULL,
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        is_public BOOLEAN NOT NULL DEFAULT TRUE,
        summary TEXT NOT NULL DEFAULT '',
        location TEXT NULL,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        images JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE diaries
      ADD COLUMN IF NOT EXISTS location TEXT NULL;
    `);
    await client.query(`
      ALTER TABLE diaries
      ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_diaries_sort
      ON diaries (pinned DESC, published_at DESC, date DESC);
    `);
  });
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function mapRowToDiary(row: {
  id: number | string;
  date: string;
  published_at: string | Date | null;
  pinned: boolean;
  is_public?: boolean;
  summary: string;
  location: string | null;
  tags: unknown;
  images: unknown;
}): Diary {
  const published =
    row.published_at == null
      ? undefined
      : typeof row.published_at === "string"
        ? row.published_at
        : row.published_at.toISOString();
  return {
    id: Number(row.id),
    date: row.date,
    publishedAt: published,
    pinned: !!row.pinned,
    isPublic: row.is_public !== false,
    summary: row.summary ?? "",
    location: row.location ?? undefined,
    tags: normalizeStringArray(row.tags),
    images: normalizeStringArray(row.images),
  };
}

async function readFromFile(): Promise<Diary[] | null> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function writeToFile(diaries: Diary[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(diaries, null, 2), "utf8");
}

export async function getDiaries(fallback: Diary[]): Promise<Diary[]> {
  assertWritableStorage();
  if (USE_DATABASE) {
    await ensureSchema();
    const res = await getPool().query(
      `SELECT id, date, published_at, pinned, is_public, summary, location, tags, images FROM diaries`
    );
    if (res.rows.length > 0) {
      return res.rows.map((row) => mapRowToDiary(row));
    }
    return fallback;
  }
  const fromFile = await readFromFile();
  if (fromFile && fromFile.length > 0) return fromFile;
  return fallback;
}

export async function saveDiaries(diaries: Diary[]): Promise<void> {
  assertWritableStorage();
  if (USE_DATABASE) {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      // 1) UPSERT 所有传入的行（避免之前 DELETE 全表 + 逐行 INSERT 的全量重写）
      for (const d of diaries) {
        await client.query(
          `
            INSERT INTO diaries (id, date, published_at, pinned, is_public, summary, location, tags, images, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW())
            ON CONFLICT (id) DO UPDATE SET
              date = EXCLUDED.date,
              published_at = EXCLUDED.published_at,
              pinned = EXCLUDED.pinned,
              is_public = EXCLUDED.is_public,
              summary = EXCLUDED.summary,
              location = EXCLUDED.location,
              tags = EXCLUDED.tags,
              images = EXCLUDED.images,
              updated_at = NOW()
          `,
          [
            d.id,
            d.date,
            d.publishedAt ?? null,
            !!d.pinned,
            d.isPublic !== false,
            d.summary ?? "",
            d.location ?? null,
            JSON.stringify(d.tags ?? []),
            JSON.stringify(d.images ?? []),
          ]
        );
      }
      // 2) 删除新列表中不存在的旧行（保持与传入快照一致）
      const ids = diaries.map((d) => d.id);
      if (ids.length > 0) {
        await client.query(
          `DELETE FROM diaries WHERE id <> ALL($1::bigint[])`,
          [ids]
        );
      } else {
        await client.query(`DELETE FROM diaries`);
      }
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  await writeToFile(diaries);
}

export async function hasStoredDiaries(): Promise<boolean> {
  assertWritableStorage();
  if (USE_DATABASE) {
    await ensureSchema();
    const res = await getPool().query(`SELECT 1 FROM diaries LIMIT 1`);
    return res.rows.length > 0;
  }
  const fromFile = await readFromFile();
  return Array.isArray(fromFile) && fromFile.length > 0;
}

export function nextId(diaries: Diary[]): number {
  if (diaries.length === 0) return 1;
  return Math.max(...diaries.map((d) => d.id), 0) + 1;
}
