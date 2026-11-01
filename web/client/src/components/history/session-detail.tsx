"use client";

import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Metric } from "@/components/pipecat/metric";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatMs,
  formatPercent,
  formatTokens,
} from "@/lib/format";
import {
  fetchSession,
  type SessionDetail,
  type SessionTurn,
} from "@/lib/sessions";
import { cn } from "@/lib/utils";

function TurnCard({
  turn,
  mode,
  expanded,
  onToggle,
}: {
  turn: SessionTurn;
  mode: SessionDetail["mode"];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isAi = turn.role === "ai";
  const long = turn.text.length > 90 || turn.text.includes("\n");
  const collapsible = isAi && long;
  const showFull = !collapsible || expanded;
  const label =
    turn.role === "interviewer"
      ? t("history.role.interviewer")
      : turn.role === "candidate"
        ? t("history.role.candidate")
        : mode === "mock"
          ? t("history.role.aiMock")
          : t("history.role.ai");

  return (
    <div className="bg-card ring-foreground/10 rounded-lg px-3 py-2.5 ring-1">
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            turn.role === "ai"
              ? "bg-heat-1/60 text-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {label}
        </span>        {turn.source === "qa" && (
          <span className="text-muted-foreground bg-secondary shrink-0 rounded px-1.5 py-0.5 text-[10px]">
            {t("history.source.qa")}
          </span>
        )}
        <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1 text-[11px] tabular-nums">
          <ClockIcon className="size-3" />
          {formatClock(turn.createdAt, i18n.language)}
        </span>
      </div>

      <p
        className={cn(
          "text-sm leading-relaxed whitespace-pre-wrap",
          !showFull && "line-clamp-2",
        )}
      >
        {turn.text}
      </p>

      {collapsible && (
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-0.5 text-[11px]"
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="size-3" />
              {t("history.collapse")}
            </>
          ) : (
            <>
              <ChevronDownIcon className="size-3" />
              {t("history.expand")}
            </>
          )}
        </button>
      )}
    </div>
  );
}

/** 单场面试详情：摘要 + 按时间顺序的完整对话。 */
export function SessionDetailView({
  sessionId,
  onBack,
  onOpenProfile,
}: {
  sessionId: number;
  onBack: () => void;
  onOpenProfile: (profileId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setExpanded(new Set());
    fetchSession(sessionId)
      .then((session) => {
        if (!cancelled) setDetail(session);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const qaRatio = useMemo(() => {
    if (!detail || detail.aiTurnCount <= 0) return null;
    return detail.qaHitCount / detail.aiTurnCount;
  }, [detail]);

  const toggle = (id: number) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onBack}>
          <ArrowLeftIcon />
          {t("history.backToList")}
        </Button>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          {detail
            ? formatDateTime(detail.startedAt, i18n.language)
            : t("history.detail.loading")}
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-5">
          {!detail && !error && (
            <div className="text-muted-foreground flex h-64 items-center justify-center gap-2 text-sm">
              <Spinner className="size-4" />
              {t("history.detail.loading")}
            </div>
          )}

          {error && (
            <p className="text-destructive py-16 text-center text-sm">
              {t("history.detail.loadFailed", { message: error })}
            </p>
          )}

          {detail && (
            <>
              <Card className="gap-0 py-0">
                <CardHeader className="gap-2 border-b py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        detail.mode === "live"
                          ? "bg-heat-3"
                          : "bg-muted-foreground/40",
                      )}
                    />
                    {detail.mode === "live" && detail.profileId ? (
                      <button
                        type="button"
                        onClick={() => onOpenProfile(detail.profileId!)}
                        className="min-w-0 truncate text-sm font-medium hover:underline"
                      >
                        {detail.profileName || t("history.untitledProfile")}
                      </button>
                    ) : (
                      <CardTitle className="min-w-0 truncate text-sm">
                        {detail.mode === "mock"
                          ? t("nav.mockInterview")
                          : detail.profileName || t("history.untitledProfile")}
                      </CardTitle>
                    )}
                    {detail.mode === "live" && (
                      <span className="text-muted-foreground shrink-0 text-[11px]">
                        {t("history.mode.live")}
                      </span>
                    )}
                    {detail.status === "interrupted" && (
                      <span className="bg-destructive/10 text-destructive shrink-0 rounded px-1.5 py-0.5 text-[10px]">
                        {t("history.status.interrupted")}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatDateTime(detail.startedAt, i18n.language)}
                    {" · "}
                    {formatDuration(detail.durationSec, i18n.language)}
                  </p>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-3">
                  <Metric
                    label={t("history.detail.totalTokens")}
                    value={detail.tokens.total}
                    format={(value) => formatTokens(value, i18n.language)}
                  />
                  <Metric
                    label={t("history.detail.promptTokens")}
                    value={detail.tokens.prompt}
                    format={(value) => formatTokens(value, i18n.language)}
                  />
                  <Metric
                    label={t("history.detail.completionTokens")}
                    value={detail.tokens.completion}
                    format={(value) => formatTokens(value, i18n.language)}
                  />
                  <Metric
                    label={t("history.detail.ttft")}
                    value={detail.ttftAvgMs}
                    format={formatMs}
                    unit="ms"
                  />
                  <Metric
                    label={t("history.detail.ttfb")}
                    value={detail.ttfbAvgMs}
                    format={formatMs}
                    unit="ms"
                  />
                  <Metric
                    label={t("history.detail.turns")}
                    value={detail.turnCount}
                  />
                  <Metric
                    label={t("history.detail.qaRatio")}
                    value={qaRatio}
                    format={formatPercent}
                  />
                  <Metric
                    label={t("history.detail.sttSeconds")}
                    value={Math.round(detail.sttSeconds)}
                    unit="s"
                  />
                </CardContent>

                <div className="grid gap-1.5 border-t px-4 py-3 text-xs">
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="text-muted-foreground shrink-0">
                      {t("home.models.asr")}
                    </span>
                    <span className="truncate text-right">
                      {detail.models.asr || "—"}
                    </span>
                  </div>
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="text-muted-foreground shrink-0">
                      {t("home.models.llm")}
                    </span>
                    <span className="truncate text-right">
                      {detail.models.llm || "—"}
                    </span>
                  </div>
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="text-muted-foreground shrink-0">
                      {t("home.models.tts")}
                    </span>
                    <span className="truncate text-right">
                      {detail.models.tts || "—"}
                    </span>
                  </div>
                </div>

                {detail.corrections.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-3">
                    <span className="text-muted-foreground text-xs">
                      {t("history.detail.corrections", {
                        count: detail.corrections.filter(
                          (item) => item.kind === "corrected",
                        ).length,
                      })}
                    </span>
                    {detail.corrections.map((item, index) => (
                      <span
                        key={`${item.from}-${item.to}-${index}`}
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[11px]",
                          item.kind === "corrected"
                            ? "bg-secondary"
                            : "border border-dashed",
                        )}
                      >
                        {item.from} → {item.to}
                      </span>
                    ))}
                  </div>
                )}
              </Card>

              <section className="grid gap-2">
                <h2 className="text-muted-foreground px-0.5 text-xs font-medium">
                  {t("history.detail.transcript")}
                </h2>
                {detail.turns.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {t("history.detail.emptyTranscript")}
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {detail.turns.map((turn) => (
                      <TurnCard
                        key={turn.id}
                        turn={turn}
                        mode={detail.mode}
                        expanded={expanded.has(turn.id)}
                        onToggle={() => toggle(turn.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
