"use client";

import { CalendarDaysIcon, MicIcon, TrendingUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AsciiWordmark } from "@/components/home/ascii-wordmark";
import { Button } from "@/components/ui/button";
import type { SessionStatsSummary } from "@/lib/sessions";
import { cn } from "@/lib/utils";

function StatBlock({
  icon,
  label,
  value,
  unit,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <span className="[&>svg]:size-3.5">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-1.5 flex items-baseline gap-1 text-2xl leading-none font-semibold tabular-nums">
        {value}
        <span className="text-muted-foreground text-xs font-normal">
          {unit}
        </span>
      </span>
      <span className="text-muted-foreground/70 mt-1.5 block truncate text-[11px]">
        {hint}
      </span>
    </div>
  );
}

/**
 * 首页第一行：左边是 ASCII 字标主视觉，右边是统计数字 + 开始面试按钮。
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
    <div className={cn("grid gap-4 lg:grid-cols-5", className)}>
      {/* @container：字标的字号按这一栏的宽度算（cqw），换窗口宽度也放得下一行。 */}
      <div className="@container flex min-w-0 items-center px-1 py-2 lg:col-span-3">
        <AsciiWordmark />
      </div>

      <div className="flex flex-col gap-4 px-1 py-2 lg:col-span-2 xl:flex-row xl:items-center">
        <div className="grid flex-1 grid-cols-2 gap-4">
          <StatBlock
            icon={<TrendingUpIcon />}
            label={t("home.stats.totalSessions")}
            value={String(summary?.totalSessions ?? "–")}
            unit={t("home.stats.sessionsUnit")}
            hint={t("home.stats.liveOnly")}
          />
          <StatBlock
            icon={<CalendarDaysIcon />}
            label={t("home.stats.weekSessions")}
            value={String(summary?.weekSessions ?? "–")}
            unit={t("home.stats.sessionsUnit")}
            hint={t("home.stats.sinceMonday")}
          />
        </div>
        <Button
          className="h-11 w-full px-5 text-sm xl:w-auto xl:shrink-0"
          onClick={onStart}
        >
          <MicIcon className="size-4" />
          {t("home.startButton")}
        </Button>
      </div>
    </div>
  );
}
