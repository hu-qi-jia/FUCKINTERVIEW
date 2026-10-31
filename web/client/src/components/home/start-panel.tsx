"use client";

import { MicIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SessionStatsSummary } from "@/lib/sessions";
import { cn } from "@/lib/utils";

function StatBlock({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground block truncate text-[11px]">
        {label}
      </span>
      <span className="mt-0.5 flex items-baseline gap-1 text-xl leading-none font-semibold tabular-nums">
        {value}
        <span className="text-muted-foreground text-[11px] font-normal">
          {unit}
        </span>
      </span>
      <span className="text-muted-foreground/70 mt-1 block truncate text-[10px]">
        {hint}
      </span>
    </div>
  );
}

/**
 * 页头下方的第一块面板：说明 + 两个场次指标 + 大号「开始面试」。
 * 主操作放在内容面板里，页头只负责页面身份和窄屏导航。
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
    <Card
      className={cn(
        "flex flex-col gap-4 p-4 lg:flex-row lg:items-center",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3 lg:flex-1">
        <span className="bg-heat-1/50 text-heat-4 flex size-11 shrink-0 items-center justify-center rounded-xl">
          <MicIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {t("home.startPanel.title")}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {t("home.startPanel.hint")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 lg:w-64 lg:shrink-0">
        <StatBlock
          label={t("home.stats.totalSessions")}
          value={String(summary?.totalSessions ?? "–")}
          unit={t("home.stats.sessionsUnit")}
          hint={t("home.stats.liveOnly")}
        />
        <StatBlock
          label={t("home.stats.weekSessions")}
          value={String(summary?.weekSessions ?? "–")}
          unit={t("home.stats.sessionsUnit")}
          hint={t("home.stats.sinceMonday")}
        />
      </div>

      <Button
        className="h-11 w-full px-6 text-sm lg:w-auto lg:shrink-0"
        onClick={onStart}
      >
        <MicIcon className="size-4" />
        {t("home.startButton")}
      </Button>
    </Card>
  );
}
