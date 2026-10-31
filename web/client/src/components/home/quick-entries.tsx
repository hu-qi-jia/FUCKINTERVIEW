"use client";

import {
  BookOpenIcon,
  ChevronRightIcon,
  LanguagesIcon,
  MessagesSquareIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MaterialsSegment = "profiles" | "questions" | "terms";

export interface QuickEntryCounts {
  profiles: number | null;
  questions: number | null;
  terms: number | null;
}

function Entry({
  icon,
  title,
  count,
  loading,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  count: number | null;
  loading: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="group hover:bg-accent/40 flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
    >
      <span className="bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{title}</span>
        <span className="text-muted-foreground mt-0.5 block text-[11px] tabular-nums">
          {loading
            ? t("home.quick.loading")
            : count === null
              ? "—"
              : t("home.quick.count", { count })}
        </span>
      </span>
      <ChevronRightIcon className="text-muted-foreground/60 size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/** 面试材料 / 问答库 / 术语库三个入口，点击直达材料页对应 tab。 */
export function QuickEntries({
  counts,
  loading,
  onOpen,
  className,
}: {
  counts: QuickEntryCounts;
  loading: boolean;
  onOpen: (segment: MaterialsSegment) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Card
      className={cn("flex min-h-0 flex-col gap-0 py-0 lg:h-full", className)}
    >
      <CardHeader className="flex shrink-0 items-center gap-2 border-b py-2.5">
        <ZapIcon className="text-muted-foreground size-4" />
        <CardTitle className="min-w-0 flex-1 text-sm">
          {t("home.quick.title")}
        </CardTitle>
      </CardHeader>
      <div className="flex min-h-0 flex-1 flex-col justify-center divide-y">
        <Entry
          icon={<BookOpenIcon className="size-4" />}
          title={t("materials.tabs.profiles")}
          count={counts.profiles}
          loading={loading}
          onClick={() => onOpen("profiles")}
        />
        <Entry
          icon={<MessagesSquareIcon className="size-4" />}
          title={t("materials.tabs.questions")}
          count={counts.questions}
          loading={loading}
          onClick={() => onOpen("questions")}
        />
        <Entry
          icon={<LanguagesIcon className="size-4" />}
          title={t("materials.tabs.terms")}
          count={counts.terms}
          loading={loading}
          onClick={() => onOpen("terms")}
        />
      </div>
    </Card>
  );
}
