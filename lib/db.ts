import { Pool, type PoolClient } from "pg";

const DATABASE_URL = process.env.DATABASE_URL?.trim();

/** 是否启用 PostgreSQL 存储；为 false 时各 store fallback 到本地文件 / 内存。 */
export const USE_DATABASE = Boolean(DATABASE_URL);

let pool: Pool | null = null;

function isLocalDbUrl(url: string): boolean {
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("@db:") ||
    url.includes("@postgres:")
  );
}

/** 全进程共享的单例 Pool，显式配置 max / idle / 连接超时 / 语句超时。 */
export function getPool(): Pool {
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

/** 每个 schema key 对应一个去重的初始化 promise；失败后清除以便下次请求重试。 */
const schemaPromises = new Map<string, Promise<void>>();

/**
 * 幂等地执行一个 schema 初始化（CREATE TABLE / INDEX 等）。
 * - 同一 key 在进程生命周期内只跑一次
 * - 失败时清除缓存，下个请求会重试
 * - USE_DATABASE 为 false 时直接跳过
 */
export async function ensureSchemaOnce(
  key: string,
  init: (client: PoolClient) => Promise<void>,
): Promise<void> {
  if (!USE_DATABASE) return;
  let p = schemaPromises.get(key);
  if (!p) {
    p = (async () => {
      const client = await getPool().connect();
      try {
        await init(client);
      } finally {
        client.release();
      }
    })();
    schemaPromises.set(key, p);
  }
  try {
    await p;
  } catch (error) {
    schemaPromises.delete(key);
    throw error;
  }
}

/**
 * 在生产环境下若未配置 DATABASE_URL 则抛错，避免 serverless 写本地文件。
 * 不同 store 可以传入个性化错误信息以便排障。
 */
export function assertWritableStorage(
  message = "DATABASE_URL is required in production. File storage is not writable on serverless.",
): void {
  if (!USE_DATABASE && process.env.NODE_ENV === "production") {
    throw new Error(message);
  }
}
