"use client";

import type { PipecatClient } from "@pipecat-ai/client-js";
import { CalendarDaysIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ContributionHeatmap } from "@/components/home/contribution-heatmap";
import { InterviewPrepCard } from "@/components/home/interview-prep-card";
import type {
  LibraryCounts,
  MaterialsSegment,
} from "@/components/home/interview-prep-card";
import { LatencyCard } from "@/components/home/latency-card";
import { ModelUsageCard } from "@/components/home/model-usage-card";
import { RecentSessions } from "@/components/home/recent-sessions";
import { StartInterviewDialog } from "@/components/home/start-interview-dialog";
import { StartPanel } from "@/components/home/start-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WindowControls } from "@/components/window-controls";
import { listProfiles, type ProfileSummary } from "@/lib/materials";
import { qaStats } from "@/lib/qa";
import {
  fetchSessions,
  fetchSessionStats,
  type SessionStats,
  type SessionSummary,
} from "@/lib/sessions";
import { termStats } from "@/lib/terms";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 首页控制台。
 *
 * 12 栏网格：第一行是开始面试的主视觉 + 独立的统计/CTA 卡片；
 * 第二行是热力图（4）+ 首字响应（4）+ 模型消耗（4）；
 * 第三行是面试准备（4）+ 最近面试（8）。视觉沿用项目自己的 token。
 */
export function HomePage({
  dataVersion = 0,
  leadingExtras,
  headerExtras,
  defaultProfileId,
  audioClient,
  onStartInterview,
  onOpenMaterials,
  onOpenSession,
  onOpenHistory,
  onOpenMock,
}: {
  dataVersion?: number;
  /** 窄屏顶栏左侧的页面入口（桌面端由侧栏承担）。 */
  leadingExtras?: ReactNode;
  headerExtras?: ReactNode;
  defaultProfileId?: string | null;
  /** 开始面试弹窗里的音频设备选择复用这路客户端。 */
  audioClient?: PipecatClient | null;
  onStartInterview: (profileId: string) => void;
  onOpenMaterials: (segment: MaterialsSegment) => void;
  onOpenSession: (id: number) => void;
  onOpenHistory: () => void;
  onOpenMock: () => void;
}) {
  const { t } = useTranslation();

  const [stats, setStats] = useState<SessionStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [counts, setCounts] = useState<LibraryCounts>({
    profiles: null,
    questions: null,
    terms: null,
  });
  const [countsLoading, setCountsLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    defaultProfileId ?? null
  );

  const loadStats = useCallback(async () => {
    setStatsError(null);
    try {
      setStats(await fetchSessionStats());
    } catch (error) {
      setStatsError(errorMessage(error));
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsError(null);
    try {
      const data = await fetchSessions({ limit: 30 });
      setSessions(data.sessions);
    } catch (error) {
      setSessionsError(errorMessage(error));
    }
  }, []);

  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    const [profileList, qa, terms] = await Promise.allSettled([
      listProfiles(),
      qaStats(),
      termStats(),
    ]);
    setCounts({
      profiles:
        profileList.status === "fulfilled" ? profileList.value.length : null,
      questions: qa.status === "fulfilled" ? qa.value.total : null,
      terms: terms.status === "fulfilled" ? terms.value.total : null,
    });
    setCountsLoading(false);
  }, []);

  useEffect(() => {
    void loadStats();
    void loadSessions();
    void loadCounts();
  }, [dataVersion, loadStats, loadSessions, loadCounts]);

  const loadProfiles = useCallback(async () => {
    setProfileError(null);
    setProfiles(null);
    try {
      const list = await listProfiles();
      setProfiles(list);
      setSelectedId((current) =>
        list.some((item) => item.id === current)
          ? current
          : (list[0]?.id ?? null)
      );
    } catch (error) {
      setProfileError(errorMessage(error));
    }
  }, []);

  const openDialog = () => {
    setDialogOpen(true);
    void loadProfiles();
  };

  const confirmStart = () => {
    if (!selectedId) return;
    setDialogOpen(false);
    onStartInterview(selectedId);
  };

  const recent = sessions ? sessions.slice(0, 5) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 页头只放页面身份和窄屏导航；主操作在下面的面板里。 */}
      <header className="app-drag app-page-header flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {leadingExtras}
        <h1 className="hidden min-w-0 truncate text-sm font-semibold md:block">
          {t("nav.home")}
        </h1>
        <div className="app-no-drag ml-auto flex min-w-0 items-center gap-1.5">
          {headerExtras}
        </div>
        <WindowControls />
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 md:p-4 lg:overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3">
          {statsError && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs">
              <span className="min-w-0 flex-1">
                {t("home.loadFailed", { message: statsError })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2"
                onClick={() => void loadStats()}
              >
                {t("materials.retry")}
              </Button>
            </div>
          )}

          <StartPanel
            className="shrink-0"
            summary={stats?.summary ?? null}
            onStart={openDialog}
          />

          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-12">
            <Card className="flex flex-col gap-0 py-0 lg:col-span-4 lg:h-full lg:min-h-0">
              <CardHeader className="flex shrink-0 items-center gap-2 py-2.5">
                <CalendarDaysIcon className="text-muted-foreground size-4" />
                <CardTitle className="min-w-0 flex-1 text-sm">
                  {t("home.heatmap.title")}
                </CardTitle>
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  {t("home.heatmap.subtitle")}
                </span>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 px-3 py-3">
                {stats ? (
                  <ContributionHeatmap
                    heatmap={stats.heatmap}
                    weeks={5}
                    className="w-full"
                  />
                ) : (
                  <div className="bg-muted/50 h-full min-h-[190px] w-full animate-pulse rounded-lg" />
                )}
              </CardContent>
            </Card>

            <LatencyCard
              stats={stats}
              sessions={sessions}
              className="lg:col-span-4"
            />

            <ModelUsageCard
              stats={stats}
              sessions={sessions}
              className="lg:col-span-4"
            />
          </div>

          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-12">
            <InterviewPrepCard
              className="lg:col-span-4"
              counts={counts}
              loading={countsLoading}
              mockSessions={stats?.summary.mockSessions ?? 0}
              mockAccuracy={stats?.summary.mockAccuracy ?? null}
              onOpenMaterials={onOpenMaterials}
              onOpenMock={onOpenMock}
            />
            <RecentSessions
              className="lg:col-span-8"
              sessions={recent}
              error={sessionsError}
              onOpen={onOpenSession}
              onViewAll={onOpenHistory}
            />
          </div>
        </div>
      </div>

      <StartInterviewDialog
        open={dialogOpen}
        profiles={profiles}
        error={profileError}
        selectedId={selectedId}
        audioClient={audioClient}
        onSelect={setSelectedId}
        onConfirm={confirmStart}
        onClose={() => setDialogOpen(false)}
        onCreate={() => {
          setDialogOpen(false);
          onOpenMaterials("profiles");
        }}
        onRetry={() => void loadProfiles()}
      />
    </div>
  );
}
