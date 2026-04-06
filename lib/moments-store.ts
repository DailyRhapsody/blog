import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";

/** 1=图片动态 2=视频动态 */
export type MomentType = 1 | 2;

export type MomentMediaInput = {
  url: string;
  thumbUrl?: string | null;
  mediaType: string;
  width?: number;
  height?: number;
  duration?: number;
  sortOrder?: number;
};

export type MomentMediaRow = {
  url: string;
  thumbUrl: string | null;
  mediaType: string;
  width: number;
  height: number;
  duration: number;
  sortOrder: number;
};

export type MomentRow = {
  id: number;
  type: MomentType;
  createdAt: string;
  updatedAt: string;
  status: number;
  media: MomentMediaRow[];
};

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "moments.json");
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
          CREATE TABLE IF NOT EXISTS moments (
            id BIGSERIAL PRIMARY KEY,
            type SMALLINT NOT NULL CHECK (type IN (1, 2)),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            status SMALLINT NOT NULL DEFAULT 1 CHECK (status IN (0, 1))
          );
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS moment_media (
            id BIGSERIAL PRIMARY KEY,
            moment_id BIGINT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            thumb_url TEXT,
            media_type TEXT NOT NULL,
            width INT NOT NULL DEFAULT 0,
            height INT NOT NULL DEFAULT 0,
            duration INT NOT NULL DEFAULT 0,
            sort_order INT NOT NULL DEFAULT 0
          );
        `);
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_moments_created_at ON moments (created_at DESC) WHERE status = 1;`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_moment_media_moment_id ON moment_media (moment_id);`
        );
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
      "DATABASE_URL is required in production. File storage is not writable on serverless."
    );
  }
}

function normalizeMediaInput(m: MomentMediaInput, order: number): MomentMediaRow {
  return {
    url: m.url.trim(),
    thumbUrl: m.thumbUrl != null && String(m.thumbUrl).trim() ? String(m.thumbUrl).trim() : null,
    mediaType: m.mediaType.trim(),
    width: typeof m.width === "number" && Number.isFinite(m.width) ? Math.max(0, Math.round(m.width)) : 0,
    height: typeof m.height === "number" && Number.isFinite(m.height) ? Math.max(0, Math.round(m.height)) : 0,
    duration: typeof m.duration === "number" && Number.isFinite(m.duration) ? Math.max(0, Math.round(m.duration)) : 0,
    sortOrder: typeof m.sortOrder === "number" ? m.sortOrder : order,
  };
}

function isImageMime(m: string) {
  return /^image\/(jpeg|png|gif|webp)$/i.test(m);
}
function isVideoMime(m: string) {
  return /^video\/(mp4|webm|quicktime)$/i.test(m);
}

export function validateMomentPayload(type: MomentType, media: MomentMediaRow[]): string | null {
  if (type === 1) {
    if (media.length < 1 || media.length > 9) return "图片动态需 1～9 张图";
    for (const x of media) {
      if (!isImageMime(x.mediaType)) return "图片动态仅支持 JPG/PNG/GIF/WebP";
    }
    return null;
  }
  if (type === 2) {
    if (media.length !== 1) return "视频动态仅支持 1 个视频";
    if (!isVideoMime(media[0]!.mediaType)) return "仅支持 MP4 / MOV / WebM";
    return null;
  }
  return "无效类型";
}

async function readFromFile(): Promise<MomentRow[] | null> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as MomentRow[]) : null;
  } catch {
    return null;
  }
}

async function writeToFile(items: MomentRow[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
}

function mapDbMoment(
  row: { id: unknown; type: unknown; created_at: unknown; updated_at: unknown; status: unknown },
  media: MomentMediaRow[]
): MomentRow {
  return {
    id: Number(row.id),
    type: Number(row.type) === 2 ? 2 : 1,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(String(row.created_at)).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(String(row.updated_at)).toISOString(),
    status: Number(row.status),
    media,
  };
}

async function loadMediaForMoments(
  client: Pool | PoolClient,
  ids: number[]
): Promise<Map<number, MomentMediaRow[]>> {
  const map = new Map<number, MomentMediaRow[]>();
  if (ids.length === 0) return map;
  const res = await client.query(
    `SELECT moment_id, url, thumb_url, media_type, width, height, duration, sort_order
     FROM moment_media WHERE moment_id = ANY($1::bigint[])
     ORDER BY moment_id, sort_order, id`,
    [ids]
  );
  for (const r of res.rows) {
    const mid = Number(r.moment_id);
    const row: MomentMediaRow = {
      url: String(r.url),
      thumbUrl: r.thumb_url != null ? String(r.thumb_url) : null,
      mediaType: String(r.media_type),
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      duration: Number(r.duration) || 0,
      sortOrder: Number(r.sort_order) || 0,
    };
    if (!map.has(mid)) map.set(mid, []);
    map.get(mid)!.push(row);
  }
  return map;
}

export async function listMoments(options: {
  limit: number;
  offset: number;
  /** 后台：包含已删除 */
  includeDeleted?: boolean;
}): Promise<{ items: MomentRow[]; total: number }> {
  assertWritableStorageMode();
  const limit = Math.min(100, Math.max(1, options.limit));
  const offset = Math.max(0, options.offset);

  if (USE_DATABASE) {
    await ensureSchema();
    const pool = getPool();
    const where = options.includeDeleted ? "" : " WHERE status = 1";
    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM moments${where}`);
    const total = Number(countRes.rows[0]?.c) || 0;
    const res = await pool.query(
      `SELECT id, type, created_at, updated_at, status FROM moments${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const ids = res.rows.map((r) => Number(r.id));
    const mediaMap = await loadMediaForMoments(pool, ids);
    const items = res.rows.map((row) =>
      mapDbMoment(row, mediaMap.get(Number(row.id)) ?? [])
    );
    return { items, total };
  }

  const all = (await readFromFile()) ?? [];
  const filtered = options.includeDeleted ? all : all.filter((m) => m.status === 1);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const total = sorted.length;
  const items = sorted.slice(offset, offset + limit);
  return { items, total };
}

export async function getMomentById(
  id: number,
  includeDeleted?: boolean
): Promise<MomentRow | null> {
  assertWritableStorageMode();
  if (USE_DATABASE) {
    await ensureSchema();
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, type, created_at, updated_at, status FROM moments WHERE id = $1`,
      [id]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    if (!includeDeleted && Number(row.status) !== 1) return null;
    const mediaMap = await loadMediaForMoments(pool, [id]);
    return mapDbMoment(row, mediaMap.get(id) ?? []);
  }
  const all = (await readFromFile()) ?? [];
  const m = all.find((x) => x.id === id);
  if (!m) return null;
  if (!includeDeleted && m.status !== 1) return null;
  return m;
}

