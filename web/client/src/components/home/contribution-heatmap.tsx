"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import type { HeatmapDay, SessionHeatmap } from "@/lib/sessions";
import { cn } from "@/lib/utils";

const LEGEND_CELL = 10;

/** 色阶写死成完整类名，Tailwind 才能扫到。 */
const LEVEL_CLASS = [
  "bg-heat-0",
  "bg-heat-1",
  "bg-heat-2",
  "bg-heat-3",
  "bg-heat-4",
] as const;

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function dateKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate() + days
  );
}

/** 场次到色阶：0 / 1 / 2 / 3–4 / 5+。 */
function levelOf(sessions: number): 0 | 1 | 2 | 3 | 4 {
  if (sessions <= 0) return 0;
  if (sessions === 1) return 1;
  if (sessions === 2) return 2;
  if (sessions <= 4) return 3;
  return 4;
}

interface WeekCell {
  key: string;
  date: Date;
  day?: HeatmapDay;
}

interface HoverState {
  day: HeatmapDay;
  date: Date;
  x: number;
  y: number;
}

function useWeeks(
  heatmap: SessionHeatmap,
  weekCount?: number
): {
  weeks: (WeekCell | null)[][];
  months: { index: number; label: string }[];
  total: number;
} {
  const { i18n } = useTranslation();
  return React.useMemo(() => {
    const byDate = new Map(heatmap.days.map((day) => [day.date, day]));
    const start = parseDateKey(heatmap.start);
    const end = parseDateKey(heatmap.end);
    const allWeeks: (WeekCell | null)[][] = [];

    let cursor = start;
    while (cursor <= end) {
      const week: (WeekCell | null)[] = [];
      for (let row = 0; row < 7; row += 1) {
        if (cursor > end) {
          week.push(null);
          continue;
        }
        const key = dateKey(cursor);
        week.push({ key, date: new Date(cursor), day: byDate.get(key) });
        cursor = addDays(cursor, 1);
      }
      allWeeks.push(week);
    }

    // 只展示最近若干周；月份标签和总数都按可见范围重算。
    const weeks = weekCount
      ? allWeeks.slice(Math.max(0, allWeeks.length - weekCount))
      : allWeeks;
    const formatter = new Intl.DateTimeFormat(i18n.language, {
      month: "short",
    });
    const months: { index: number; label: string }[] = [];
    let previousMonth = -1;
    let total = 0;
    weeks.forEach((week, index) => {
      const first = week.find((cell): cell is WeekCell => Boolean(cell));
      if (!first) return;
      const month = first.date.getMonth();
      if (month !== previousMonth) {
        previousMonth = month;
        months.push({ index, label: formatter.format(first.date) });
      }
      total += week.reduce((sum, cell) => sum + (cell?.day?.sessions ?? 0), 0);
    });

    return { weeks, months, total };
  }, [heatmap, weekCount, i18n.language]);
}

/**
 * GitHub 个人首页那种按日期排的点阵图。
 *
 * 一列一周、一行一天，颜色深浅按当天实时面试场次；`weeks` 控制显示最近
 * 多少周（首页用紧凑的 12 周），`cellSize` 让格子保持正方形。悬停/聚焦看
 * 当天明细，数据很少所以用固定定位的浮层，不依赖父级的 overflow。
 */
export function ContributionHeatmap({
  heatmap,
  weeks: weekCount,
  cellSize = 10,
  className,
}: {
  heatmap: SessionHeatmap;
  /** 只显示最近多少周；省略时显示后端返回的完整范围。 */
  weeks?: number;
  /** 格子边长（正方形）。 */
  cellSize?: number;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { weeks, months, total } = useWeeks(heatmap, weekCount);
  const [hover, setHover] = React.useState<HoverState | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const gap = cellSize >= 16 ? 4 : 3;

  // 窄屏只放得下一部分周：默认滚到最右，让最近的活动先入眼。
  React.useEffect(() => {
    const element = scrollerRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks.length]);

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: "short",
        day: "numeric",
      }),
    [i18n.language]
  );
  const tokenFormatter = React.useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  );

  const showHover = (element: HTMLElement, cell: WeekCell) => {
    const rect = element.getBoundingClientRect();
    setHover({
      day: cell.day ?? { date: cell.key, sessions: 0, tokens: 0 },
      date: cell.date,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  };

  const weekdayLabels = [
    t("home.heatmap.weekdays.mon"),
    "",
    t("home.heatmap.weekdays.wed"),
    "",
    t("home.heatmap.weekdays.fri"),
    "",
    "",
  ];

  return (
    <section
      data-slot="contribution-heatmap"
      className={cn("flex flex-col gap-2.5", className)}
    >
      <div className="flex items-start gap-2">
        <div
          className="flex shrink-0 flex-col"
          style={{ paddingTop: 16, gap }}
          aria-hidden
        >
          {weekdayLabels.map((label, index) => (
            <span
              key={index}
              className="text-muted-foreground text-[10px]"
              style={{ height: cellSize, lineHeight: `${cellSize}px` }}
            >
              {label}
            </span>
          ))}
        </div>

        <div ref={scrollerRef} className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="relative h-3" aria-hidden>
            {months.map((month) => (
              <span
                key={`${month.index}-${month.label}`}
                className="text-muted-foreground absolute top-0 text-[10px] whitespace-nowrap"
                style={{ left: month.index * (cellSize + gap) }}
              >
                {month.label}
              </span>
            ))}
          </div>

          <div className="flex" style={{ gap }}>
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col" style={{ gap }}>
                {week.map((cell, rowIndex) =>
                  cell ? (
                    <button
                      key={cell.key}
                      type="button"
                      tabIndex={-1}
                      aria-label={t("home.heatmap.cellLabel", {
                        date: dateFormatter.format(cell.date),
                        count: cell.day?.sessions ?? 0,
                      })}
                      className={cn(
                        "rounded-[3px] ring-1 ring-inset ring-black/5 transition-transform",
                        "hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring",
                        "dark:ring-white/5",
                        LEVEL_CLASS[levelOf(cell.day?.sessions ?? 0)]
                      )}
                      style={{ width: cellSize, height: cellSize }}
                      onMouseEnter={(event) =>
                        showHover(event.currentTarget, cell)
                      }
                      onMouseLeave={() => setHover(null)}
                      onFocus={(event) => showHover(event.currentTarget, cell)}
                      onBlur={() => setHover(null)}
                    />
                  ) : (
                    <span
                      key={`${weekIndex}-${rowIndex}`}
                      aria-hidden
                      style={{ width: cellSize, height: cellSize }}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-[11px]">
          {total > 0
            ? t("home.heatmap.total", { count: total })
            : t("home.heatmap.empty")}
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
          {t("home.heatmap.less")}
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className={cn("rounded-[2px]", LEVEL_CLASS[level])}
              style={{ width: LEGEND_CELL, height: LEGEND_CELL }}
            />
          ))}
          {t("home.heatmap.more")}
        </span>
      </div>

      {hover && (
        <div
          role="tooltip"
          className="bg-popover text-popover-foreground pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md px-2 py-1 text-xs whitespace-nowrap shadow-md ring-1 ring-foreground/10"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          {dateFormatter.format(hover.date)} ·{" "}
          {t("home.heatmap.sessions", { count: hover.day.sessions })}
          {hover.day.tokens > 0 &&
            ` · ${t("home.heatmap.tokens", {
              count: tokenFormatter.format(hover.day.tokens),
            })}`}
        </div>
      )}
    </section>
  );
}
