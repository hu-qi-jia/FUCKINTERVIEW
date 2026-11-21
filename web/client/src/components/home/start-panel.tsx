"use client";

import { ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Wordmark } from "@/components/home/wordmark";
import type { LibraryCounts } from "@/components/home/interview-prep-card";
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
 * 左边自上而下是字标、一句说明、主操作、材料状态；字标和按钮共用 72% 的宽度，
 * 说明按句子长度收窄，所以是「两块重物夹几行字」。
 * 右侧不套卡片，直接落在页面底色上，只留数字本身；
 * 统计块与左侧整块垂直居中。
 */
export function StartPanel({
  summary,
  counts,
  countsLoading,
  onStart,
  onOpenMaterials,
  className,
}: {
  summary: SessionStatsSummary | null;
  /** 三份材料各建了多少；拿来看「现在能不能开始」。 */
  counts: LibraryCounts;
  countsLoading: boolean;
  onStart: () => void;
  /** 缺材料时点状态行直接去补。不传就只显示不给点。 */
  onOpenMaterials?: (segment: "profiles" | "questions" | "terms") => void;
  className?: string;
}) {
  const { t } = useTranslation();

  // 口径同下面那张「面试准备」卡：档案 / 问答库 / 术语库三样都建好了才算就绪。
  const materials = [
    { segment: "profiles", label: t("materials.tabs.profiles") },
    { segment: "questions", label: t("materials.tabs.questions") },
    { segment: "terms", label: t("materials.tabs.terms") },
  ] as const;
  const known = materials.every((item) => counts[item.segment] !== null);
  const missing = materials.find((item) => (counts[item.segment] ?? 0) === 0);
  const ready = materials.filter((item) => (counts[item.segment] ?? 0) > 0).length;
  const status = countsLoading
    ? t("home.startStatus.checking")
    : !known
      ? t("home.startStatus.unknown")
      : missing
        ? t("home.startStatus.missing", { item: missing.label })
        : t("home.startStatus.ready", { count: ready });

  return (
    <div
      className={cn(
        "grid items-center gap-4 lg:grid-cols-5 lg:gap-14",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 px-1 py-2 lg:col-span-3">
        {/* 字标与主操作同宽（72%，最宽 440）：这一栏的两个重物共用一个尺度，
            中间那两行说明只占句子的长度，靠留白跟它们分开。 */}
        <Wordmark className="w-[72%] max-w-[440px]" />

        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[15px] leading-snug font-medium">
            {t("home.tagline")}
          </p>
          <p className="text-muted-foreground max-w-[38ch] text-xs leading-relaxed">
            {t("home.taglineSub")}
          </p>
        </div>

        {/* 主操作：黑（深色主题白），跟其他按钮同一个色系，只是放到主视觉的尺寸。
            hover 抬一点点、微提亮，按下压回去——不划过光。 */}
        <Button
          onClick={onStart}
          className={cn(
            "mt-1 h-14 w-[72%] max-w-[440px] rounded-xl text-[15px] font-semibold",
            "shadow-[0_10px_26px_-18px_oklch(0_0_0/60%)]",
            "transition-[transform,box-shadow,background-color] duration-200 ease-out",
            "hover:-translate-y-px hover:bg-primary/85",
            "hover:shadow-[0_16px_32px_-18px_oklch(0_0_0/60%)]",
            "active:translate-y-0 active:bg-primary/90"
          )}
        >
          {t("home.startButton")}
        </Button>

        {/* 开始之前看一眼材料齐不齐；缺什么就点这行去补。 */}
        {known && missing && onOpenMaterials ? (
          <button
            type="button"
            onClick={() => onOpenMaterials(missing.segment)}
            className="text-muted-foreground hover:text-foreground -mt-1 flex w-fit items-center gap-0.5 text-xs transition-colors hover:underline hover:underline-offset-4"
          >
            {status}
            <ChevronRightIcon className="size-3 shrink-0" />
          </button>
        ) : (
          <p className="text-muted-foreground -mt-1 text-xs">{status}</p>
        )}
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
