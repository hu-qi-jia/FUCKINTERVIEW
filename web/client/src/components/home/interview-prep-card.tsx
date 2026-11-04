"use client";

import {
  BookTypeIcon,
  BriefcaseBusinessIcon,
  ChevronRightIcon,
  FileUserIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MaterialsSegment = "profiles" | "questions" | "terms";

export interface LibraryCounts {
  profiles: number | null;
  questions: number | null;
  terms: number | null;
}

function MaterialTile({
  icon,
  label,
  count,
  loading,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count: number | null;
  loading: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group bg-muted/40 ring-foreground/5 hover:bg-accent/50",
        "flex min-w-0 flex-col gap-2 rounded-lg p-2 text-left ring-1 transition-colors"
      )}
    >
      <span className="bg-background text-muted-foreground ring-foreground/5 group-hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors">
        {icon}
      </span>
      <span className="mt-auto min-w-0">
        <span className="block truncate text-[11px] font-medium">{label}</span>
        <span className="text-muted-foreground mt-1 flex items-center justify-between gap-1 text-[11px] tabular-nums">
          <span className="truncate">
            {loading
              ? t("home.continue.loading")
              : count === null
                ? "—"
                : t("home.continue.count", { count })}
          </span>
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </button>
  );
}

/**
 * 材料准备度环形图：三份材料（档案 / 问答库 / 术语库）里有几份已经建好。
 * counts 还没读到时传 null，显示虚线圈和「—」。
 */
function ReadinessRing({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const ratio = value === null ? 0 : Math.min(1, Math.max(0, value));
  return (
    <div className={cn("relative aspect-square", className)}>
      <svg viewBox="0 0 72 72" className="size-full -rotate-90">
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          strokeWidth="4"
          stroke="currentColor"
          className="text-border"
          strokeDasharray={value === null ? "3 5" : undefined}
        />
        {value !== null && (
          <circle
            cx="36"
            cy="36"
            r={radius}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            stroke="currentColor"
            className="text-heat-4"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
        {value === null ? "—" : `${Math.round(ratio * 100)}%`}
      </span>
    </div>
  );
}

/**
 * 「面试准备」：上面是材料准备度（三份材料里有几份可用），
 * 下面是面试档案 / 问答库 / 术语库三个材料入口。
 * 点击准备度会直接打开第一份缺失的材料。
 */
export function InterviewPrepCard({
  counts,
  loading,
  onOpenMaterials,
  className,
}: {
  counts: LibraryCounts;
  loading: boolean;
  onOpenMaterials: (segment: MaterialsSegment) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  const items: {
    segment: MaterialsSegment;
    label: string;
    count: number | null;
  }[] = [
    {
      segment: "profiles",
      label: t("materials.tabs.profiles"),
      count: counts.profiles,
    },
    {
      segment: "questions",
      label: t("materials.tabs.questions"),
      count: counts.questions,
    },
    {
      segment: "terms",
      label: t("materials.tabs.terms"),
      count: counts.terms,
    },
  ];
  const known = !loading && items.every((item) => item.count !== null);
  const ready = items.filter((item) => (item.count ?? 0) > 0).length;
  const missing = items.find((item) => (item.count ?? 0) === 0);
  const target = missing?.segment ?? "profiles";
  const readiness = known ? ready / items.length : null;
  const caption = loading
    ? t("home.continue.checking")
    : !known
      ? t("home.continue.unknown")
      : missing
        ? t("home.continue.readyMissing", { item: missing.label })
        : t("home.continue.readyAll");

  return (
    <Card
      className={cn("flex min-h-0 flex-col gap-0 py-0 lg:h-full", className)}
    >
      <CardHeader className="flex shrink-0 items-center gap-2 py-2.5">
        <BriefcaseBusinessIcon className="text-muted-foreground size-4" />
        <CardTitle className="min-w-0 flex-1 text-sm">
          {t("home.continue.title")}
        </CardTitle>
        <button
          type="button"
          onClick={() => onOpenMaterials("profiles")}
          className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-0.5 text-[11px]"
        >
          {t("home.continue.manage")}
          <ChevronRightIcon className="size-3" />
        </button>
      </CardHeader>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 p-2.5">
        {/* 材料准备度：窗口高时环形图在上、数字在下；窗口变矮时自动改成
            左图右文。整块都可点，直接去补第一份缺失的材料。 */}
        <button
          type="button"
          onClick={() => onOpenMaterials(target)}
          className={cn(
            "group bg-muted/40 ring-foreground/5 hover:bg-accent/50 relative flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg px-3 pt-2 pb-2 text-center ring-1 transition-colors",
            "max-h-44 [@media(min-height:821px)]:pt-7",
            "[@media(max-height:820px)]:max-h-32 [@media(max-height:820px)]:flex-row [@media(max-height:820px)]:items-center [@media(max-height:820px)]:gap-4 [@media(max-height:820px)]:px-5 [@media(max-height:820px)]:py-3 [@media(max-height:820px)]:text-left"
          )}
        >
          <span className="flex min-h-0 w-full flex-1 items-center justify-center [@media(max-height:820px)]:w-auto [@media(max-height:820px)]:flex-none">
            <ReadinessRing
              value={readiness}
              className="h-full max-h-20 min-h-8 [@media(max-height:820px)]:size-14 [@media(max-height:820px)]:max-h-14 [@media(max-height:820px)]:min-h-14"
            />
          </span>

          <span className="flex min-w-0 flex-col items-center gap-0.5 [@media(max-height:820px)]:h-full [@media(max-height:820px)]:flex-1 [@media(max-height:820px)]:items-start [@media(max-height:820px)]:justify-between [@media(max-height:820px)]:gap-1.5 [@media(max-height:820px)]:py-0.5 [@media(max-height:820px)]:pr-5">
            <span className="pointer-events-none absolute inset-x-3 top-2 flex items-center justify-between [@media(max-height:820px)]:static [@media(max-height:820px)]:w-full [@media(max-height:820px)]:gap-2">
              <span className="text-[11px] font-medium">
                {t("home.continue.readiness")}
              </span>
              <ChevronRightIcon className="text-muted-foreground/60 size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 [@media(max-height:820px)]:absolute [@media(max-height:820px)]:top-1/2 [@media(max-height:820px)]:right-3 [@media(max-height:820px)]:-translate-y-1/2" />
            </span>

            <span className="flex items-baseline gap-1 text-lg leading-none font-semibold tabular-nums [@media(max-height:820px)]:text-xl">
              {known ? ready : "—"}
              <span className="text-muted-foreground text-[10px] font-normal">
                / {items.length} {t("home.continue.readinessUnit")}
              </span>
            </span>
            <span
              className="text-muted-foreground w-full truncate text-[10px] [@media(max-height:820px)]:text-[11px]"
              title={caption}
            >
              {caption}
            </span>
          </span>
        </button>

        <div className="grid shrink-0 grid-cols-3 gap-2">
          <MaterialTile
            icon={<FileUserIcon className="size-4" />}
            label={t("materials.tabs.profiles")}
            count={counts.profiles}
            loading={loading}
            onClick={() => onOpenMaterials("profiles")}
          />
          <MaterialTile
            icon={<MessageCircleQuestionIcon className="size-4" />}
            label={t("materials.tabs.questions")}
            count={counts.questions}
            loading={loading}
            onClick={() => onOpenMaterials("questions")}
          />
          <MaterialTile
            icon={<BookTypeIcon className="size-4" />}
            label={t("materials.tabs.terms")}
            count={counts.terms}
            loading={loading}
            onClick={() => onOpenMaterials("terms")}
          />
        </div>
      </div>
    </Card>
  );
}
