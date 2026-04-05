import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const DATA_DIR = join(process.cwd(), "data");
const JSONL_FILE = join(DATA_DIR, "analytics-visits.jsonl");

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
    throw new Error("DATABASE_URL is required for PostgreSQL analytics storage.");
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
          CREATE TABLE IF NOT EXISTS visit_events (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ip TEXT,
            country TEXT,
            region TEXT,
            city TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            path TEXT NOT NULL,
            query_string TEXT,
            referrer TEXT,
            user_agent TEXT,
            accept_language TEXT,
            utm_source TEXT,
            utm_medium TEXT,
            utm_campaign TEXT,
            visitor_id TEXT,
            is_bot BOOLEAN NOT NULL DEFAULT FALSE,
            screen_width INT,
            screen_height INT
          );
        `);
        await client.query(
          `CREATE INDEX IF NOT EXISTS visit_events_created_at_idx ON visit_events (created_at DESC);`
        );
        await client.query(`CREATE INDEX IF NOT EXISTS visit_events_path_idx ON visit_events (path);`);
        await client.query(
          `CREATE INDEX IF NOT EXISTS visit_events_country_idx ON visit_events (country);`
        );
        await client.query(`CREATE INDEX IF NOT EXISTS visit_events_ip_idx ON visit_events (ip);`);
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
      "DATABASE_URL is required in production for visitor analytics (file mode is not supported on serverless)."
    );
  }
}

export type VisitInput = {
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  path: string;
  queryString: string | null;
  referrer: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  visitorId: string | null;
  isBot: boolean;
  screenWidth: number | null;
  screenHeight: number | null;
};

export type VisitRow = {
  id: string;
  createdAt: string;
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  path: string;
  queryString: string | null;
  referrer: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  visitorId: string | null;
  isBot: boolean;
  screenWidth: number | null;
  screenHeight: number | null;
};

function newJsonlId(): string {
  return `${Date.now()}-${randomBytes(6).toString("hex")}`;
}

function mapPgRow(row: Record<string, unknown>): VisitRow {
  const id = row.id != null ? String(row.id) : "";
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? "");
  return {
    id,
    createdAt,
    ip: row.ip != null ? String(row.ip) : null,
    country: row.country != null ? String(row.country) : null,
    region: row.region != null ? String(row.region) : null,
    city: row.city != null ? String(row.city) : null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    path: String(row.path ?? ""),
    queryString: row.query_string != null ? String(row.query_string) : null,
    referrer: row.referrer != null ? String(row.referrer) : null,
    userAgent: row.user_agent != null ? String(row.user_agent) : null,
    acceptLanguage: row.accept_language != null ? String(row.accept_language) : null,
    utmSource: row.utm_source != null ? String(row.utm_source) : null,
    utmMedium: row.utm_medium != null ? String(row.utm_medium) : null,
    utmCampaign: row.utm_campaign != null ? String(row.utm_campaign) : null,
    visitorId: row.visitor_id != null ? String(row.visitor_id) : null,
    isBot: Boolean(row.is_bot),
    screenWidth: row.screen_width != null ? Number(row.screen_width) : null,
    screenHeight: row.screen_height != null ? Number(row.screen_height) : null,
  };
}

export async function recordVisit(input: VisitInput): Promise<void> {
  assertWritableStorageMode();
  if (USE_DATABASE) {
    await ensureSchema();
    await getPool().query(
      `
        INSERT INTO visit_events (
          ip, country, region, city, latitude, longitude,
          path, query_string, referrer, user_agent, accept_language,
          utm_source, utm_medium, utm_campaign, visitor_id, is_bot,
          screen_width, screen_height
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
        )
      `,
      [
        input.ip === "unknown" ? null : input.ip,
        input.country,
        input.region,
        input.city,
        input.latitude,
        input.longitude,
        input.path,
        input.queryString,
        input.referrer,
        input.userAgent,
        input.acceptLanguage,
        input.utmSource,
        input.utmMedium,
        input.utmCampaign,
        input.visitorId,
        input.isBot,
        input.screenWidth,
        input.screenHeight,
      ]
    );
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  const row: VisitRow = {
    id: newJsonlId(),
    createdAt: new Date().toISOString(),
    ip: input.ip === "unknown" ? null : input.ip,
    country: input.country,
    region: input.region,
    city: input.city,
    latitude: input.latitude,
    longitude: input.longitude,
    path: input.path,
    queryString: input.queryString,
    referrer: input.referrer,
    userAgent: input.userAgent,
    acceptLanguage: input.acceptLanguage,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    visitorId: input.visitorId,
    isBot: input.isBot,
    screenWidth: input.screenWidth,
    screenHeight: input.screenHeight,
  };
  await appendFile(JSONL_FILE, `${JSON.stringify(row)}\n`, "utf8");
}

export type AnalyticsQuery = {
  from: Date;
  to: Date;
  includeBots: boolean;
  page: number;
  pageSize: number;
};

export type AnalyticsSummary = {
  total: number;
  humanTotal: number;
  botTotal: number;
  uniqueIp: number;
  uniqueVisitors: number;
};

export type TopItem = { key: string; count: number };
export type DailyItem = { date: string; count: number };

export type AnalyticsReport = {
  summary: AnalyticsSummary;
  topPaths: TopItem[];
  topCountries: TopItem[];
  topRegions: TopItem[];
  daily: DailyItem[];
  rows: VisitRow[];
  totalRows: number;
};

function parseJsonlLine(line: string): VisitRow | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const o = JSON.parse(t) as VisitRow;
    if (!o || typeof o.path !== "string" || !o.createdAt) return null;
    return o;
  } catch {
    return null;
  }
}

async function loadJsonlVisits(from: Date, to: Date, includeBots: boolean): Promise<VisitRow[]> {
  let raw = "";
  try {
    raw = await readFile(JSONL_FILE, "utf8");
  } catch {
    return [];
  }
  const rows: VisitRow[] = [];
  for (const line of raw.split("\n")) {
    const v = parseJsonlLine(line);
    if (!v) continue;
    const ts = new Date(v.createdAt).getTime();
    if (ts < from.getTime() || ts > to.getTime()) continue;
    if (!includeBots && v.isBot) continue;
    rows.push(v);
  }
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows;
}

function countUnique(values: (string | null | undefined)[]): number {
  return new Set(values.filter((x): x is string => !!x && x.length > 0)).size;
}

function aggregateFromRows(all: VisitRow[], includeBots: boolean): Omit<AnalyticsReport, "rows" | "totalRows"> {
  const filtered = includeBots ? all : all.filter((r) => !r.isBot);
  const botTotal = all.filter((r) => r.isBot).length;
  const humanTotal = all.length - botTotal;

  const topMap = (keyFn: (r: VisitRow) => string) => {
    const m = new Map<string, number>();
    for (const r of filtered) {
      const k = keyFn(r);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  };

  const dailyMap = new Map<string, number>();
  for (const r of filtered) {
    const d = new Date(r.createdAt).toISOString().slice(0, 10);
    dailyMap.set(d, (dailyMap.get(d) ?? 0) + 1);
  }
  const daily: DailyItem[] = [...dailyMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    summary: {
      total: all.length,
      humanTotal,
      botTotal,
      uniqueIp: countUnique(filtered.map((r) => r.ip ?? undefined)),
      uniqueVisitors: countUnique(filtered.map((r) => r.visitorId ?? undefined)),
    },
    topPaths: topMap((r) => r.path).slice(0, 25),
    topCountries: topMap((r) => r.country || "(未知)").slice(0, 25),
    topRegions: topMap((r) => [r.country, r.region].filter(Boolean).join(" / ") || "(未知)").slice(
      0,
      25
    ),
    daily,
  };
}

export async function queryAnalytics(q: AnalyticsQuery): Promise<AnalyticsReport> {
  assertWritableStorageMode();
  const offset = (q.page - 1) * q.pageSize;

  if (USE_DATABASE) {
    await ensureSchema();
    const pool = getPool();
    const botClause = q.includeBots ? "" : " AND is_bot = FALSE";

    const sumRes = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE NOT is_bot)::int AS human_total,
          COUNT(*) FILTER (WHERE is_bot)::int AS bot_total,
          COUNT(DISTINCT ip) FILTER (WHERE ip IS NOT NULL AND ip <> '')::int AS unique_ip,
          COUNT(DISTINCT visitor_id) FILTER (WHERE visitor_id IS NOT NULL AND visitor_id <> '')::int AS unique_visitors
        FROM visit_events
        WHERE created_at >= $1 AND created_at <= $2
      `,
      [q.from, q.to]
    );
    const srow = sumRes.rows[0] as Record<string, unknown>;
    const summary: AnalyticsSummary = {
      total: Number(srow.total) || 0,
      humanTotal: Number(srow.human_total) || 0,
      botTotal: Number(srow.bot_total) || 0,
      uniqueIp: Number(srow.unique_ip) || 0,
      uniqueVisitors: Number(srow.unique_visitors) || 0,
    };

    if (!q.includeBots) {
      summary.uniqueIp = Number(
        (
          await pool.query(
            `SELECT COUNT(DISTINCT ip)::int AS c FROM visit_events
             WHERE created_at >= $1 AND created_at <= $2 AND is_bot = FALSE
             AND ip IS NOT NULL AND ip <> ''`,
            [q.from, q.to]
          )
        ).rows[0]?.c ?? 0
      );
      summary.uniqueVisitors = Number(
        (
          await pool.query(
            `SELECT COUNT(DISTINCT visitor_id)::int AS c FROM visit_events
             WHERE created_at >= $1 AND created_at <= $2 AND is_bot = FALSE
             AND visitor_id IS NOT NULL AND visitor_id <> ''`,
            [q.from, q.to]
          )
        ).rows[0]?.c ?? 0
      );
    }

    const topPathsRes = await pool.query(
      `SELECT path AS key, COUNT(*)::int AS count FROM visit_events
       WHERE created_at >= $1 AND created_at <= $2 ${botClause}
       GROUP BY path ORDER BY count DESC LIMIT 25`,
      [q.from, q.to]
    );
    const topCountriesRes = await pool.query(
      `SELECT COALESCE(country, '(未知)') AS key, COUNT(*)::int AS count FROM visit_events
       WHERE created_at >= $1 AND created_at <= $2 ${botClause}
       GROUP BY country ORDER BY count DESC LIMIT 25`,
      [q.from, q.to]
    );
    const topRegionsRes = await pool.query(
      `SELECT COALESCE(country || ' / ' || region, country, '(未知)') AS key, COUNT(*)::int AS count
       FROM visit_events
       WHERE created_at >= $1 AND created_at <= $2 ${botClause}
       GROUP BY country, region ORDER BY count DESC LIMIT 25`,
      [q.from, q.to]
    );

    const dailyRes = await pool.query(
      `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS date, COUNT(*)::int AS count
       FROM visit_events
       WHERE created_at >= $1 AND created_at <= $2 ${botClause}
       GROUP BY 1 ORDER BY 1`,
      [q.from, q.to]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM visit_events
       WHERE created_at >= $1 AND created_at <= $2 ${botClause}`,
      [q.from, q.to]
    );
    const totalRows = Number(countRes.rows[0]?.c) || 0;

    const rowsRes = await pool.query(
      `SELECT * FROM visit_events
       WHERE created_at >= $1 AND created_at <= $2 ${botClause}
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [q.from, q.to, q.pageSize, offset]
    );

    return {
      summary,
      topPaths: topPathsRes.rows.map((r) => ({ key: String(r.key), count: Number(r.count) })),
      topCountries: topCountriesRes.rows.map((r) => ({ key: String(r.key), count: Number(r.count) })),
      topRegions: topRegionsRes.rows.map((r) => ({ key: String(r.key), count: Number(r.count) })),
      daily: dailyRes.rows.map((r) => ({ date: String(r.date), count: Number(r.count) })),
      rows: rowsRes.rows.map((row) => mapPgRow(row)),
      totalRows,
    };
  }

  const all = await loadJsonlVisits(q.from, q.to, true);
  const agg = aggregateFromRows(all, q.includeBots);
  const filteredRows = q.includeBots ? all : all.filter((r) => !r.isBot);
  const totalRows = filteredRows.length;
  const rows = filteredRows.slice(offset, offset + q.pageSize);
  return {
    ...agg,
    summary: q.includeBots
      ? agg.summary
      : {
          ...agg.summary,
          uniqueIp: countUnique(filteredRows.map((r) => r.ip ?? undefined)),
          uniqueVisitors: countUnique(filteredRows.map((r) => r.visitorId ?? undefined)),
        },
    rows,
    totalRows,
  };
}
