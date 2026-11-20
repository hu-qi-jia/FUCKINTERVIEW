"use client";

import type { TransportState } from "@pipecat-ai/client-js";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { usePipecatApp } from "@/hooks/use-pipecat-app";
import {
  CaptureError,
  captureSystemAudio,
  type CapturedSystemAudio,
} from "@/lib/capture";
import { transcriptTimestamp, type LiveMessage } from "@/lib/live-message";
import { readCaptureMic, readDeviceId, saveDeviceId } from "@/lib/preferences";
import { startBotParams as buildStartBotParams } from "@/lib/session-request";
import { SystemAudioMediaManager } from "@/lib/system-audio-media-manager";

/**
 * Two Pipecat sessions for the live interview:
 *
 * - the Console owns the interviewer session (system audio -> STT -> LLM);
 * - this hook owns the candidate session (microphone -> STT only), whose
 *   transcripts are merged into the left-hand conversation.
 *
 * Capture happens on the connect click: the browser picker must run inside a
 * user gesture, and the system-audio track has to exist before the transport
 * negotiates.
 */
export function useLiveInterview({
  profileId,
  interviewId,
  onServerMessage,
}: {
  /** 实时面试绑定的面试档案；随 /start 下发给后端。 */
  profileId?: string | null;
  /** 本场面试 id：面试官和候选人两路连接都带上它，后端据此拼成一场。 */
  interviewId?: string;
  /** 后端推来的自定义消息（目前只有术语纠错）。 */
  onServerMessage?: (data: unknown) => void;
} = {}) {
  const { t } = useTranslation();
  const managerRef = useRef<SystemAudioMediaManager | null>(null);
  if (!managerRef.current) managerRef.current = new SystemAudioMediaManager();
  const manager = managerRef.current;

  // 回调每次渲染都会换引用，用 ref 保证连接时注册的是最新那个。
  const serverMessageRef = useRef(onServerMessage);
  serverMessageRef.current = onServerMessage;

  const displayRef = useRef<CapturedSystemAudio | null>(null);
  const [extraMessages, setExtraMessages] = useState<LiveMessage[]>([]);
  const [interimText, setInterimText] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  // Bumped when the user stops sharing from the browser's own bar, so the
  // Console can end the call instead of streaming silence.
  const [disconnectSignal, setDisconnectSignal] = useState(0);

  const micApp = usePipecatApp({
    transportType: "smallwebrtc",
    transportFactory: async () =>
      new SmallWebRTCTransport({
        waitForICEGathering: false,
        iceServers: [],
      }),
    initDevicesOnMount: false,
    startBotParams: buildStartBotParams(
      "listen",
      interviewId ? { interviewId } : undefined,
    ),
    onClient: (client) => {
      client.on(RTVIEvent.MicUpdated, (mic) => saveDeviceId("mic", mic?.deviceId));
      client.on(RTVIEvent.CamUpdated, (cam) => saveDeviceId("cam", cam?.deviceId));
      client.on(RTVIEvent.SpeakerUpdated, (speaker) =>
        saveDeviceId("speaker", speaker?.deviceId),
      );
      client.on(RTVIEvent.Connected, () => {
        setExtraMessages([]);
        setInterimText("");
      });
      client.on(RTVIEvent.UserTranscript, (data) => {
        const text = data?.text?.trim();
        if (!text) return;
        if (!data.final) {
          setInterimText(text);
          return;
        }
        setInterimText("");
        setExtraMessages((previous) => {
          const createdAt = transcriptTimestamp(data.timestamp);
          return [
            ...previous,
            {
              id: `${createdAt}-${previous.length}`,
              text,
              createdAt,
              from: "candidate",
            },
          ];
        });
      });
      client.on(RTVIEvent.ServerMessage, (data) => {
        serverMessageRef.current?.(data);
      });
    },
  });

  const transportFactory = useCallback(
    async () =>
      new SmallWebRTCTransport({
        // 本地回环只要 host candidate 就够了；等 STUN 完成会让首连慢 10 秒，
        // 还可能撞上服务端的连接超时。
        waitForICEGathering: false,
        iceServers: [],
        mediaManager: manager,
      } as unknown as ConstructorParameters<typeof SmallWebRTCTransport>[0]),
    [manager],
  );

  const liveStartBotParams = buildStartBotParams("live", {
    ...(profileId ? { profileId } : {}),
    ...(interviewId ? { interviewId } : {}),
  });

  const stopCapture = useCallback(() => {
    manager.stop();
    displayRef.current?.dispose();
    displayRef.current = null;
    setInterimText("");
  }, [manager]);

  /**
   * 连接前的准备：取系统音频 + 起候选人那路会话。
   *
   * 返回的 `micReady` 是候选人会话的连接结果，**不在这一步 await**——
   * 调用方把它和面试官那路一起 `Promise.all`，两路管线并行启动。
   * 早先这里是串行的：候选人那路一路跑到 bot-ready，才轮到面试官那路发 /start，
   * 两次完整的管线组装排成一列，是进面试页最慢的一段。
   *
   * 它永不 reject：麦克风那路失败只是少一路转写，不该把整场面试拦下来，
   * 所以错误落在 micError 上，让界面提示。
   */
  const beforeConnect =
    useCallback(async (): Promise<{ micReady: Promise<void> }> => {
      setMicError(null);

      try {
        const capture = await captureSystemAudio();
        displayRef.current = capture;
        manager.setStream(capture.stream);
        capture.source.getAudioTracks()[0]?.addEventListener("ended", () => {
          setDisconnectSignal((value) => value + 1);
        });
      } catch (error) {
        if (error instanceof CaptureError) {
          const message =
            error.code === "cancelled"
              ? t("errors.captureCancelled")
              : error.code === "no-audio"
                ? t("errors.noSystemAudio")
                : t("errors.captureUnsupported");
          throw new Error(message);
        }
        throw error;
      }

      // From here on a new session is really starting; only now is it safe to
      // drop the previous transcript.
      setInterimText("");
      setExtraMessages([]);

      const micReady = (async () => {
        if (!readCaptureMic() || !micApp.client) return;
        try {
          const client = micApp.client;
          if (client.needsInit()) await client.initDevices();
          const stored = readDeviceId("mic");
          if (stored) {
            // The client's updateMic drops the transport promise; await the
            // transport directly so the device switch finishes before connect.
            await Promise.resolve(
              (client.transport.updateMic as (id: string) => unknown)(stored),
            );
          }
          await micApp.connect();
        } catch (error) {
          setMicError(
            t("errors.micSession", {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      })();

      return { micReady };
    }, [manager, micApp, t]);

  const stopSession = useCallback(() => {
    stopCapture();
    void micApp.disconnect();
  }, [micApp, stopCapture]);

  /**
   * 清掉上一场留在界面上的转写和错误。新一场在真正连上之前也要先清，
   * 否则首页点「开始面试」后、系统音频选择器还开着的那几秒里，会看到
   * 上一场的候选人发言冒充这一场。
   */
  const reset = useCallback(() => {
    setExtraMessages([]);
    setInterimText("");
    setMicError(null);
  }, []);

  const handleTransportStateChange = useCallback(
    (state: TransportState) => {
      if (state !== "disconnected" && state !== "error") return;
      stopSession();
    },
    [stopSession],
  );

  return {
    transportFactory,
    startBotParams: liveStartBotParams,
    beforeConnect,
    stopSession,
    reset,
    handleTransportStateChange,
    extraMessages,
    interimText,
    micClient: micApp.client,
    micError,
    clearMicError: () => setMicError(null),
    disconnectSignal,
  };
}
