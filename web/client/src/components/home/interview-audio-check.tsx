"use client";

import type { PipecatClient } from "@pipecat-ai/client-js";
import { PipecatClientProvider } from "@pipecat-ai/client-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { DeviceSelect } from "@/components/pipecat/device-select";
import { Spinner } from "@/components/ui/spinner";

/**
 * 开始面试前的音频检查：麦克风 / 扬声器直接用侧栏那套设备选择
 * （同一个 Pipecat 客户端、同一份设备名和「被禁止 / 被占用」状态），
 * 选定即生效，也会照常记进浏览器偏好。
 *
 * 只出内容，边框和位置由外层的音频弹窗负责。
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
    <div className="grid gap-2 p-3">
      <span className="text-xs font-medium">{t("home.start.audioTitle")}</span>

      {client ? (
        <PipecatClientProvider client={client}>
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-12 shrink-0 text-xs">
                {t("home.start.mic")}
              </span>
              <DeviceSelect kind="audioinput" className="h-8 min-w-0 flex-1" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-12 shrink-0 text-xs">
                {t("home.start.speaker")}
              </span>
              <DeviceSelect kind="audiooutput" className="h-8 min-w-0 flex-1" />
            </div>
          </div>
        </PipecatClientProvider>
      ) : (
        <div className="text-muted-foreground flex h-8 items-center gap-2 text-xs">
          <Spinner className="size-3.5" />
          {t("devices.loading")}
        </div>
      )}
    </div>
  );
}
