const pad2 = (n: number) => String(n).padStart(2, "0");

/** 本地日历 YYYY-MM-DD（用于热力图等与「日历日」一致） */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * ISO 8601 或纯日期 YYYY-MM-DD → `<input type="datetime-local" step="1">` 的值（本地时区，含秒）。
 */
export function toDatetimeLocalValue(isoOrYmd: string): string {
  if (!isoOrYmd || typeof isoOrYmd !== "string") return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrYmd)
    ? new Date(`${isoOrYmd}T12:00:00`)
    : new Date(isoOrYmd);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * `datetime-local` 字符串（浏览器为本地时间）→ 存库的日历日与 UTC ISO。
 */
export function fromDatetimeLocal(localValue: string): {
  date: string;
  publishedAt: string;
} | null {
  if (!localValue?.trim()) return null;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: localYmd(d),
    publishedAt: d.toISOString(),
  };
}

export function nowDatetimeLocalValue(): string {
  return toDatetimeLocalValue(new Date().toISOString());
}
