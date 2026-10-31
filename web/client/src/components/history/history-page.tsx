"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SessionDetailView } from "@/components/history/session-detail";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatDateTime,
  formatDuration,
  formatTokens,
} from "@/lib/format";
import { fetchSessions, type SessionMode, type SessionSummary } from "@/lib/sessions";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;
type Filter = "all" | SessionMode;

function ModeDot({ mode }: { mode: SessionMode }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        mode === "live" ? "bg-heat-3" : "bg-muted-foreground/40",
      )}
      aria-hidden
    />
  );
}

/**
 * 历史记录：实时和模拟都在这一页。列表每次 30 条，点一条看完整转写。
 * 进详情时列表只是隐藏、不卸载，返回后筛选和滚动位置都还在。
 */
export function HistoryPage({
  headerExtras,
  focusSessionId = null,
  onFocusConsumed,
  onOpenProfile,
  onGoHome,
}: {
  headerExtras?: ReactNode;
  focusSessionId?: number | null;
  onFocusConsumed?: () => void;
  onOpenProfile: (profileId: string) => void;
  onGoHome: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(focusSessionId);

  const consumedRef = useRef(focusSessionId);
  useEffect(() => {
    if (focusSessionId === null || consumedRef.current === focusSessionId) return;
    consumedRef.current = focusSessionId;
    setDetailId(focusSessionId);
    onFocusConsumed?.();
  }, [focusSessionId, onFocusConsumed]);

  const requestId = useRef(0);

  const loadFirst = useCallback(async () => {
    const request = ++requestId.current;
    setSessions(null);
    setError(null);
    try {
      const data = await fetchSessions({
        mode: filter,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (request !== requestId.current) return;
      setSessions(data.sessions);
      setTotal(data.total);
    } catch (reason) {
      if (request !== requestId.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setSessions([]);
    }
  }, [filter]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchSessions({
        mode: filter,
        limit: PAGE_SIZE,
        offset: sessions?.length ?? 0,
      });
      setSessions((previous) => [...(previous ?? []), ...data.sessions]);
      setTotal(data.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingMore(false);
    }
  }, [filter, loadingMore, sessions?.length]);

  const loading = sessions === null && !error;
  const empty = !loading && !error && (sessions?.length ?? 0) === 0;
  const remaining = Math.max(0, total - (sessions?.length ?? 0));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="min-w-0 truncate text-sm font-semibold">
          {t("history.title")}
        </h1>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {headerExtras}
        </div>
      </header>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          detailId !== null && "hidden",
        )}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-4">
          <div className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5">
            {(["all", "live", "mock"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  filter === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`history.filter.${value}`)}
              </button>
            ))}
          </div>
          {!loading && !error && (
            <span className="text-muted-foreground ml-auto text-xs tabular-nums">
              {t("history.total", { count: total })}
            </span>
          )}
        </div>

        <ScrollArea className="mt-3 min-h-0 flex-1">
          <div className="mx-auto grid w-full max-w-3xl gap-3 px-4 pb-8">
            {loading && (
              <div className="grid gap-2">
                {[0, 1, 2, 3].map((row) => (
                  <div
                    key={row}
                    className="bg-muted/60 h-14 animate-pulse rounded-lg"
                  />
                ))}
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-muted-foreground text-sm">
                  {t("history.loadFailed", { message: error })}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadFirst()}
                >
                  {t("materials.retry")}
                </Button>
              </div>
            )}

            {empty && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm font-medium">{t("history.empty.title")}</p>
                <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">
                  {t("history.empty.hint")}
                </p>
                <Button size="sm" variant="outline" onClick={onGoHome}>
                  {t("history.empty.goHome")}
                </Button>
              </div>
            )}

            {!loading && !error && !empty && (
              <Card className="divide-y gap-0 py-0">
                {(sessions ?? []).map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setDetailId(session.id)}
                    className="hover:bg-accent/40 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
                  >
                    <ModeDot mode={session.mode} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {session.mode === "mock"
                            ? t("nav.mockInterview")
                            : session.profileName ||
                              t("history.untitledProfile")}
                        </span>
                        {session.status === "interrupted" && (
                          <span className="bg-destructive/10 text-destructive shrink-0 rounded px-1 py-0.5 text-[10px]">
                            {t("history.status.interrupted")}
                          </span>
                        )}
                        {session.mode === "live" && (
                          <span className="text-muted-foreground shrink-0 text-[11px]">
                            {t("history.mode.live")}
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                        {formatDateTime(session.startedAt, i18n.language)}
                      </span>
                    </span>
                    <span className="text-muted-foreground flex shrink-0 flex-col items-end gap-0.5 text-xs tabular-nums">
                      <span className="text-foreground">
                        {formatDuration(session.durationSec, i18n.language)}
                      </span>
                      <span>
                        {t("history.rowTurns", { count: session.turnCount })}
                        {" · "}
                        {session.tokens.total > 0
                          ? `${formatTokens(session.tokens.total, i18n.language)} token`
                          : "—"}
                      </span>
                    </span>
                  </button>
                ))}
              </Card>
            )}

            {!loading && !error && !empty && remaining > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mx-auto"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore && <LoaderCircleIcon className="animate-spin" />}
                {t("history.loadMore", { count: remaining })}
              </Button>
            )}
          </div>
        </ScrollArea>
      </div>

      {detailId !== null && (
        <div className="min-h-0 flex-1">
          <SessionDetailView
            sessionId={detailId}
            onBack={() => setDetailId(null)}
            onOpenProfile={onOpenProfile}
          />
        </div>
      )}
    </div>
  );
}
