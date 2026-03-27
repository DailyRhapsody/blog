import { HASHTAG_NAME_BODY } from "@/lib/hashtags";

const FENCE = /```[\s\S]*?```/g;

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * 给紧贴 # 的 #标签 包一层 span（与 extractHashtagsFromMarkdown 一致）。
 * 供 renderMarkdown 在渲染前注入，用于预览/前台正文中的标签配色；不写入数据库原文。
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

const BEFORE_HASH = new RegExp(
  String.raw`(^|[\s\u3000,，.;；:：!！?？。、（）()\[\]【】《》「」])(#${HASHTAG_NAME_BODY})`,
  "gu"
);

function highlightProse(s: string): string {
  const escaped = escapeHtml(s);
  return escaped.replace(
    BEFORE_HASH,
    (_, before: string, hashTag: string) =>
      `${before}<span class="dr-md-editor-tag">${hashTag}</span>`
  );
}
