import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

export type GalleryItem = {
  id: number;
  createdAt: string;
  /** 是否公开展示（默认 true）；false 则仅管理员可见 */
  isPublic?: boolean;
  images: string[];
};

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "gallery.json");
const DATABASE_URL = process.env.DATABASE_URL?.trim();
const USE_DATABASE = Boolean(DATABASE_URL);

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function isLocalDbUrl(url: string): boolean {
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("@db:") ||
    url.includes("@postgres:")
  );
}

function getPool(): Pool {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL storage.");
  }
  if (!pool) {
    const ssl =
      process.env.PGSSLMODE === "disable" || isLocalDbUrl(DATABASE_URL)
        ? undefined
        : { rejectUnauthorized: false as const };
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 15_000,
    });
  }
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (!USE_DATABASE) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS gallery_items (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            is_public BOOLEAN NOT NULL DEFAULT TRUE,
            images JSONB NOT NULL DEFAULT '[]'::jsonb
          );
        `);
        await client.query(`
          ALTER TABLE gallery_items
          ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_gallery_items_created_at
          ON gallery_items (created_at DESC);
        `);
      } finally {
        client.release();
      }
    })();
  }
  await schemaReady;
}

function assertWritableStorageMode(): void {
  if (!USE_DATABASE && process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is required in production. File storage is not writable in serverless environments."
    );
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

async function readFromFile(): Promise<GalleryItem[] | null> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as GalleryItem[]) : null;
  } catch {
    return null;
  }
}

async function writeToFile(items: GalleryItem[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
}

export async function getGalleryItems(): Promise<GalleryItem[]> {
  assertWritableStorageMode();
  if (USE_DATABASE) {
    await ensureSchema();
    const res = await getPool().query(
      `SELECT id, created_at, is_public, images FROM gallery_items ORDER BY created_at DESC`
    );
    return res.rows.map((row) => ({
      id: Number(row.id),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
      isPublic: row.is_public !== false,
      images: normalizeStringArray(row.images),
    }));
  }
  const fromFile = await readFromFile();
  const list = Array.isArray(fromFile) ? fromFile : [];
  return list
    .filter((x) => x && typeof x.id === "number" && Array.isArray(x.images))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function addGalleryItem(input: {
  images: string[];
  createdAt?: string;
  isPublic?: boolean;
}): Promise<GalleryItem> {
  assertWritableStorageMode();
  const createdAt = input.createdAt
    ? new Date(input.createdAt).toISOString()
    : new Date().toISOString();
  const images = normalizeStringArray(input.images).slice(0, 24);
  const isPublic = input.isPublic !== false;

  if (USE_DATABASE) {
    await ensureSchema();
    const res = await getPool().query(
      `INSERT INTO gallery_items (created_at, is_public, images)
       VALUES ($1::timestamptz, $2, $3::jsonb)
       RETURNING id, created_at, is_public, images`,
      [createdAt, isPublic, JSON.stringify(images)]
    );
    const row = res.rows[0];
    return {
      id: Number(row.id),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
      isPublic: row.is_public !== false,
      images: normalizeStringArray(row.images),
    };
  }

  const items = await getGalleryItems();
  const nextId = items.length === 0 ? 1 : Math.max(...items.map((x) => x.id), 0) + 1;
  const item: GalleryItem = { id: nextId, createdAt, isPublic, images };
  const next = [item, ...items];
  await writeToFile(next);
  return item;
}

