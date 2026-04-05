const FENCED_RE = /```[\s\S]*?```/g;
/** 行内代码整体忽略，避免误提 `#fff`、命令等 */
const INLINE_CODE_RE = /`[^`\n]*`/g;

/**
 * `#` 后的标签名（不含 `#`）。首字可为字母数字 `_` 或书名号 `《`，后续可含 `·`、`-`、`》` 等，以支持 `#《书名》`。
 * 与 extract、整行剔除、编辑器高亮共用同一字符集（见 `HASHTAG_NAME_BODY`）。
 */
const TAG = String.raw`[\p{L}\p{N}_《][\p{L}\p{N}_\u00B7\-《》]*`;
/** 供 `editor-hashtag-highlight` 等拼接正则，须带 `u` 标志 */
export const HASHTAG_NAME_BODY = TAG;

/** 整行仅为一个 `#标签`（可两侧空白），与 Markdown 标题 `# 空格` 不冲突。 */
const WHOLE_LINE_TAG_RE = new RegExp(String.raw`^\s*#(${TAG})\s*$`, "u");

/**
 * 整行仅由一个或多个 `#标签`（空格分隔）组成。用于渲染时整段剔除，不进入正文；
 * 存库原文不变，标签仍由 extractHashtagsFromMarkdown 提取。
 */
const LINE_ONLY_HASHTAGS_RE = new RegExp(
  String.raw`^\s*(?:#${TAG})(?:\s+#${TAG})*\s*$`,
  "u"
);

/** 去掉「整行只是 #标签」的行（代码块外由 markdown 的 mapOutsideFencedBlocks 包一层再调）。 */
export function stripHashtagOnlyLinesInProse(prose: string): string {
  if (!prose) return prose;
  return prose
    .split("\n")
    .filter((line) => !LINE_ONLY_HASHTAGS_RE.test(line))
    .join("\n");
}

/** 若本行单独是一条标签，返回名称，否则 `null`（编辑器回车续行用）。 */
export function wholeLineHashtagName(line: string): string | null {
  const m = line.match(WHOLE_LINE_TAG_RE);
  return m?.[1] ?? null;
}

