"use client";

/** 首页卡片顶部的一行内联指标；和相邻指标之间用竖线分隔。 */
export function InlineMetric({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="min-w-0 flex-1 px-3 first:pl-0 last:pr-0 sm:px-4">
      <span className="text-muted-foreground block truncate text-[11px]">
        {label}
      </span>
      <span className="mt-1 flex items-baseline gap-1 text-xl leading-none font-semibold tabular-nums">
        {value}
        {unit && (
          <span className="text-muted-foreground text-[10px] font-normal">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
