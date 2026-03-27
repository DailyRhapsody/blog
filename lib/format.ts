/** 支持 ISO 或 YYYY-MM-DD，输出 2026/9/10 12:00:00PM（含秒）；异常日期返回空字符串 */
export function formatDate12h(dateOrIso: string): string {
  if (!dateOrIso || typeof dateOrIso !== "string") return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateOrIso)
    ? new Date(dateOrIso + "T12:00:00")
    : new Date(dateOrIso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours() % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  const ampm = d.getHours() < 12 ? "AM" : "PM";
  return `${y}/${m}/${day} ${h}:${min}:${sec}${ampm}`;
}
