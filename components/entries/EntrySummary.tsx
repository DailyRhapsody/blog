"use client";

import { useMemo, useState } from "react";
import { markdownPreviewProseClass, renderMarkdown } from "@/lib/markdown";
import { MAX_SUMMARY_LINES } from "./utils";

export function EntrySummary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = text.split(/\n/).length > MAX_SUMMARY_LINES || text.length > 280;
  const rendered = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div>
      <div
        className={`${markdownPreviewProseClass} text-[0.82rem] leading-relaxed ${
          expanded ? "" : "max-h-36 overflow-hidden"
        }`}
      >
        <div
          className="space-y-[1.15em]"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      </div>
      {needsExpand && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[0.75rem] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
}
