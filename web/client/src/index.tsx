import type { PipecatClient, TransportState } from "@pipecat-ai/client-js";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { PipecatClientProvider } from "@pipecat-ai/client-react";
import { createStore } from "jotai/vanilla";
import { SettingsIcon } from "lucide-react";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";

import "@/i18n";

import {
  HeaderDeviceButton,
  HEADER_SLOT,
  PortalTo,
  SidebarDevices,
} from "@/components/app-device-dock";
import { WindowControls } from "@/components/window-controls";
import { HistoryPage } from "@/components/history/history-page";
import { HomePage } from "@/components/home/home-page";
import type { MaterialsSegment } from "@/components/home/interview-prep-card";
import { DocumentsPage } from "@/components/documents/documents-page";
import { InterviewTimer } from "@/components/interview-timer";
import { MaterialsPage } from "@/components/materials/materials-page";
import {
  Console,
  type ConsoleProps,
} from "@/components/pipecat/console/console";
import { SettingsDialog } from "@/components/pipecat/settings-dialog";
import { AppSidebar, MobileNav, type AppPage } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLiveInterview } from "@/hooks/use-live-interview";
import { readLiveProfileId, saveLiveProfileId } from "@/lib/live-profile";
import {
  readCaptureMic,
  readDeviceId,
  saveCaptureMic,
  saveDeviceId,
} from "@/lib/preferences";
import { markSessionEnded } from "@/lib/sessions";
import { startBotParams } from "@/lib/session-request";
import type { TermCorrection } from "@/lib/terms";
import { readTheme, resolveDark, saveTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

import "./index.css";

const PAGE_KEY = "interview-assistant:page";
const SIDEBAR_WIDTH_KEY = "interview-assistant:sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "interview-assistant:sidebar-collapsed";
const SIDEBAR_DEFAULT_WIDTH = 224;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COLLAPSED_WIDTH = 56;

type TransportProps = Pick<
  ConsoleProps,
  "transportType" | "transportFactory" | "startBotParams"
>;

// 只保留浏览器直连的 SmallWebRTC：Daily / LiveKit / Twilio / WebSocket / MoQ
// 等调试用传输已从界面移除。
const SMALL_WEBRTC_PROPS: TransportProps = {
  transportType: "smallwebrtc",
  transportFactory: async () => {
    const { SmallWebRTCTransport } =
      await import("@pipecat-ai/small-webrtc-transport");
    return new SmallWebRTCTransport({ waitForICEGathering: true });
  },
  startBotParams: startBotParams(),
};

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function newInterviewId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initialSidebarWidth(): number {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? "");
  return Number.isFinite(stored) && stored >= SIDEBAR_MIN_WIDTH
    ? clampSidebarWidth(stored)
    : SIDEBAR_DEFAULT_WIDTH;
}

