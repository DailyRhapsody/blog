const FENCE = /```[\s\S]*?```/g;

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * 仅用于后台编辑器 backdrop：给紧贴 # 的 #标签 包一层 span，与 extractHashtagsFromMarkdown 规则一致。
 * 不写入正文、不影响前台 / 预览的 renderMarkdown。
 */
export function highlightHashtagsForEditorHtml(markdown: string): string {
  if (!markdown) return "";
  let out = "";
  let last = 0;
  FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE.exec(markdown)) !== null) {
    out += highlightProse(markdown.slice(last, m.index));
    out += escapeHtml(m[0]);
    last = m.index + m[0].length;
  }
  out += highlightProse(markdown.slice(last));
  return out;
}

const BEFORE_HASH =
  /(^|[\s\u3000,，.;；:：!！?？。、（）()\[\]【】《》「」])(#[\p{L}\p{N}_][\p{L}\p{N}_\u00B7\-]*)/gu;

function highlightProse(s: string): string {
  const escaped = escapeHtml(s);
  return escaped.replace(
    BEFORE_HASH,
    (_, before: string, hashTag: string) =>
      `${before}<span class="dr-md-editor-tag">${hashTag}</span>`
  );
}