export async function createMoment(input: {
  type: MomentType;
  media: MomentMediaInput[];
}): Promise<MomentRow> {
  assertWritableStorageMode();
  const mediaRows = input.media.map((m, i) => normalizeMediaInput(m, i));
  const err = validateMomentPayload(input.type, mediaRows);
  if (err) throw new Error(err);

  for (const m of mediaRows) {
    if (!m.url) throw new Error("媒体 URL 不能为空");
    if (input.type === 1 && !m.thumbUrl) m.thumbUrl = m.url;
  }

  const now = new Date().toISOString();

  if (USE_DATABASE) {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO moments (type, created_at, updated_at, status)
         VALUES ($1, NOW(), NOW(), 1)
         RETURNING id, type, created_at, updated_at, status`,
        [input.type]
      );
      const row = ins.rows[0];
      const id = Number(row.id);
      for (let i = 0; i < mediaRows.length; i++) {
        const m = mediaRows[i]!;
        await client.query(
          `INSERT INTO moment_media (moment_id, url, thumb_url, media_type, width, height, duration, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            m.url,
            m.thumbUrl,
            m.mediaType,
            m.width,
            m.height,
            m.duration,
            m.sortOrder,
          ]
        );
      }
      await client.query("COMMIT");
      const mediaMap = await loadMediaForMoments(client, [id]);
      return mapDbMoment(row, mediaMap.get(id) ?? []);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  const items = (await readFromFile()) ?? [];
  const nextId = items.length === 0 ? 1 : Math.max(...items.map((x) => x.id), 0) + 1;
  const moment: MomentRow = {
    id: nextId,
    type: input.type,
    createdAt: now,
    updatedAt: now,
    status: 1,
    media: mediaRows.map((m, i) => ({ ...m, sortOrder: i })),
  };
  await writeToFile([moment, ...items]);
  return moment;
}