function Home() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captureMic, setCaptureMic] = useState(readCaptureMic);
  const [liveProfileId, setLiveProfileId] = useState<string | null>(
    readLiveProfileId
  );

  // 术语纠错提示：面试官那一路（Console 的 client）和候选人那一路（麦克风
  // session）各自推一条 server message，这里合并成一条列表。
  const [liveTerms, setLiveTerms] = useState<TermCorrection[]>([]);
  const handleServerMessage = useCallback((data: unknown) => {
    const payload = data as {
      kind?: string;
      corrections?: TermCorrection[];
    } | null;
    if (
      payload?.kind !== "glossary.corrected" ||
      !Array.isArray(payload.corrections)
    ) {
      return;
    }
    setLiveTerms((previous) => [...previous, ...payload.corrections!]);
  }, []);

  // 本场实时面试的 join key：面试官和候选人两路连接都带它，后端据此拼成一场。
  const [interviewId, setInterviewId] = useState(newInterviewId);
  const [autoStartToken, setAutoStartToken] = useState(0);
  // 模拟面试没有档案，单独一个 id，离开页面时换新的，避免两场并进一条记录。
  const [mockInterviewId, setMockInterviewId] = useState(newInterviewId);
  // 实时面试进行中锁住导航；连接失败、中途断开都算结束，放开导航。
  const [interviewEnded, setInterviewEnded] = useState(false);
  const liveWasLinked = useRef(false);

  const live = useLiveInterview({
    profileId: liveProfileId,
    interviewId,
    onServerMessage: handleServerMessage,
  });

  const handleLiveProfileChange = (id: string | null) => {
    setLiveProfileId(id);
    saveLiveProfileId(id);
  };

  const handleCaptureMicChange = (value: boolean) => {
    setCaptureMic(value);
    saveCaptureMic(value);
  };
  const [page, setPage] = useState<AppPage>(() => {
    const stored = localStorage.getItem(PAGE_KEY);
    // 面试页现在由首页「开始面试」进入；旧版本存的 interview 一律回到首页。
    return stored === "history" ||
      stored === "mock" ||
      stored === "materials" ||
      stored === "documents"
      ? stored
      : "home";
  });
  // 从首页/历史页跳过去时要打开的那一条记录、那一份档案。
  const [historyFocus, setHistoryFocus] = useState<number | null>(null);
  const [materialsSegment, setMaterialsSegment] = useState<
    MaterialsSegment | undefined
  >(undefined);
  const [materialsProfileFocus, setMaterialsProfileFocus] = useState<
    string | null
  >(null);
  // 设置里切换数据目录后，让面试材料页重新拉一次档案。
  const [dataVersion, setDataVersion] = useState(0);

  // Leaving the live page must end both sessions and stop the system-audio
  // capture; the Console only tears down its own client on unmount.
  useEffect(() => {
    if (page !== "interview") live.stopSession();
  }, [page, live.stopSession]);

  // 换页面就不再显示上一场的术语纠错。
  useEffect(() => {
    setLiveTerms([]);
  }, [page]);

  // Each page gets its own Pipecat store: transcript, metrics and events
  // belong to that page's session and never leak into the other one.
  const [liveStore] = useState(createStore);
  const [mockStore] = useState(createStore);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  );
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.toggle("dark", resolveDark(theme));
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const handleThemeChange = (mode: ThemeMode) => {
    setTheme(mode);
    saveTheme(mode);
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  const navigate = (next: AppPage) => {
    if (next === page) return;
    // 离开面试页就当作主动结束；没连上的话后端找不到记录，什么也不做。
    if (page === "interview") void markSessionEnded(interviewId);
    if (page === "mock") {
      void markSessionEnded(mockInterviewId);
      setMockInterviewId(newInterviewId());
    }
    if (next !== "history") setHistoryFocus(null);
    if (next !== "materials") setMaterialsProfileFocus(null);
    setPage(next);
    localStorage.setItem(PAGE_KEY, next);
  };

  /** 侧栏/小屏切换：从导航进来时不带任何「直接打开某条」的意图。 */
  const handleNavigate = (next: AppPage) => {
    if (next === "history") setHistoryFocus(null);
    if (next === "materials") setMaterialsProfileFocus(null);
    navigate(next);
  };

  /**
   * 面试页点「断开」并真的断开后回首页。
   * 会话记录是后端在连接断掉时收尾写库的，这里稍等一下再走，
   * 免得刚落地首页时列表里还看不到这一场。
   */
  const handleInterviewDisconnected = () => {
    setInterviewEnded(true);
    window.setTimeout(() => navigate("home"), 400);
  };

  /**
   * 面试官那一路的连接状态：连上过之后又断开（点断开、外部停止共享、网络错误）
   * 就算这一场结束，放开导航。刚进页面时 transport 初始化也会报一次
   * disconnected，那次不算。
   */
  const handleLiveStateChange = (state: TransportState) => {
    live.handleTransportStateChange(state);
    if (state === "connected" || state === "ready") {
      liveWasLinked.current = true;
      return;
    }
    if (state !== "disconnected" && state !== "error") return;
    if (liveWasLinked.current) {
      liveWasLinked.current = false;
      setInterviewEnded(true);
    }
  };

  const startInterview = (profileId: string) => {
    handleLiveProfileChange(profileId);
    // 新的一场：新的 join key，两路连接都会带上它。
    setInterviewId(newInterviewId());
    setAutoStartToken(Date.now());
    setInterviewEnded(false);
    liveWasLinked.current = false;
    navigate("interview");
  };

  const openMaterials = (segment: MaterialsSegment) => {
    setMaterialsSegment(segment);
    setMaterialsProfileFocus(null);
    navigate("materials");
  };

  const openSession = (id: number) => {
    setHistoryFocus(id);
    navigate("history");
  };

  const openHistory = () => {
    setHistoryFocus(null);
    navigate("history");
  };

  const openProfile = (profileId: string) => {
    setMaterialsSegment("profiles");
    setMaterialsProfileFocus(profileId);
    navigate("materials");
  };

  const goHome = () => navigate("home");

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    setResizing(true);

    const widthAt = (clientX: number) =>
      clampSidebarWidth(startWidth + clientX - startX);

    const onMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(widthAt(moveEvent.clientX));
    };
    const onEnd = (endEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      const finalWidth = widthAt(endEvent.clientX);
      setSidebarWidth(finalWidth);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(finalWidth)));
      setResizing(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const onClient = (client: PipecatClient) => {
    // Device choices are global: remember every switch and re-apply the
    // audio devices at the start of the next session (the page's own
    // selector covers the rest). The camera is deliberately not restored —
    // doing so would switch it on for users who had it on last time.
    client.on(RTVIEvent.MicUpdated, (mic) =>
      saveDeviceId("mic", mic?.deviceId)
    );
    client.on(RTVIEvent.SpeakerUpdated, (speaker) =>
      saveDeviceId("speaker", speaker?.deviceId)
    );

    let applied = false;
    client.on(RTVIEvent.Connected, () => {
      if (applied) return;
      applied = true;
      const mic = readDeviceId("mic");
      if (mic) client.updateMic(mic);
      const speaker = readDeviceId("speaker");
      if (speaker) client.updateSpeaker(speaker);
    });
  };

  // 实时面试进行中锁住导航：侧栏自动折叠、除设备选择外全部置灰，
  // 结束后（回到首页）才恢复；用户自己的折叠状态不受影响。
  const interviewLocked = page === "interview" && !interviewEnded;
  const sidebarFolded = sidebarCollapsed || interviewLocked;

  // Header extras shared by both pages. Devices live in the sidebar; only
  // small screens (where the sidebar is hidden) put an entry in the header.
  const settingsButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="md:hidden"
      aria-label={t("settings.title")}
      disabled={interviewLocked}
      onClick={() => setSettingsOpen(true)}
    >
      <SettingsIcon />
    </Button>
  );

  // 窄屏顶栏左侧的页面入口；桌面端由侧栏负责，所以按钮自带 md:hidden。
  const mobileNav = (
    <MobileNav
      activePage={page}
      onNavigate={handleNavigate}
      disabled={interviewLocked}
    />
  );
  const pageHeaderExtras = settingsButton;
  const liveDevices = { cam: true, screen: true, mic: !captureMic };

  // The mock page owns its client inside the Console, so the dock is portaled
  // from its header slot. The live page's devices belong to the mic session,
  // whose provider sits at this level.
  const mockHeaderSlot = (
    <>
      <SidebarDevices collapsed={sidebarCollapsed} version={page} />
      <HeaderDeviceButton />
      {settingsButton}
    </>
  );

  // 面试页顶栏不再放档案选择器：档案在开始前的弹窗里定下，面试中不换。
  const liveHeaderSlot = (
    <>
      <div id={HEADER_SLOT} />
      {settingsButton}
    </>
  );

  // 顶栏最左侧的面试计时器；每场面试换一个 key，重新从 00:00 开始。
  const liveLeadingSlot = (
    <>
      <InterviewTimer key={interviewId} />
      {mobileNav}
    </>
  );

  return (
    <TooltipProvider>
      {/* 桌面端：窗口按钮浮在页头右端，不单独占一条标题栏；浏览器里不渲染。 */}
      <WindowControls />
      <div
        className={cn(
          "flex h-dvh",
          resizing && "cursor-col-resize select-none"
        )}
      >
        <div
          className="hidden h-full shrink-0 md:block"
          style={{
            width: sidebarFolded ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth,
          }}
        >
          <AppSidebar
            collapsed={sidebarFolded}
            locked={interviewLocked}
            activePage={page}
            onNavigate={navigate}
            onToggle={toggleSidebar}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        {!sidebarFolded && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("nav.resize")}
            onPointerDown={startResize}
            className={cn(
              "relative hidden w-px shrink-0 cursor-col-resize items-center justify-center bg-border md:flex",
              resizing && "bg-ring"
            )}
          >
            <div className="z-10 h-6 w-1 shrink-0 rounded-lg bg-border" />
          </div>
        )}

        <div className="flex h-full min-w-0 flex-1 flex-col">
          {/* Each page owns its Console and connection; switching pages
              unmounts the other, so the two sessions stay independent. */}
          {page === "home" ? (
            <HomePage
              dataVersion={dataVersion}
              leadingExtras={mobileNav}
              headerExtras={pageHeaderExtras}
              defaultProfileId={liveProfileId}
              audioClient={live.micClient}
              onStartInterview={startInterview}
              onOpenMaterials={openMaterials}
              onOpenSession={openSession}
              onOpenHistory={openHistory}
              onOpenMock={() => navigate("mock")}
            />
          ) : page === "history" ? (
            <HistoryPage
              headerExtras={pageHeaderExtras}
              leadingExtras={mobileNav}
              focusSessionId={historyFocus}
              onFocusConsumed={() => setHistoryFocus(null)}
              onOpenProfile={openProfile}
              onGoHome={goHome}
            />
          ) : page === "interview" ? (
            <>
              {live.micError && (
                <div className="bg-destructive/10 text-destructive flex items-center gap-2 border-b px-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1">{live.micError}</span>
                  <button
                    type="button"
                    aria-label={t("header.dismissError")}
                    onClick={live.clearMicError}
                    className="shrink-0 opacity-70 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              )}
              {liveTerms.length > 0 && (
                <div className="bg-muted/40 flex items-center gap-2 border-b px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground shrink-0">
                    {t("terms.live.title")}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {liveTerms.map((item, index) => (
                      <span
                        key={`${item.from}-${item.to}-${index}`}
                        className="bg-background rounded-full px-1.5 py-0.5 text-[11px]"
                      >
                        {item.from} → {item.to}
                      </span>
                    ))}
                  </span>
                  <button
                    type="button"
                    aria-label={t("terms.live.dismiss")}
                    onClick={() => setLiveTerms([])}
                    className="shrink-0 opacity-70 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <Console
                  key="interview"
                  jotaiStore={liveStore}
                  transportType="smallwebrtc"
                  transportFactory={live.transportFactory}
                  startBotParams={live.startBotParams}
                  beforeConnect={live.beforeConnect}
                  disconnectSignal={live.disconnectSignal}
                  autoConnectSignal={autoStartToken}
                  onEnd={() => void markSessionEnded(interviewId)}
                  onDisconnected={handleInterviewDisconnected}
                  onConnectError={() => setInterviewEnded(true)}
                  liveConversation={{
                    messages: live.extraMessages,
                    interimText: live.interimText,
                  }}
                  onConnectionStateChange={handleLiveStateChange}
                  layout="interview"
                  layoutPersistenceKey="live-interview-v3"
                  collapseMetricsPanel
                  noLogo
                  titleText=""
                  noDTMF
                  leadingSlot={liveLeadingSlot}
                  headerSlot={liveHeaderSlot}
                  onClient={(client) => {
                    onClient(client);
                    client.on(RTVIEvent.ServerMessage, handleServerMessage);
                  }}
                />
              </div>
            </>
          ) : page === "mock" ? (
            <Console
              key="mock"
              jotaiStore={mockStore}
              {...SMALL_WEBRTC_PROPS}
              startBotParams={startBotParams("mock", {
                interviewId: mockInterviewId,
              })}
              onEnd={() => void markSessionEnded(mockInterviewId)}
              noLogo
              titleText=""
              noDTMF
              noUserAudio
              noUserVideo
              noScreenControl
              leadingSlot={mobileNav}
              headerSlot={mockHeaderSlot}
              onClient={onClient}
            />
          ) : page === "documents" ? (
            <DocumentsPage
              dataVersion={dataVersion}
              leadingExtras={mobileNav}
              headerExtras={pageHeaderExtras}
            />
          ) : (
            <MaterialsPage
              dataVersion={dataVersion}
              leadingExtras={mobileNav}
              initialSegment={materialsSegment}
              initialProfileId={materialsProfileFocus}
              headerExtras={pageHeaderExtras}
            />
          )}
        </div>

        {page === "interview" && live.micClient && (
          <PipecatClientProvider client={live.micClient}>
            <SidebarDevices
              collapsed={sidebarFolded}
              disabled={liveDevices}
              version={page}
            />
            <PortalTo id={HEADER_SLOT} version={page}>
              <HeaderDeviceButton disabled={liveDevices} />
            </PortalTo>
          </PipecatClientProvider>
        )}

        <SettingsDialog
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            setDataVersion((version) => version + 1);
          }}
          theme={theme}
          onThemeChange={handleThemeChange}
          captureMic={captureMic}
          onCaptureMicChange={handleCaptureMicChange}
        />
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>
);
