"use client";

import type { PipecatClient } from "@pipecat-ai/client-js";
import { PipecatClientProvider } from "@pipecat-ai/client-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { DeviceSelect } from "@/components/pipecat/device-select";
import { Spinner } from "@/components/ui/spinner";

/**
 * 开始面试前的音频检查。设备选择直接用侧栏那套（同一个 Pipecat 客户端、
 * 同一份设备名和「被禁止 / 被占用」状态），选定即生效，
 * 也会照常记进浏览器偏好，供接下来的两路会话使用。
 */
export function InterviewAudioCheck({
  client,
}: {
  client?: PipecatClient | null;
}) {
  const { t } = useTranslation();

  // 枚举设备要客户端先初始化过设备；顺带把麦克风授权要下来，
  // 开始面试时就不用再弹一次。
  useEffect(() => {
    if (!client?.needsInit()) return;
    void client.initDevices().catch(() => undefined);
  }, [client]);

  return (
    <section
      aria-label={t("home.start.audioTitle")}
      className="border-border grid gap-2.5 rounded-xl border p-3"
    >
      <div className="grid gap-0.5">
        <span className="text-xs font-medium">
          {t("home.start.audioTitle")}
        </span>
        <span className="text-muted-foreground text-[11px] leading-relaxed">
          {t("home.start.audioHint")}
        </span>
      </div>

      {client ? (
        <PipecatClientProvider client={client}>
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-12 shrink-0 text-xs">
                {t("home.start.mic")}
              </span>
              <DeviceSelect
                kind="audioinput"
                className="h-8 min-w-0 flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-12 shrink-0 text-xs">
                {t("home.start.speaker")}
              </span>
              <DeviceSelect
                kind="audiooutput"
                className="h-8 min-w-0 flex-1"
              />
            </div>
          </div>
        </PipecatClientProvider>
      ) : (
        <div className="text-muted-foreground flex h-8 items-center gap-2 text-xs">
          <Spinner className="size-3.5" />
          {t("devices.loading")}
        </div>
      )}
    </section>
  );
}
