"use client";

import { useMemo, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";

export default function MarkdownEditor({
  value,
  onChange,
  rows = 14,
  placeholder = "使用 Markdown 输入内容…",
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const previewHtml = useMemo(() => renderMarkdown(value), [value]);

  const insertSnippet = (snippet: string) => {
    const prefix = value && !value.endsWith("\n") ? "\n" : "";
    onChange(`${value}${prefix}${snippet}`);
  };

  return (
    <div className="mt-1 rounded-lg border border-zinc-300 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => setMode("edit")}
          className={`rounded px-2 py-1 text-xs ${mode === "edit" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
        >
          编辑
        </button>
        <button
          type="button"
          onClick={() => setMode("preview")}
          className={`rounded px-2 py-1 text-xs ${mode === "preview" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
        >
          预览
        </button>
        <div className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <button type="button" onClick={() => insertSnippet("# 标题")} className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">H1</button>
        <button type="button" onClick={() => insertSnippet("## 小标题")} className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">H2</button>
        <button type="button" onClick={() => insertSnippet("- 列表项")} className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">列表</button>
        <button type="button" onClick={() => insertSnippet("**加粗文本**")} className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">加粗</button>
        <button type="button" onClick={() => insertSnippet("[链接文字](https://example.com)")} className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">链接</button>
      </div>

      {mode === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="w-full resize-y rounded-b-lg border-0 bg-transparent px-3 py-2 text-zinc-900 outline-none dark:text-zinc-50"
        />
      ) : (
        <div className="prose prose-zinc max-w-none rounded-b-lg px-3 py-3 text-sm dark:prose-invert">
          <div dangerouslySetInnerHTML={{ __html: previewHtml || "<p class='text-zinc-400'>暂无内容</p>" }} />
        </div>
      )}
    </div>
  );
}
