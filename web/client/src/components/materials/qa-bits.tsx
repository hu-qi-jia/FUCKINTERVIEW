"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { QaIndexStatus, QaType } from "@/lib/qa";

/** 和经历卡共用的徽标形状：小圆角、11px、单行。 */
export const BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-none";

const TYPE_TONES: Record<QaType, string> = {
  general: "bg-muted text-muted-foreground",
  behavioral: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  knowledge: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  project: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function TypeBadge({ type }: { type: QaType }) {
  const { t } = useTranslation();
  return <span className={cn(BADGE, TYPE_TONES[type])}>{t(`qa.type.${type}`)}</span>;
}

/** 标签：比分类更「可点」，所以给一圈描边；分类只是纯文字。 */
export function TagChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground border-border/70 rounded-md border px-1.5 py-0.5 text-[11px] leading-none">
      {children}
    </span>
  );
}

export function IndexDot({ status }: { status: QaIndexStatus }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        status === "ready"
          ? "bg-emerald-500"
          : status === "failed"
            ? "bg-destructive"
            : "bg-amber-500",
      )}
    />
  );
}
