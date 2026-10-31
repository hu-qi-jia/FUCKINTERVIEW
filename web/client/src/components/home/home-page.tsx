"use client";

import { CalendarDaysIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ContributionHeatmap } from "@/components/home/contribution-heatmap";
import { ModelUsageCard } from "@/components/home/model-usage-card";
import {
  QuickEntries,
  type MaterialsSegment,
  type QuickEntryCounts,
} from "@/components/home/quick-entries";
import { RecentSessions } from "@/components/home/recent-sessions";
import { StartInterviewDialog } from "@/components/home/start-interview-dialog";
import { StartPanel } from "@/components/home/start-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
 * 首页控制台：紧凑的 bento 布局。
 *
 * 页头只在窄屏保留页面切换与设置；桌面端直接进入数据区。开始面试的入口
 * 放在「最近面试」卡片的标题栏，和列表内容同属一组。
 */
export function HomePage({
  dataVersion = 0,
  headerExtras,
  defaultProfileId,
  onStartInterview,
  onOpenMaterials,
  onOpenSession,
  onOpenHistory,
}: {
  dataVersion?: number;
  headerExtras?: ReactNode;
  defaultProfileId?: string | null;
  onStartInterview: (profileId: string) => void;
  onOpenMaterials: (segment: MaterialsSegment) => void;
  onOpenSession: (id: number) => void;
  onOpenHistory: () => void;
}) {
  const { t } = useTranslation();

  const [stats, setStats] = useState<SessionStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [counts, setCounts] = useState<QuickEntryCounts>({
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="hidden min-w-0 truncate text-sm font-semibold md:block">
          {t("nav.home")}
        </h1>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {headerExtras}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 md:p-4 lg:overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3">
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

          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-2 xl:grid-cols-3">
            <Card className="flex flex-col gap-0 py-0 lg:h-full lg:min-h-0">
              <CardHeader className="flex shrink-0 items-center gap-2 border-b py-2.5">
                <CalendarDaysIcon className="text-muted-foreground size-4" />
                <CardTitle className="min-w-0 flex-1 text-sm">
                  {t("home.heatmap.title")}
                </CardTitle>
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  {t("home.heatmap.subtitle")}
                </span>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 items-center px-3 py-3">
                {stats ? (
                  <ContributionHeatmap
                    heatmap={stats.heatmap}
                    weeks={13}
                    cellSize={20}
                    className="w-full"
                  />
                ) : (
                  <div className="bg-muted/50 h-[190px] w-full animate-pulse rounded-lg" />
                )}
              </CardContent>
            </Card>

            <ModelUsageCard
              stats={stats}
              sessions={sessions}
              className="xl:col-span-2"
            />
          </div>

          <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-2 xl:grid-cols-3">
            <RecentSessions
              className="xl:col-span-2"
              sessions={recent}
              error={sessionsError}
              onOpen={onOpenSession}
              onViewAll={onOpenHistory}
            />
            <QuickEntries
              counts={counts}
              loading={countsLoading}
              onOpen={onOpenMaterials}
            />
          </div>
        </div>
      </div>

      <StartInterviewDialog
        open={dialogOpen}
        profiles={profiles}
        error={profileError}
        selectedId={selectedId}
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
