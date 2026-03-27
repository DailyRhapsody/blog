/**
 * 前台「分享为图」：离屏 DOM，风格对齐 flomo 类卡片（品牌为 DailyRhapsody）。
 */

export type ShareCardInput = {
  summary: string;
  date: string;
  publishedAt?: string;
  entryId: number;
  authorName: string;
};

const CARD_WIDTH_PX = 340;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 正文展示用：去掉常见 Markdown，保留换行 */
export function summaryToPlainForCard(summary: string): string {
  let t = summary.trim();
  if (!t) return " ";
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/^[-*+]\s+\[[ xX]\]\s+/gm, "");
  t = t.replace(/^[-*+]\s+/gm, "");
  t = t.replace(/^\d+\.\s+/gm, "");
  t = t.replace(/^>\s?/gm, "");
  t = t.replace(/`{3}[\s\S]*?`{3}/g, "");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim() || " ";
}

export function getCardDateParts(
  date: string,
  publishedAt?: string
): { day: string; yearMonth: string } {
  const raw = publishedAt?.trim() || `${date}T12:00:00`;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const day = String(d.getDate());
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return { day, yearMonth: `${y}.${m}` };
  }
  const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (p) {
    const y = p[1];
    const m = p[2];
    const dd = String(parseInt(p[3], 10));
    return { day: dd, yearMonth: `${y}.${m}` };
  }
  return { day: "1", yearMonth: "1970.01" };
}

/**
 * 创建可交给 html2canvas 的卡片根节点（需已挂载到 document 再截图）。
 */
export function createShareCardElement(props: ShareCardInput): HTMLDivElement {
  const body = summaryToPlainForCard(props.summary);
  const { day, yearMonth } = getCardDateParts(props.date, props.publishedAt);
  const author = escapeHtml(props.authorName.trim() || "DailyRhapsody");
  const bodyHtml = escapeHtml(body).replace(/\n/g, "<br/>");
  const subtitle = `Chapter. ${props.entryId}`;

  const root = document.createElement("div");
  root.setAttribute("data-dailyrhapsody-share-card", "1");
  root.style.cssText = [
    "box-sizing:border-box",
    `width:${CARD_WIDTH_PX}px`,
    "padding:36px 34px 30px",
    "background:linear-gradient(180deg,#faf7f8 0%,#f7f8fa 42%,#eff2f6 100%)",
    'font-family:system-ui,-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
    "-webkit-font-smoothing:antialiased",
    "color:#333333",
  ].join(";");

  const dateBox = document.createElement("div");
  dateBox.style.cssText = [
    "box-sizing:border-box",
    "width:56px",
    "border:1px solid #dddddd",
    "text-align:center",
    "padding:8px 4px 10px",
    "background:rgba(255,255,255,0.35)",
  ].join(";");
  dateBox.innerHTML = `
    <div style="font-size:26px;font-weight:700;line-height:1;color:#333333;letter-spacing:-0.02em">${escapeHtml(day)}</div>
    <div style="margin-top:4px;font-size:11px;font-weight:400;color:#888888;line-height:1.2">${escapeHtml(yearMonth)}</div>
  `;

  const main = document.createElement("div");
  main.style.cssText = [
    "margin-top:26px",
    "font-size:15px",
    "font-weight:400",
    "line-height:1.58",
    "color:#333333",
    "word-break:break-word",
  ].join(";");
  main.innerHTML = bodyHtml;

  const hr = document.createElement("div");
  hr.style.cssText = "margin:26px 0 0;height:1px;background:#dddddd;width:100%";

  const footer = document.createElement("div");
  footer.style.cssText = [
    "margin-top:18px",
    "display:flex",
    "flex-direction:row",
    "justify-content:space-between",
    "align-items:flex-end",
    "gap:12px",
  ].join(";");

  const left = document.createElement("div");
  left.style.cssText = "min-width:0;flex:1";
  left.innerHTML = `
    <div style="font-size:14px;font-weight:600;color:#666666;line-height:1.3">${author}</div>
    <div style="margin-top:6px;font-size:11px;font-weight:400;color:#888888;line-height:1.3">${escapeHtml(subtitle)}</div>
  `;

  const brand = document.createElement("div");
  brand.textContent = "DailyRhapsody";
  brand.style.cssText = [
    "flex-shrink:0",
    "font-size:13px",
    "font-weight:700",
    "color:#666666",
    "line-height:1.2",
    "letter-spacing:-0.02em",
  ].join(";");

  footer.appendChild(left);
  footer.appendChild(brand);

  root.appendChild(dateBox);
  root.appendChild(main);
  root.appendChild(hr);
  root.appendChild(footer);

  return root;
}

export { CARD_WIDTH_PX as SHARE_CARD_WIDTH_PX };
