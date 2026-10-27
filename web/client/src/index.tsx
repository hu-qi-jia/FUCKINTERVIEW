import type { PipecatClient } from "@pipecat-ai/client-js";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { createStore } from "jotai/vanilla";
import { SettingsIcon } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";

import "@/i18n";

import { Console, type ConsoleProps } from "@/components/pipecat/console/console";
import { SettingsDialog } from "@/components/pipecat/settings-dialog";
import { AppSidebar, type AppPage } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  readTheme,
  resolveDark,
  saveTheme,
  type ThemeMode,
} from "@/lib/theme";
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
    const { SmallWebRTCTransport } = await import(
      "@pipecat-ai/small-webrtc-transport"
    );
    return new SmallWebRTCTransport({ waitForICEGathering: true });
  },
  startBotParams: {
    endpoint: `/start`,
    requestData: {
      createDailyRoom: false,
      enableDefaultIceServers: true,
      transport: "webrtc",
    },
  },
};

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

const PAGES: AppPage[] = ["interview", "mock"];
const pageLabelKey = (page: AppPage) =>
  page === "mock" ? "nav.mockInterview" : "nav.interview";

/**
 * Small-screen page switcher. The sidebar is hidden below 768px, so the
 * console header carries the two pages instead.
 */
function PageSwitch({
  page,
  onNavigate,
}: {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      items={PAGES.map((value) => ({ value, label: t(pageLabelKey(value)) }))}
      value={page}
      onValueChange={(value) => onNavigate(value as AppPage)}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("nav.switchPage")}
        className="h-8 w-28 md:hidden"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {PAGES.map((value) => (
          <SelectItem key={value} value={value}>
            {t(pageLabelKey(value))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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
  const [page, setPage] = useState<AppPage>(() =>
    localStorage.getItem(PAGE_KEY) === "mock" ? "mock" : "interview",
  );

  // Each page gets its own Pipecat store: transcript, metrics and events
  // belong to that page's session and never leak into the other one.
  const [liveStore] = useState(createStore);
  const [mockStore] = useState(createStore);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
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
    setPage(next);
    localStorage.setItem(PAGE_KEY, next);
  };

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
    client.on(RTVIEvent.MicUpdated, (mic) => {
      (window as Window & { client?: PipecatClient }).client = client;
      console.log("Mic updated:", mic);
    });
  };

  // Console header extras: the small-screen page switcher (the sidebar is
  // hidden there) and the settings entry.
  const headerSlot = (
    <>
      <PageSwitch page={page} onNavigate={navigate} />
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label={t("settings.title")}
        onClick={() => setSettingsOpen(true)}
      >
        <SettingsIcon />
      </Button>
    </>
  );

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex h-dvh",
          resizing && "cursor-col-resize select-none",
        )}
      >
        <div
          className="hidden h-full shrink-0 md:block"
          style={{
            width: sidebarCollapsed
              ? SIDEBAR_COLLAPSED_WIDTH
              : sidebarWidth,
          }}
        >
          <AppSidebar
            collapsed={sidebarCollapsed}
            activePage={page}
            onNavigate={navigate}
            onToggle={toggleSidebar}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        {!sidebarCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("nav.resize")}
            onPointerDown={startResize}
            className={cn(
              "relative hidden w-px shrink-0 cursor-col-resize items-center justify-center bg-border md:flex",
              resizing && "bg-ring",
            )}
          >
            <div className="z-10 h-6 w-1 shrink-0 rounded-lg bg-border" />
          </div>
        )}

        <div className="h-full min-w-0 flex-1">
          {/* Each page owns its Console and connection; switching pages
              unmounts the other, so the two sessions stay independent. */}
          {page === "interview" ? (
            <Console
              key="interview"
              jotaiStore={liveStore}
              {...SMALL_WEBRTC_PROPS}
              layout="interview"
              layoutPersistenceKey="live-interview"
              titleText={t("nav.interview")}
              noDTMF
              headerSlot={headerSlot}
              onClient={onClient}
            />
          ) : (
            <Console
              key="mock"
              jotaiStore={mockStore}
              {...SMALL_WEBRTC_PROPS}
              titleText={t("nav.mockInterview")}
              noDTMF
              headerSlot={headerSlot}
              onClient={onClient}
            />
          )}
        </div>

        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