export async function updateMoment(
  id: number,
  input: { type: MomentType; media: MomentMediaInput[] }
): Promise<MomentRow | null> {
  assertWritableStorageMode();
  const mediaRows = input.media.map((m, i) => normalizeMediaInput(m, i));
  const err = validateMomentPayload(input.type, mediaRows);
  if (err) throw new Error(err);
  for (const m of mediaRows) {
    if (!m.url) throw new Error("媒体 URL 不能为空");
    if (input.type === 1 && !m.thumbUrl) m.thumbUrl = m.url;
  }

  if (USE_DATABASE) {
    await ensureSchema();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(`SELECT id FROM moments WHERE id = $1 AND status = 1`, [id]);
      if (cur.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(`UPDATE moments SET type = $1, updated_at = NOW() WHERE id = $2`, [
        input.type,
        id,
      ]);
      await client.query(`DELETE FROM moment_media WHERE moment_id = $1`, [id]);
      for (const m of mediaRows) {
        await client.query(
          `INSERT INTO moment_media (moment_id, url, thumb_url, media_type, width, height, duration, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, m.url, m.thumbUrl, m.mediaType, m.width, m.height, m.duration, m.sortOrder]
        );
      }
      await client.query("COMMIT");
      const res = await client.query(
        `SELECT id, type, created_at, updated_at, status FROM moments WHERE id = $1`,
        [id]
      );
      const mediaMap = await loadMediaForMoments(client, [id]);
      return mapDbMoment(res.rows[0], mediaMap.get(id) ?? []);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  const items = (await readFromFile()) ?? [];
  const idx = items.findIndex((x) => x.id === id && x.status === 1);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const prev = items[idx]!;
  const updated: MomentRow = {
    ...prev,
    type: input.type,
    updatedAt: now,
    media: mediaRows.map((m, i) => ({ ...m, sortOrder: i })),
  };
  const next = [...items];
  next[idx] = updated;
  await writeToFile(next);
  return updated;
}

export async function softDeleteMoment(id: number): Promise<boolean> {
  assertWritableStorageMode();
  if (USE_DATABASE) {
    await ensureSchema();
    const res = await getPool().query(
      `UPDATE moments SET status = 0, updated_at = NOW() WHERE id = $1 AND status = 1`,
      [id]
    );
    return (res.rowCount ?? 0) > 0;
  }
  const items = (await readFromFile()) ?? [];
  const idx = items.findIndex((x) => x.id === id && x.status === 1);
  if (idx === -1) return false;
  const next = [...items];
  next[idx] = {
    ...next[idx]!,
    status: 0,
    updatedAt: new Date().toISOString(),
  };
  await writeToFile(next);
  return true;
}

/** 前台 API：去掉内部 status，仅返回正常动态 */
export function toPublicMoment(m: MomentRow) {
  return {
    id: m.id,
    type: m.type,
    createdAt: m.createdAt,
    media: m.media.map((x) => ({
      url: x.url,
      thumbUrl: x.thumbUrl ?? x.url,
      mediaType: x.mediaType,
      width: x.width,
      height: x.height,
      duration: x.duration,
      sortOrder: x.sortOrder,
    })),
  };
}
