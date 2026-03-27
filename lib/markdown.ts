import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { highlightHashtagsForEditorHtml } from "@/lib/editor-hashtag-highlight";

const FENCED_BLOCK = /```[\s\S]*?```/g;

/**
 * 渲染管线与 Notion 常用 Markdown 快捷一致：`# `…`###### ` + 空格 为标题（六级），
 * `>` 引用、`---` 分隔、`- [ ]` 待办、列表与 GFM 表格等均由 marked 处理。
 * 唯一例外：紧贴 `#` 的 `#标签` 仍按正文标签提取（Notion 标题须在 `#` 后加空格）。
 * 可选保留 `=` 标题写法（`= `…`====== `），与 `# ` 等价。
 */
function notionOrEqualsHeadingsToAtx(prose: string): string {
  const lines = prose.split("\n");
  const afterNotion: string[] = [];
  for (const line of lines) {
    const bq = line.match(/^(\s{0,3}(?:>\s*)+)(#{1,6})\s+(.+)$/);
    if (bq) {
      afterNotion.push(`${bq[1]}${"=".repeat(bq[2].length)} ${bq[3]}`);
      continue;
    }
    const hx = line.match(/^(\s{0,3})(#{1,6})\s+(.+)$/);
    if (hx) {
      afterNotion.push(`${hx[1]}${"=".repeat(hx[2].length)} ${hx[3]}`);
      continue;
    }
    afterNotion.push(line);
  }
  const out: string[] = [];
  for (const line of afterNotion) {
    const bqEq = line.match(/^(\s{0,3}(?:>\s*)+)((?:=){1,6})\s+(.+)$/);
    if (bqEq) {
      const level = bqEq[2].length;
      out.push(`${bqEq[1]}${"#".repeat(level)} ${bqEq[3]}`);
      continue;
    }
    const eq = line.match(/^(\s*)(={1,6})\s+(.+)$/);
    if (eq) {
      const level = eq[2].length;
      out.push(`${eq[1]}${"#".repeat(level)} ${eq[3]}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function mapOutsideFencedBlocks(src: string, fn: (prose: string) => string): string {
  let result = "";
  let last = 0;
  FENCED_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCED_BLOCK.exec(src)) !== null) {
    result += fn(src.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  result += fn(src.slice(last));
  return result;
}

function escapeAttr(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

marked.use({
  gfm: true,
  breaks: true,
  hooks: {
    postprocess(html) {
      return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_TAGS: ["input"],
        ADD_ATTR: ["target", "rel", "checked", "disabled", "type"],
      });
    },
  },
  renderer: {
    link({ href, title, tokens }) {
      if (href == null || href === "") return "";
      const inner = this.parser.parseInline(tokens);
      const t =
        title != null && title !== ""
          ? ` title="${escapeAttr(String(title))}"`
          : "";
      return `<a href="${escapeAttr(String(href))}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
  },
});

/**
 * Markdown → HTML。标题与 Notion 一致用 `# `…`###### `（`#` 后必须有空格），
 * 亦可手写 `= `…`====== `；`#标签`（无空格）仍为正文标签。
 */
export function renderMarkdown(markdown: string): string {
  const src = (markdown ?? "").replace(/\r\n/g, "\n");
  const prepped = mapOutsideFencedBlocks(src, notionOrEqualsHeadingsToAtx);
  const withTags = highlightHashtagsForEditorHtml(prepped);
  return marked.parse(withTags, { async: false }) as string;
}

/**
 * 与前台 / 编辑器预览区共用的样式：列表层级、表格、代码块、图片、引用等与 GFM 输出对齐。
 */
export const markdownPreviewProseClass =
  "prose prose-zinc max-w-none dark:prose-invert [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_ul_ul]:mt-1 [&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square] [&_ol_ol]:mt-1 [&_ol_ol]:list-[lower-alpha] [&_ol_ol_ol]:list-[lower-roman] [&_a]:break-words [&_table]:w-full [&_table]:text-left [&_th]:border [&_th]:border-zinc-300 [&_th]:px-2 [&_th]:py-1.5 [&_td]:border [&_td]:border-zinc-300 [&_td]:px-2 [&_td]:py-1.5 dark:[&_th]:border-zinc-600 dark:[&_td]:border-zinc-600 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:text-sm [&_pre]:bg-zinc-900 [&_pre]:text-zinc-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_p_code]:rounded [&_p_code]:bg-zinc-100 [&_p_code]:px-1 [&_p_code]:py-0.5 dark:[&_p_code]:bg-zinc-800 [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-4 [&_blockquote]:not-italic dark:[&_blockquote]:border-zinc-600 [&_hr]:my-8 [&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:align-middle [&_.dr-md-editor-tag]:font-medium [&_.dr-md-editor-tag]:text-violet-700 dark:[&_.dr-md-editor-tag]:text-violet-300";
