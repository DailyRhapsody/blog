"use client";

import { memo } from "react";

/** 本月日历热力图：仅方块，始终当前月，有发布的日期高亮；列顺序为周一至周日 */
export const CalendarHeatmap = memo(function CalendarHeatmap({
  datesWithPosts,
}: {
  datesWithPosts: Set<string>;
}) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const firstDay = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0);
  const startWeekday = firstDay.getDay();
  /** 首列对应周一：JS getDay 0=周日 → 周一占位索引为 (d+6)%7 */
  const leadingBlanks = (startWeekday + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) week.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  function toDateKey(day: number) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return (
    <div
      className="inline-grid h-[148px] grid-cols-7 gap-1 rounded-xl border border-zinc-200 bg-white/80 p-2.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-800/80"
      style={{ width: "min(100%, 168px)" }}
    >
      {weeks.flat().map((day, i) =>
        day === null ? (
          <div key={`e-${i}`} className="h-[18px] w-[18px] rounded-[4px] bg-zinc-100 dark:bg-zinc-700/60" />
        ) : (
          <div
            key={day}
            className={`h-[18px] w-[18px] rounded-[4px] transition-colors ${
              datesWithPosts.has(toDateKey(day))
                ? "bg-emerald-300/70 dark:bg-emerald-400/50"
                : "bg-zinc-200 dark:bg-zinc-600/80"
            }`}
            title={`${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}${datesWithPosts.has(toDateKey(day)) ? " 有发布" : ""}`}
          />
        )
      )}
    </div>
  );
});
