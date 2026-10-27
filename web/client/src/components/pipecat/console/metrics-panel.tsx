"use client";

import { CoinsIcon, GaugeIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ConsoleCollapsedSection,
  ConsolePanel,
  ConsolePanelContent,
  ConsolePanelHeader,
  ConsolePanelTitle,
} from "@/components/pipecat/console/panel";
import { Metrics } from "@/components/pipecat/metrics/metrics";
import { MetricsPerformance } from "@/components/pipecat/metrics/performance";
import { MetricsUsage } from "@/components/pipecat/metrics/usage";

export interface ConsoleMetricsPanelProps {
  /** Icon-strip rendering for a collapsed pane; sections open in popovers. */
  collapsed?: boolean;
  className?: string;
}

/**
 * Console metrics pane, moved out of the transcript tabs so it can sit in
 * its own column. Collapses to an icon strip, matching the audio and info
 * panes. Must be rendered inside a PipecatClientProvider.
 */
export function ConsoleMetricsPanel({
  collapsed = false,
  className,
}: ConsoleMetricsPanelProps) {
  const { t } = useTranslation();

  if (collapsed) {
    return (
      <div
        data-slot="console-metrics-panel"
        data-state="collapsed"
        className={className}
      >
        <div className="flex h-full flex-col items-center gap-1 py-2">
          <ConsoleCollapsedSection
            label={t("metrics.performance")}
            icon={<GaugeIcon />}
          >
            <MetricsPerformance />
          </ConsoleCollapsedSection>
          <ConsoleCollapsedSection
            label={t("metrics.usage")}
            icon={<CoinsIcon />}
          >
            <MetricsUsage />
          </ConsoleCollapsedSection>
        </div>
      </div>
    );
  }

  return (
    <ConsolePanel
      className={className}
      data-slot="console-metrics-panel"
      data-state="expanded"
    >
      <ConsolePanelHeader>
        <ConsolePanelTitle>{t("conversation.metrics")}</ConsolePanelTitle>
      </ConsolePanelHeader>
      <ConsolePanelContent>
        <Metrics />
      </ConsolePanelContent>
    </ConsolePanel>
  );
}