function normalizeTagList(tags: string[] | undefined): string[] {
  if (!tags?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const s = t.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * 从 Markdown 正文中提取标签：`#` 后接至少一个文字/数字/`_`，可含 `-`、`·`。
 * `#` 须在行首或空白/常见标点之后，避免 URL 片段与紧挨的英文词（如 `foo#bar`）。
 * 围栏代码块与行内代码不参与提取。多个标签用空格或换行分隔，如 `#写作 #随想`。
 * 标题与 Notion 相同：行首 `# `…`###### ` + 空格；亦可写 `=`×级别 + 空格。`#标签`（井号后无空格）只作标签。
 */
export function extractHashtagsFromMarkdown(text: string): string[] {
  if (!text?.trim()) return [];
  let scan = text.replace(/\r\n/g, "\n");
  scan = scan.replace(FENCED_RE, (block) => "\n".repeat(block.split("\n").length));
  scan = scan.replace(INLINE_CODE_RE, " ");

  const re = new RegExp(
    String.raw`(?:^|[\s\u3000,，.;；:：!！?？。、（）()\[\]【】《》「」])#(${TAG})`,
    "gu"
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of scan.matchAll(re)) {
    const tag = m[1];
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * 编辑页专用：若数据库 `tags` 里有项但正文中未出现对应 `#标签`（整行或行内），
 * 在文末追加整行 `#标签`，避免保存时仅靠 `extractHashtagsFromMarkdown(summary)` 把标签清空。
 */
export function ensureTagLinesForEdit(
  summary: string,
  tags: string[] | undefined
): string {
  const normalized = normalizeTagList(tags);
  if (normalized.length === 0) return summary ?? "";
  const base = summary ?? "";
  const fromText = new Set(extractHashtagsFromMarkdown(base));
  const missing = normalized.filter((t) => !fromText.has(t));
  if (missing.length === 0) return base;
  const suffix = missing.map((t) => `#${t}`).join("\n");
  const trimmedEnd = base.replace(/\s+$/u, "");
  return trimmedEnd ? `${trimmedEnd}\n\n${suffix}` : suffix;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapOutsideFencedBlocks(src: string, fn: (prose: string) => string): string {
  let result = "";
  let last = 0;
  FENCED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCED_RE.exec(src)) !== null) {
    result += fn(src.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  result += fn(src.slice(last));
  return result;
}

/**
 * 管理员批量操作：从 Markdown 正文中移除某个 `#标签`。
 * - 仅处理围栏代码块外；行内代码整体忽略（避免误删 `#fff`、命令等）
 * - 若某行仅为标签行（可多标签），会移除该标签并在行空时删掉整行
 */
export function removeHashtagFromMarkdown(text: string, tag: string): string {
  const t = (tag ?? "").trim();
  if (!t) return text ?? "";
  const src = (text ?? "").replace(/\r\n/g, "\n");
  const boundary = String.raw`[\s\u3000,，.;；:：!！?？。、（）()\[\]【】《》「」]`;
  const re = new RegExp(
    String.raw`(^|${boundary})#${escapeRegExp(t)}(?=$|${boundary})`,
    "gmu",
  );

  return mapOutsideFencedBlocks(src, (chunk) => {
    // 行内代码整体忽略：把每段 `...` 临时换成占位符
    const codes: string[] = [];
    let prose = chunk.replace(INLINE_CODE_RE, (m) => {
      codes.push(m);
      return `\u0000C${codes.length - 1}\u0000`;
    });

    // 先移除「仅标签行」中的目标标签
    const lines = prose.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!LINE_ONLY_HASHTAGS_RE.test(line)) continue;
      const parts = line.trim().split(/\s+/).filter(Boolean);
      const kept = parts.filter((p) => p !== `#${t}`);
      lines[i] = kept.length ? kept.join(" ") : "";
    }
    prose = lines.filter((l) => l !== "").join("\n");

    // 再移除正文中的 #tag（保留前导边界字符）
    prose = prose.replace(re, (_full, p1: string) => p1);

    // 还原行内代码段
    prose = prose.replace(/\u0000C(\d+)\u0000/g, (_m, idx) => codes[Number(idx)] ?? "");
    return prose;
  });
}

/**
 * 将正文中的 `#from` 换成 `#to`（围栏外、行内代码外），规则与 {@link removeHashtagFromMarkdown} 一致。
 */
export function replaceHashtagInMarkdown(
  text: string,
  fromTag: string,
  toTag: string,
): string {
  const f = (fromTag ?? "").trim();
  const t = (toTag ?? "").trim();
  if (!f || !t || f === t) return text ?? "";
  const src = (text ?? "").replace(/\r\n/g, "\n");
  const boundary = String.raw`[\s\u3000,，.;；:：!！?？。、（）()\[\]【】《》「」]`;
  const re = new RegExp(
    String.raw`(^|${boundary})#${escapeRegExp(f)}(?=$|${boundary})`,
    "gmu",
  );

  return mapOutsideFencedBlocks(src, (chunk) => {
    const codes: string[] = [];
    let prose = chunk.replace(INLINE_CODE_RE, (m) => {
      codes.push(m);
      return `\u0000C${codes.length - 1}\u0000`;
    });

    const lines = prose.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!LINE_ONLY_HASHTAGS_RE.test(line)) continue;
      const parts = line.trim().split(/\s+/).filter(Boolean);
      const next = parts.map((p) => (p === `#${f}` ? `#${t}` : p));
      lines[i] = next.join(" ");
    }
    prose = lines.join("\n");

    prose = prose.replace(re, (_full, p1: string) => `${p1}#${t}`);

    prose = prose.replace(/\u0000C(\d+)\u0000/g, (_m, idx) => codes[Number(idx)] ?? "");
    return prose;
  });
}

/**
 * 将标签 A 统一为 B：正文中所有 `#A` → `#B`；若该篇已有 `#B`，则只删除 `#A`（不重复 B）。
 */
export function mergeRenameTagInMarkdown(text: string, fromTag: string, toTag: string): string {
  const f = (fromTag ?? "").trim();
  const t = (toTag ?? "").trim();
  if (!f || !t || f === t) return text ?? "";
  const src = (text ?? "").replace(/\r\n/g, "\n");
  const tags = extractHashtagsFromMarkdown(src);
  if (!tags.includes(f)) return src;
  if (tags.includes(t)) {
    return removeHashtagFromMarkdown(src, f);
  }
  return replaceHashtagInMarkdown(src, f, t);
}
