const FENCED_RE = /```[\s\S]*?```/g;
/** 行内代码整体忽略，避免误提 `#fff`、命令等 */
const INLINE_CODE_RE = /`[^`\n]*`/g;

/** 整行仅为一个 `#标签`（可两侧空白），与 Markdown 标题 `# 空格` 不冲突。 */
const WHOLE_LINE_TAG_RE =
  /^\s*#([\p{L}\p{N}_][\p{L}\p{N}_\u00B7\-]*)\s*$/u;

/** 若本行单独是一条标签，返回名称，否则 `null`（编辑器回车续行用）。 */
export function wholeLineHashtagName(line: string): string | null {
  const m = line.match(WHOLE_LINE_TAG_RE);
  return m?.[1] ?? null;
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

  const re =
    /(?:^|[\s\u3000,，.;；:：!！?？。、（）()\[\]【】《》「」])#([\p{L}\p{N}_][\p{L}\p{N}_\u00B7\-]*)/gu;
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
