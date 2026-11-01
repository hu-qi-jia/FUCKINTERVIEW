"use client";

import { useTranslation } from "react-i18next";

import { Wordmark } from "@/components/home/wordmark";
import { Button } from "@/components/ui/button";
import type { SessionStatsSummary } from "@/lib/sessions";
import { cn } from "@/lib/utils";

function StatBlock({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground block truncate text-base">
        {label}
      </span>
      <span className="mt-1.5 flex items-baseline gap-1 text-4xl leading-none font-semibold tabular-nums">
        {value}
        <span className="text-muted-foreground text-base font-normal">
          {unit}
        </span>
      </span>
    </div>
  );
}

/**
 * 首页第一行：左边是字标主视觉 + 开始面试，右边是统计数字。
 * 右侧不套卡片，直接落在页面底色上，只留数字本身；
 * 统计块与左侧「字标 + 按钮」整块垂直居中。
 */
export function StartPanel({
  summary,
  onStart,
  className,
}: {
  summary: SessionStatsSummary | null;
  onStart: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "grid items-center gap-4 lg:grid-cols-5 lg:gap-14",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 px-1 py-2 lg:col-span-3">
        <Wordmark />
        {/* 主操作：比字标再窄一点（这一栏的 60%）。上亮下暗的渐变当受光面，顶部一道内高光；
            hover 只抬起来、微微提亮，按下再压回去——不划过光。 */}
        <Button
          onClick={onStart}
          className={cn(
            "text-background relative h-14 w-[60%]",
            "rounded-[0.6rem] px-6 text-base font-semibold tracking-wide",
            "bg-[linear-gradient(180deg,var(--heat-4),color-mix(in_oklab,var(--heat-4)_84%,black))]",
            "shadow-[inset_0_1px_0_oklch(1_0_0/28%),0_12px_30px_-14px_var(--heat-3)]",
            "transition-[transform,box-shadow,filter] duration-200 ease-out",
            "hover:-translate-y-0.5 hover:brightness-110",
            "hover:shadow-[inset_0_1px_0_oklch(1_0_0/34%),0_18px_38px_-14px_var(--heat-3)]",
            "active:translate-y-0 active:brightness-95"
          )}
        >
          {t("home.startButton")}
        </Button>
      </div>

      <div className="flex items-center py-2 pl-1 lg:col-span-2">
        {/* 宽屏下两个指标靠在一起，右边缘和下面一行卡片对齐。 */}
        <div className="grid w-full grid-cols-2 gap-2.5 lg:flex lg:justify-end lg:gap-18">
          <StatBlock
            label={t("home.stats.totalSessions")}
            value={String(summary?.totalSessions ?? "–")}
            unit={t("home.stats.sessionsUnit")}
          />
          <StatBlock
            label={t("home.stats.weekSessions")}
            value={String(summary?.weekSessions ?? "–")}
            unit={t("home.stats.sessionsUnit")}
          />
        </div>
      </div>
    </div>
  );
}
