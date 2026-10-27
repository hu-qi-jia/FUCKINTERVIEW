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
import { Button } from "@/components/ui/button";
import {
  readTheme,
  resolveDark,
  saveTheme,
  type ThemeMode,
} from "@/lib/theme";

import "./index.css";

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

function Home() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const onClient = (client: PipecatClient) => {
    client.on(RTVIEvent.MicUpdated, (mic) => {
      (window as Window & { client?: PipecatClient }).client = client;
      console.log("Mic updated:", mic);
    });
  };

  return (
    <div className="h-dvh">
      <Console
        {...SMALL_WEBRTC_PROPS}
        titleText={t("app.title")}
        noDTMF
        headerSlot={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("settings.title")}
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </Button>
        }
        onClient={onClient}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={handleThemeChange}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
