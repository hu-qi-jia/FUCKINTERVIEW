"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { SessionStatsSummary } from "@/lib/sessions";
import { cn } from "@/lib/utils";

/** 祝福语轮播的间隔。太短会晃眼，太长就等于只有一句。 */
const CHEER_INTERVAL_MS = 7000;

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

  // 开始面试前那句祝福语轮着来：一次只出一行，换句时旧的淡出、新的淡入抬起。
  // 新旧下标放一个 state 里，切换是一次更新，两层不会错开。
  const rawCheers = t("home.cheers", { returnObjects: true }) as unknown;
  const cheers = Array.isArray(rawCheers)
    ? rawCheers.filter((item): item is string => typeof item === "string")
    : [];
  const [carousel, setCarousel] = useState<{
    index: number;
    previous: number | null;
  }>({ index: 0, previous: null });
  useEffect(() => {
    if (cheers.length < 2) return;
    const timer = setInterval(
      () =>
        setCarousel((state) => ({
          index: (state.index + 1) % cheers.length,
          previous: state.index,
        })),
      CHEER_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, [cheers.length]);
  const cheer = cheers[carousel.index] ?? "";
  const outgoing =
    carousel.previous === null ? "" : (cheers[carousel.previous] ?? "");

  return (
    <div
      className={cn(
        "grid items-center gap-4 lg:grid-cols-5 lg:gap-14",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 px-1 py-2 lg:col-span-3">
        {/* 一句一句轮着来的祝福语。换句时旧的淡出、新的淡入并抬起一点，
            两层叠着过渡；高度由新的一行撑住，不会跳版。 */}
        <div className="relative min-h-[1.4em]">
          {carousel.previous !== null && (
            <p
              key={`out-${carousel.index}`}
              aria-hidden
              className="absolute inset-x-0 top-0 text-[24px] leading-snug font-medium animate-out fade-out fill-mode-forwards duration-500 motion-reduce:hidden"
            >
              {outgoing}
            </p>
          )}
          <p
            key={carousel.index}
            className="text-[24px] leading-snug font-medium animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-500 motion-reduce:animate-none"
          >
            {cheer}
          </p>
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
