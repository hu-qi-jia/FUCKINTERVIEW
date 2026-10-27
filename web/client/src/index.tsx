import type { PipecatClient } from "@pipecat-ai/client-js";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { SettingsIcon } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";

import "@/i18n";

import {
  Console,
  type ConsoleProps,
} from "@/components/pipecat/console/console";
import { SettingsDialog } from "@/components/pipecat/settings-dialog";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  readTheme,
  resolveDark,
  saveTheme,
  type ThemeMode,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

import "./index.css";

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
          <Console
            {...SMALL_WEBRTC_PROPS}
            titleText={t("nav.interview")}
            noDTMF
            headerSlot={
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label={t("settings.title")}
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon />
              </Button>
            }
            onClient={onClient}
          />
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
