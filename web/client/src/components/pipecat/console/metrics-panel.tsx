"use client";

import { CoinsIcon, GaugeIcon } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  ConsoleCollapsedSection,
  ConsolePanel,
  ConsolePanelActions,
  ConsolePanelContent,
  ConsolePanelHeader,
  ConsolePanelTitle,
} from "@/components/pipecat/console/panel";
import {
  MetricsTabContent,
  type MetricsTab,
} from "@/components/pipecat/metrics/metrics";
import { MetricsPerformance } from "@/components/pipecat/metrics/performance";
import { MetricsUsage } from "@/components/pipecat/metrics/usage";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface ConsoleMetricsPanelProps {
  /** Icon-strip rendering for a collapsed pane; sections open in popovers. */
  collapsed?: boolean;
  className?: string;
}

/**
 * Console metrics pane, moved out of the transcript tabs so it can sit in
 * its own column. The performance/usage switch lives in the pane header;
 * dragging the pane narrow collapses it to an icon strip, matching the audio
 * and info panes. Must be rendered inside a PipecatClientProvider.
 */
export function ConsoleMetricsPanel({
  collapsed = false,
  className,
}: ConsoleMetricsPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<MetricsTab>("performance");

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
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as MetricsTab)}
      className={cn("h-full gap-0", className)}
      data-slot="console-metrics-panel"
      data-state="expanded"
    >
      <ConsolePanel className="h-full">
        <ConsolePanelHeader>
          <ConsolePanelTitle>{t("conversation.metrics")}</ConsolePanelTitle>
          <ConsolePanelActions>
            <TabsList>
              <TabsTrigger value="performance">
                {t("metrics.performance")}
              </TabsTrigger>
              <TabsTrigger value="usage">{t("metrics.usage")}</TabsTrigger>
            </TabsList>
          </ConsolePanelActions>
        </ConsolePanelHeader>
        <ConsolePanelContent>
          <MetricsTabContent tab={tab} />
        </ConsolePanelContent>
      </ConsolePanel>
    </Tabs>
  );
}
