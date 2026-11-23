"use client";

import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import DecryptedText from "@/components/ui/decrypted-text";
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
 * 首页第一行：左边是轮播的祝福语 + 开始面试，右边是统计数字。
 * 应用标识在左上角侧栏，这里不再重复，主视觉只留一句话和一个动作。
 * 右侧不套卡片，直接落在页面底色上，只留数字本身；
 * 统计块与左侧整块垂直居中。
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
        {/* 主视觉文字：解密动效，循环重播；有减少动效偏好时直接显示原文。 */}
        <div className="flex min-h-[1.4em] items-center text-[30px] leading-snug font-semibold">
          <DecryptedText
            text="FUCKINTERVIEW"
            effect="scramble"
            animateOn="view"
            sequential
            revealDirection="start"
            speed={45}
            maxIterations={12}
            loop
            loopDelay={4000}
            className="text-foreground"
            encryptedClassName="text-muted-foreground/50"
            parentClassName="tracking-tight"
          />
        </div>

        {/* 主操作：黑（深色主题白），跟其他按钮同一个色系，只是放到主视觉的尺寸。
            hover 抬一点点、微提亮，按下压回去——不划过光。 */}
        <Button
          onClick={onStart}
          className={cn(
            "mt-1 h-14 w-[64%] max-w-[380px] rounded-xl text-[15px] font-semibold",
            "shadow-[0_10px_26px_-18px_oklch(0_0_0/60%)]",
            "transition-[transform,box-shadow,background-color] duration-200 ease-out",
            "hover:-translate-y-px hover:bg-primary/85",
            "hover:shadow-[0_16px_32px_-18px_oklch(0_0_0/60%)]",
            "active:translate-y-0 active:bg-primary/90"
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
