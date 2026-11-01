"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import type { HeatmapDay, SessionHeatmap } from "@/lib/sessions";
import { cn } from "@/lib/utils";

const GAP = 4;
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

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

/** 后端的完整范围切成「周一到周日」的行，只取最近若干周。 */
function useWeeks(
  heatmap: SessionHeatmap,
  weekCount: number
): { weeks: (WeekCell | null)[][]; total: number } {
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

    const weeks = allWeeks.slice(Math.max(0, allWeeks.length - weekCount));
    const total = weeks.reduce(
      (sum, week) =>
        sum + week.reduce((acc, cell) => acc + (cell?.day?.sessions ?? 0), 0),
      0
    );
    return { weeks, total };
  }, [heatmap, weekCount]);
}

/**
 * 面试热力图。
 *
 * 列是周一到周日，行是最近的若干周。方格用 CSS Grid 铺满卡片可用区域，
 * 不再测量尺寸，因此移动端不会因为高度回环而抖动；悬停/聚焦看当天明细。
 */
export function ContributionHeatmap({
  heatmap,
  weeks: weekCount = 5,
  className,
}: {
  heatmap: SessionHeatmap;
  /** 显示最近多少周。 */
  weeks?: number;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { weeks, total } = useWeeks(heatmap, weekCount);
  const [hover, setHover] = React.useState<HoverState | null>(null);

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

  const showHover = (element: HTMLElement, cellData: WeekCell) => {
    const rect = element.getBoundingClientRect();
    setHover({
      day: cellData.day ?? { date: cellData.key, sessions: 0, tokens: 0 },
      date: cellData.date,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  };

  const weekdays = WEEKDAY_KEYS.map((key) => t(`home.heatmap.weekdays.${key}`));

  return (
    <section
      data-slot="contribution-heatmap"
      className={cn("flex h-full min-h-0 w-full flex-col gap-2", className)}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-7" style={{ gap: GAP }}>
          {weekdays.map((label) => (
            <span
              key={label}
              className="text-muted-foreground text-center text-[10px]"
            >
              {label}
            </span>
          ))}
        </div>

        <div
          className="mt-1 grid min-h-[180px] flex-1 grid-cols-7 lg:min-h-0"
          style={{
            gap: GAP,
            gridTemplateRows: `repeat(${Math.max(1, weeks.length)}, minmax(0, 1fr))`,
          }}
        >
          {weeks.flatMap((week, weekIndex) =>
            week.map((cellData, dayIndex) =>
              cellData ? (
                <button
                  key={cellData.key}
                  type="button"
                  tabIndex={-1}
                  aria-label={t("home.heatmap.cellLabel", {
                    date: dateFormatter.format(cellData.date),
                    count: cellData.day?.sessions ?? 0,
                  })}
                  className={cn(
                    "h-full w-full rounded-[5px] ring-1 ring-inset ring-black/5 transition-transform",
                    "hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-ring",
                    "dark:ring-white/5",
                    LEVEL_CLASS[levelOf(cellData.day?.sessions ?? 0)]
                  )}
                  onMouseEnter={(event) =>
                    showHover(event.currentTarget, cellData)
                  }
                  onMouseLeave={() => setHover(null)}
                  onFocus={(event) => showHover(event.currentTarget, cellData)}
                  onBlur={() => setHover(null)}
                />
              ) : (
                <span
                  key={`${weekIndex}-${dayIndex}`}
                  aria-hidden
                  className="h-full w-full"
                />
              )
            )
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
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
              className={cn("size-2.5 rounded-[2px]", LEVEL_CLASS[level])}
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
