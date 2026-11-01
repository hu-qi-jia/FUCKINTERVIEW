"use client";

import {
  ArrowLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProfileFlow } from "@/components/materials/profile-flow";
import { QaLibrary, type QaLibraryHandle } from "@/components/materials/qa-library";
import {
  TermsLibrary,
  type TermsLibraryHandle,
} from "@/components/materials/terms-library";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WindowControls } from "@/components/window-controls";
import { useProfileEditor } from "@/hooks/use-profile-editor";
import {
  createProfile,
  deleteProfile,
  listProfiles,
  type ProfileSummary,
} from "@/lib/materials";

type Segment = "profiles" | "questions" | "terms";

const SEGMENT_KEY = "interview-assistant.materials-segment";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function readSegment(): Segment {
  const stored = localStorage.getItem(SEGMENT_KEY);
  return stored === "questions" || stored === "terms" ? stored : "profiles";
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

/**
 * 面试材料：顶部滑块切换 面试档案 / 问答库 / 热词库。
 * 面试档案先显示列表，点进某份档案才进入五步流程；本期其余两段是占位。
 */
export function MaterialsPage({
  headerExtras,
  leadingExtras,
  dataVersion = 0,
  initialSegment,
  initialProfileId,
}: {
  headerExtras?: React.ReactNode;
  /** 窄屏顶栏左侧的页面入口（桌面端由侧栏承担）。 */
  leadingExtras?: React.ReactNode;
  dataVersion?: number;
  /** 从首页快捷入口进来时直接停在对应 tab。 */
  initialSegment?: Segment;
  /** 从历史详情点档案名进来时直接打开这份档案。 */
  initialProfileId?: string | null;
}) {
  const { t } = useTranslation();
  const {
    profile,
    loadError,
    status,
    saveError,
    open,
    clear,
    patch,
    replace,
    applyCard,
    applyCoachSlots,
    flush,
    reload,
  } = useProfileEditor();

  const [summaries, setSummaries] = useState<ProfileSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>(
    () => initialSegment ?? readSegment(),
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusNameToken, setFocusNameToken] = useState(0);
  const [pendingDelete, setPendingDelete] = useState(false);
  // 删除确认浮层挂在「…」按钮上，菜单关掉后原地弹出。
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  // 问答库的「导入 / 新建」放在标签栏右侧，和面试档案的「新建档案」同一位置。
  const qaRef = useRef<QaLibraryHandle | null>(null);
  const [qaView, setQaView] = useState<"list" | "import">("list");
  const termsRef = useRef<TermsLibraryHandle | null>(null);

  const detailIdRef = useRef<string | null>(null);
  detailIdRef.current = detailId;

  const refresh = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const next = await listProfiles();
      setSummaries(next);
      if (detailIdRef.current && !next.some((item) => item.id === detailIdRef.current)) {
        // 正在看的档案被删掉了（比如换了数据目录）。
        clear();
        setDetailId(null);
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setListLoading(false);
    }
  }, [clear]);

  useEffect(() => {
    void refresh();
    if (detailIdRef.current) void reload();
    // 只在挂载和数据目录变化时重新拉取；其余切换由交互触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const changeSegment = (next: string) => {
    if (busy) return;
    const value = next as Segment;
    setSegment(value);
    setQaView("list");
    localStorage.setItem(SEGMENT_KEY, value);
  };

  const openDetail = async (id: string) => {
    if (busy) return;
    setPendingDelete(false);
    setDetailId(id);
    await open(id);
  };

  // 从首页快捷入口进来：把落地 tab 记进本地，下次从侧栏回来也停在这里。
  useEffect(() => {
    if (initialSegment) localStorage.setItem(SEGMENT_KEY, initialSegment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从历史详情点档案名进来：等档案列表拉完再打开，避免 open 拿到空列表。
  useEffect(() => {
    if (!initialProfileId) return;
    void openDetail(initialProfileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProfileId, dataVersion]);

  const backToList = async () => {
    if (busy) return;
    await flush();
    clear();
    setDetailId(null);
    setPendingDelete(false);
    await refresh();
  };

  const create = async () => {
    if (busy) return;
    await flush();
    try {
      const created = await createProfile(t("materials.newProfileName"));
      setSegment("profiles");
      localStorage.setItem(SEGMENT_KEY, "profiles");
      await refresh();
      await openDetail(created.id);
      setFocusNameToken((token) => token + 1);
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async () => {
    if (!profile) return;
    try {
      await deleteProfile(profile.id);
      setPendingDelete(false);
      clear();
      setDetailId(null);
      await refresh();
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    }
  };

  const saveLabel =
    status === "saving"
      ? t("materials.save.saving")
      : status === "saved"
        ? t("materials.save.saved")
        : status === "failed"
          ? t("materials.save.failedShort")
          : "";

  const inDetail = Boolean(detailId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 与其他页面一致的顶栏：左边是页面标题，小屏放页面切换和设置入口。 */}
      <header className="app-drag app-page-header flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {leadingExtras}
        <h1 className="hidden min-w-0 truncate text-sm font-semibold md:block">
          {t("nav.materials")}
        </h1>
        <div className="app-no-drag ml-auto flex min-w-0 items-center gap-1.5">
          {headerExtras}
        </div>
        <WindowControls />
      </header>

      <div className="shrink-0 pt-4">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-4">
          <Tabs value={segment} onValueChange={changeSegment}>
            {/* p-0：滑块容器去掉默认的 3px 内边距，让选中块和下面的卡片左边缘对齐 */}
            <TabsList className="h-8 overflow-hidden p-0">
              <TabsTrigger value="profiles" className="px-2.5">
                {t("materials.tabs.profiles")}
              </TabsTrigger>
              <TabsTrigger value="questions" className="px-2.5">
                {t("materials.tabs.questions")}
              </TabsTrigger>
              <TabsTrigger value="terms" className="px-2.5">
                {t("materials.tabs.terms")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {segment === "profiles" && (
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              {inDetail ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void backToList()}
                >
                  <ArrowLeftIcon />
                  {t("materials.backToList")}
                </Button>
              ) : (
                <Button size="sm" onClick={() => void create()}>
                  <PlusIcon />
                  {t("materials.newProfile")}
                </Button>
              )}
            </div>
          )}

          {segment === "questions" && (
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              {qaView === "import" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => qaRef.current?.backToList()}
                >
                  <ArrowLeftIcon />
                  {t("qa.import.back")}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => qaRef.current?.openImport()}
                  >
                    <UploadIcon />
                    {t("qa.import.open")}
                  </Button>
                  <Button size="sm" onClick={() => qaRef.current?.create()}>
                    <PlusIcon />
                    {t("qa.new")}
                  </Button>
                </>
              )}
            </div>
          )}

          {segment === "terms" && (
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => termsRef.current?.openBulk()}
              >
                <UploadIcon />
                {t("terms.bulk.open")}
              </Button>
              <Button size="sm" onClick={() => termsRef.current?.create()}>
                <PlusIcon />
                {t("terms.new")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {segment === "profiles" && inDetail && profile && (
        <div className="shrink-0 pt-3">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
              {profile.name || t("materials.untitled")}
            </h2>
            {saveLabel && (
              <span
                className="text-muted-foreground shrink-0 text-xs"
                title={status === "failed" ? (saveError ?? "") : undefined}
              >
                {saveLabel}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    ref={moreButtonRef}
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("materials.moreActions")}
                    disabled={busy}
                  />
                }
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setFocusNameToken((token) => token + 1)}
                >
                  {t("materials.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setPendingDelete(true)}
                >
                  {t("materials.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {segment === "profiles" && inDetail && profile && (
        <Popover open={pendingDelete} onOpenChange={setPendingDelete}>
          <PopoverContent
            anchor={() => moreButtonRef.current}
            align="end"
            sideOffset={6}
            className="w-64"
          >
            <p className="text-xs leading-relaxed">
              {t("materials.deleteConfirm", {
                name: profile.name || t("materials.untitled"),
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setPendingDelete(false)}
              >
                {t("materials.cancel")}
              </Button>
              <Button size="xs" variant="destructive" onClick={() => void remove()}>
                {t("materials.confirmDelete")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {status === "failed" && saveError && (
        <div className="text-destructive shrink-0 border-b px-4 py-1.5 text-xs">
          {t("materials.save.failed", { message: saveError })}
        </div>
      )}

      {listError && (inDetail || summaries.length > 0) && (
        <div className="text-destructive shrink-0 border-b px-4 py-1.5 text-xs">
          {listError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {segment === "questions" ? (
          <QaLibrary
            ref={qaRef}
            dataVersion={dataVersion}
            onViewChange={setQaView}
          />
        ) : segment === "terms" ? (
          <TermsLibrary ref={termsRef} dataVersion={dataVersion} />
        ) : inDetail ? (
          !profile ? (
            loadError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-destructive text-sm">
                  {t("materials.loadFailed", { message: loadError })}
                </p>
                <Button size="sm" variant="outline" onClick={() => void backToList()}>
                  {t("materials.backToList")}
                </Button>
              </div>
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
                <Spinner />
                {t("materials.loading")}
              </div>
            )
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto w-full max-w-7xl px-4 py-4">
                <ProfileFlow
                  profile={profile}
                  busy={busy}
                  focusNameToken={focusNameToken}
                  onPatch={patch}
                  onReplace={replace}
                  onApplyCard={applyCard}
                  onApplyCoachSlots={applyCoachSlots}
                  onFlush={flush}
                  onBusyChange={setBusy}
                />
              </div>
            </ScrollArea>
          )
        ) : listLoading && summaries.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
            <Spinner />
            {t("materials.loading")}
          </div>
        ) : listError && summaries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-destructive text-sm">
              {t("materials.loadFailed", { message: listError })}
            </p>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              {t("materials.retry")}
            </Button>
          </div>
        ) : summaries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium">{t("materials.empty.title")}</p>
            <p className="text-muted-foreground max-w-sm text-xs">
              {t("materials.empty.hint")}
            </p>
            <Button size="sm" onClick={() => void create()}>
              <PlusIcon />
              {t("materials.empty.create")}
            </Button>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-4">
              <ul className="grid gap-2">
                {summaries.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openDetail(item.id)}
                      disabled={busy}
                      className="bg-card ring-foreground/10 hover:bg-muted/40 flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition-colors disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {item.name || t("materials.untitled")}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {t(
                              item.language === "en"
                                ? "materials.steps.language.en"
                                : "materials.steps.language.zh",
                            )}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          {formatTime(item.updatedAt) && (
                            <span>
                              {t("materials.list.updatedAt", {
                                time: formatTime(item.updatedAt),
                              })}
                            </span>
                          )}
                          <span>
                            {t("materials.list.cards", {
                              count: item.cardCount,
                            })}
                          </span>
                          {!item.hasResume && (
                            <span>{t("materials.list.missingResume")}</span>
                          )}
                          {!item.hasJobDescription && (
                            <span>
                              {t("materials.list.missingJobDescription")}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
