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
 * 模拟面试报告准确率。报告功能接入前 accuracy 为 null：显示虚线圈和「—」，
 * 有报告后传 0–1 的小数即可画出进度弧。尺寸由外部决定，空间紧张时会自动缩小。
 */
function AccuracyRing({
  accuracy,
  className,
}: {
  accuracy: number | null;
  className?: string;
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const ratio = accuracy === null ? 0 : Math.min(1, Math.max(0, accuracy));
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
          strokeDasharray={accuracy === null ? "3 5" : undefined}
        />
        {accuracy !== null && (
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
        {accuracy === null ? "—" : `${Math.round(accuracy * 100)}%`}
      </span>
    </div>
  );
}

/**
 * 「面试准备」：上面是模拟面试（次数 + 报告准确率，纵向排），
 * 下面是面试档案 / 问答库 / 术语库三个材料入口。
 * 材料图标分别用「简历里的人」「带问号的对话」「词典/术语」来表达原意。
 */
export function InterviewPrepCard({
  counts,
  loading,
  mockSessions,
  mockAccuracy,
  onOpenMaterials,
  onOpenMock,
  className,
}: {
  counts: LibraryCounts;
  loading: boolean;
  mockSessions: number;
  mockAccuracy: number | null;
  onOpenMaterials: (segment: MaterialsSegment) => void;
  onOpenMock: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

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
        {/* 模拟面试：环形图在上、次数和说明在下，整块都可点。
            高度上限压住，卡片被拉高时内容居中而不是被抻散。 */}
        <button
          type="button"
          onClick={onOpenMock}
          className="group bg-muted/40 ring-foreground/5 hover:bg-accent/50 relative flex max-h-44 min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-3 pt-7 pb-2 text-center ring-1 transition-colors"
        >
          <span className="pointer-events-none absolute inset-x-3 top-2 flex items-center justify-between">
            <span className="text-[11px] font-medium">
              {t("home.continue.mock")}
            </span>
            <ChevronRightIcon className="text-muted-foreground/60 size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>

          <span className="flex min-h-0 w-full flex-1 items-center justify-center">
            <AccuracyRing
              accuracy={mockAccuracy}
              className="h-full max-h-20 min-h-8"
            />
          </span>

          <span className="flex items-baseline gap-1 text-lg leading-none font-semibold tabular-nums">
            {mockSessions}
            <span className="text-muted-foreground text-[10px] font-normal">
              {t("home.continue.mockUnit")}
            </span>
          </span>
          <span className="text-muted-foreground w-full truncate text-[10px]">
            {mockAccuracy === null
              ? t("home.continue.mockPending")
              : t("home.continue.mockReady")}
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
