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
      <span className="text-muted-foreground block truncate text-sm">
        {label}
      </span>
      <span className="mt-1.5 flex items-baseline gap-1 text-2xl leading-none font-semibold tabular-nums">
        {value}
        <span className="text-muted-foreground text-xs font-normal">
          {unit}
        </span>
      </span>
    </div>
  );
}

/**
 * 首页第一行：左边是字标主视觉，右边是统计数字 + 开始面试按钮。
 * 右侧不套卡片，直接落在页面底色上，只留数字和按钮本身。
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
    <div className={cn("grid gap-4 lg:grid-cols-5 lg:gap-14", className)}>
      <div className="flex min-w-0 items-center px-1 py-2 lg:col-span-3">
        <Wordmark />
      </div>

      <div className="flex flex-col gap-4 px-1 py-2 lg:col-span-2 xl:flex-row xl:items-center">
        <div className="grid flex-1 grid-cols-2 gap-2.5">
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
        {/* 主操作：品牌绿实心按钮。顶上一道内高光当受光面，底下垫一层绿光，
            hover 抬一下、按下压回去，做出实体按键的手感。 */}
        <Button
          onClick={onStart}
          className={cn(
            "text-background",
            "bg-[linear-gradient(180deg,var(--heat-4),color-mix(in_oklab,var(--heat-4)_84%,black))]",
            "h-12 w-full min-w-28 rounded-xl px-7 text-sm font-semibold tracking-wide",
            "shadow-[inset_0_1px_0_oklch(1_0_0/25%),0_10px_26px_-14px_var(--heat-3)]",
            "transition-[transform,box-shadow,filter] duration-200 ease-out",
            "hover:-translate-y-0.5 hover:brightness-110",
            "hover:shadow-[inset_0_1px_0_oklch(1_0_0/30%),0_16px_32px_-14px_var(--heat-3)]",
            "active:translate-y-0 active:brightness-95",
            "xl:w-auto xl:shrink-0"
          )}
        >
          {t("home.startButton")}
        </Button>
      </div>
    </div>
  );
}
