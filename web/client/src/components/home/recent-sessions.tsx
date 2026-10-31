"use client";

import { ChevronRightIcon, HistoryIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration, formatTokens } from "@/lib/format";
import type { SessionSummary } from "@/lib/sessions";
import { cn } from "@/lib/utils";

function ModeDot({ mode }: { mode: SessionSummary["mode"] }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        mode === "live" ? "bg-heat-3" : "bg-muted-foreground/40"
      )}
      aria-hidden
    />
  );
}

/** 首页的最近 5 场：实时和模拟都在，点一条进历史详情。 */
export function RecentSessions({
  sessions,
  error,
  onOpen,
  onViewAll,
  className,
}: {
  sessions: SessionSummary[] | null;
  error: string | null;
  onOpen: (id: number) => void;
  onViewAll: () => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const loading = sessions === null && !error;
  const empty = !loading && !error && (sessions?.length ?? 0) === 0;

  return (
    <Card
      className={cn("flex min-h-0 flex-col gap-0 py-0 lg:h-full", className)}
    >
      <CardHeader className="flex shrink-0 items-center gap-2 border-b py-2.5">
        <HistoryIcon className="text-muted-foreground size-4" />
        <CardTitle className="min-w-0 flex-1 text-sm">
          {t("home.recent.title")}
        </CardTitle>
        <div className="flex shrink-0 items-center gap-1">
          {!empty && !loading && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onViewAll}
            >
              {t("home.recent.viewAll")}
              <ChevronRightIcon />
            </Button>
          )}
        </div>
      </CardHeader>

      {loading && (
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="bg-muted/60 min-h-10 flex-1 animate-pulse rounded-lg"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
          <p className="text-muted-foreground text-center text-xs">
            {t("home.recent.loadFailed", { message: error })}
          </p>
        </div>
      )}

      {empty && (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
          <p className="text-muted-foreground text-center text-xs">
            {t("home.recent.empty")}
          </p>
        </div>
      )}

      {!loading && !error && !empty && (
        <div className="flex min-h-0 flex-1 flex-col divide-y overflow-hidden">
          {(sessions ?? []).map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onOpen(session.id)}
              className="hover:bg-accent/40 flex min-h-0 w-full flex-1 items-center gap-2.5 overflow-hidden px-3 py-2 text-left transition-colors"
            >
              <ModeDot mode={session.mode} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs font-medium">
                    {session.mode === "mock"
                      ? t("nav.mockInterview")
                      : session.profileName || t("history.untitledProfile")}
                  </span>
                  {session.status === "interrupted" && (
                    <span className="bg-destructive/10 text-destructive shrink-0 rounded px-1 py-0.5 text-[10px]">
                      {t("history.status.interrupted")}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                  {formatDateTime(session.startedAt, i18n.language)}
                </span>
              </span>
              <span className="shrink-0 text-right text-[11px] tabular-nums">
                <span className="block">
                  {formatDuration(session.durationSec, i18n.language)}
                </span>
                <span className="text-muted-foreground mt-0.5 block">
                  {session.tokens.total > 0
                    ? `${formatTokens(session.tokens.total, i18n.language)} token`
                    : "—"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
