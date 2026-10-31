"use client";

import { CpuIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDateTime, formatMs, formatTokens } from "@/lib/format";
import type { SessionStats, SessionSummary } from "@/lib/sessions";
import { cn } from "@/lib/utils";

function shortDate(value: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

/**
 * 「模型与消耗」：当前模型 + 最近若干场实时面试的 token 折线图。
 * 数据取最近 30 场（和首页列表同一次请求），只画实时面试。
 */
export function ModelUsageCard({
  stats,
  sessions,
  className,
}: {
  stats: SessionStats | null;
  sessions: SessionSummary[] | null;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const summary = stats?.summary;

  const rows = useMemo(() => {
    return (sessions ?? [])
      .filter((session) => session.mode === "live")
      .slice()
      .reverse()
      .map((session) => ({
        time: Date.parse(session.startedAt),
        startedAt: session.startedAt,
        tokens: session.tokens.total,
      }))
      .filter((row) => Number.isFinite(row.time));
  }, [sessions]);

  const config: ChartConfig = {
    tokens: {
      label: t("home.models.tokenLine"),
      color: "var(--heat-4)",
    },
  };

  const models = [
    { label: t("home.models.asr"), value: stats?.models.asr.model },
    { label: t("home.models.llm"), value: stats?.models.llm.model },
    { label: t("home.models.tts"), value: stats?.models.tts.model },
  ];

  return (
    <Card
      className={cn("flex min-h-0 flex-col gap-0 py-0 lg:h-full", className)}
    >
      <CardHeader className="flex shrink-0 items-center gap-2 border-b py-2.5">
        <CpuIcon className="text-muted-foreground size-4" />
        <CardTitle className="min-w-0 flex-1 text-sm">
          {t("home.models.title")}
        </CardTitle>
        <span className="text-muted-foreground text-[11px]">
          {t("home.models.subtitle")}
        </span>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-4 py-3">
        <div className="text-muted-foreground mb-1.5 flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]">
          <span className="flex items-baseline gap-1">
            {t("home.models.avgTokensShort")}
            <b className="text-foreground text-sm font-semibold tabular-nums">
              {summary?.avgTokens
                ? formatTokens(summary.avgTokens, i18n.language)
                : "–"}
            </b>
          </span>
          <span className="flex items-baseline gap-1">
            {t("home.models.totalTokensShort")}
            <b className="text-foreground text-sm font-semibold tabular-nums">
              {summary ? formatTokens(summary.totalTokens, i18n.language) : "–"}
            </b>
          </span>
          <span className="flex items-baseline gap-1">
            {t("home.models.avgTtftShort")}
            <b className="text-foreground text-sm font-semibold tabular-nums">
              {formatMs(summary?.avgTtftMs)}
              <span className="text-muted-foreground ml-0.5 text-[10px] font-normal">
                ms
              </span>
            </b>
          </span>
        </div>

        {rows.length >= 2 ? (
          <div className="min-h-[144px] flex-1 lg:min-h-0">
            <ChartContainer config={config} className="h-full w-full">
              <LineChart data={rows} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={(value: number) =>
                    shortDate(value, i18n.language)
                  }
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis
                  width={36}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  tickFormatter={(value: number) =>
                    formatTokens(value, i18n.language)
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const startedAt = payload?.[0]?.payload?.startedAt;
                        return typeof startedAt === "string"
                          ? formatDateTime(startedAt, i18n.language)
                          : "";
                      }}
                    />
                  }
                />
                <Line
                  type="linear"
                  dataKey="tokens"
                  stroke="var(--color-tokens)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </div>
        ) : (
          <div className="text-muted-foreground flex min-h-[144px] flex-1 items-center justify-center text-xs lg:min-h-0">
            {t("home.models.noTrend")}
          </div>
        )}
      </CardContent>

      <div className="text-muted-foreground flex min-w-0 shrink-0 flex-wrap gap-x-3 gap-y-1 border-t px-4 py-2 text-[10px]">
        {models.map((model) => (
          <span
            key={model.label}
            className="min-w-0 max-w-full truncate"
            title={model.value || undefined}
          >
            <span className="opacity-70">{model.label}</span>{" "}
            {model.value || "—"}
          </span>
        ))}
      </div>
    </Card>
  );
}
