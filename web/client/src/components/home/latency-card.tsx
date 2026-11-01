"use client";

import { GaugeIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { InlineMetric } from "@/components/home/inline-metric";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDateTime, formatMs } from "@/lib/format";
import type { SessionStats, SessionSummary } from "@/lib/sessions";
import { cn } from "@/lib/utils";

function shortDate(value: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

/**
 * 「首字响应」：和面试页的性能面板同一套视觉，最近若干场实时面试的
 * 首字延迟（TTFT）与 TTFB 折线；上方是两项平均值。
 */
export function LatencyCard({
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
        ttft: session.ttftAvgMs,
        ttfb: session.ttfbAvgMs,
      }))
      .filter((row) => Number.isFinite(row.time) && row.ttft !== null);
  }, [sessions]);

  const config: ChartConfig = {
    ttft: {
      label: t("home.latency.firstToken"),
      color: "var(--heat-4)",
    },
    ttfb: {
      label: t("home.latency.ttfb"),
      color: "var(--heat-2)",
    },
  };

  return (
    <Card
      className={cn("flex min-h-0 flex-col gap-0 py-0 lg:h-full", className)}
    >
      <CardHeader className="flex shrink-0 items-center gap-2 py-2.5">
        <GaugeIcon className="text-muted-foreground size-4" />
        <CardTitle className="min-w-0 flex-1 text-sm">
          {t("home.latency.title")}
        </CardTitle>
        <span className="text-muted-foreground text-[11px]">
          {t("home.latency.subtitle")}
        </span>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-4 py-3">
        <div className="mb-2 flex shrink-0 items-stretch divide-x">
          <InlineMetric
            label={t("home.latency.avgTtft")}
            value={formatMs(summary?.avgTtftMs)}
            unit="ms"
          />
          <InlineMetric
            label={t("home.latency.avgTtfb")}
            value={formatMs(summary?.avgTtfbMs)}
            unit="ms"
          />
        </div>

        {rows.length >= 2 ? (
          <div className="min-h-[120px] flex-1 lg:min-h-0">
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
                  minTickGap={20}
                />
                <YAxis
                  width={34}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  tickFormatter={(value: number) => formatMs(value)}
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
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  type="linear"
                  dataKey="ttft"
                  stroke="var(--color-ttft)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="ttfb"
                  stroke="var(--color-ttfb)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </div>
        ) : (
          <div className="text-muted-foreground flex min-h-[120px] flex-1 items-center justify-center px-2 text-center text-xs lg:min-h-0">
            {t("home.latency.noData")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
