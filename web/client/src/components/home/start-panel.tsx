"use client";

import { MicIcon } from "lucide-react";
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
    <div className={cn("grid gap-4 lg:grid-cols-5", className)}>
      <div className="flex min-w-0 items-center px-1 py-2 lg:col-span-3">
        <Wordmark />
      </div>

      <div className="flex flex-col gap-4 px-1 py-2 lg:col-span-2 xl:flex-row xl:items-center">
        <div className="grid flex-1 grid-cols-2 gap-4">
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
        {/* 主操作：品牌绿实心按钮，麦克风放在一枚小圆片里，避免和处处都是的
            黑白按钮混在一起。圆形圆角 + 一点绿色投影，像一颗实体按键。 */}
        <Button
          onClick={onStart}
          className={cn(
            "bg-heat-4 text-background hover:bg-heat-3",
            "h-12 w-full gap-2.5 rounded-full px-5 text-sm font-semibold",
            "shadow-[0_10px_24px_-12px_var(--heat-3)]",
            "xl:w-auto xl:shrink-0"
          )}
        >
          <span className="bg-background/15 grid size-7 place-items-center rounded-full">
            <MicIcon className="size-4" />
          </span>
          {t("home.startButton")}
        </Button>
      </div>
    </div>
  );
}
