"use client";

import type { APIRequest, TransportState } from "@pipecat-ai/client-js";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { usePipecatApp } from "@/hooks/use-pipecat-app";
import { CaptureError, captureSystemAudio } from "@/lib/capture";
import { transcriptTimestamp, type LiveMessage } from "@/lib/live-message";
import { readCaptureMic, readDeviceId, saveDeviceId } from "@/lib/preferences";
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
export function useLiveInterview() {
  const { t } = useTranslation();
  const managerRef = useRef<SystemAudioMediaManager | null>(null);
  if (!managerRef.current) managerRef.current = new SystemAudioMediaManager();
  const manager = managerRef.current;

  const displayRef = useRef<MediaStream | null>(null);
  const [extraMessages, setExtraMessages] = useState<LiveMessage[]>([]);
  const [interimText, setInterimText] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  // Bumped when the user stops sharing from the browser's own bar, so the
  // Console can end the call instead of streaming silence.
  const [disconnectSignal, setDisconnectSignal] = useState(0);

  const micApp = usePipecatApp({
    transportType: "smallwebrtc",
    transportFactory: async () => new SmallWebRTCTransport({ waitForICEGathering: true }),
    initDevicesOnMount: false,
    startBotParams: {
      endpoint: "/start",
      requestData: {
        createDailyRoom: false,
        enableDefaultIceServers: true,
        transport: "webrtc",
        body: { mode: "listen" },
      },
    },
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
        setExtraMessages((previous) => [
          ...previous,
          {
            id: `${transcriptTimestamp(data.timestamp)}-${previous.length}`,
            text,
            createdAt: transcriptTimestamp(data.timestamp),
            from: "candidate",
          },
        ]);
      });
    },
  });

  const transportFactory = useCallback(
    async () =>
      new SmallWebRTCTransport({
        waitForICEGathering: true,
        mediaManager: manager,
      } as unknown as ConstructorParameters<typeof SmallWebRTCTransport>[0]),
    [manager],
  );

  const startBotParams = useMemo<APIRequest>(
    () => ({
      endpoint: "/start",
      requestData: {
        createDailyRoom: false,
        enableDefaultIceServers: true,
        transport: "webrtc",
        body: { mode: "live" },
      },
    }),
    [],
  );

  const stopCapture = useCallback(() => {
    manager.stop();
    for (const track of displayRef.current?.getTracks() ?? []) track.stop();
    displayRef.current = null;
    setInterimText("");
  }, [manager]);

  const beforeConnect = useCallback(async () => {
    setMicError(null);
    setInterimText("");
    setExtraMessages([]);

    try {
      const stream = await captureSystemAudio();
      displayRef.current = stream;
      manager.setStream(stream);
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
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

    if (!readCaptureMic() || !micApp.client) return;

    try {
      const client = micApp.client;
      if (client.needsInit()) await client.initDevices();
      const stored = readDeviceId("mic");
      if (stored) client.updateMic(stored);
      await micApp.connect();
    } catch (error) {
      setMicError(
        t("errors.micSession", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }, [manager, micApp, t]);

  const handleTransportStateChange = useCallback(
    (state: TransportState) => {
      if (state !== "disconnected" && state !== "error") return;
      stopCapture();
      void micApp.disconnect();
    },
    [micApp, stopCapture],
  );

  return {
    transportFactory,
    startBotParams,
    beforeConnect,
    handleTransportStateChange,
    extraMessages,
    interimText,
    micClient: micApp.client,
    micError,
    clearMicError: () => setMicError(null),
    disconnectSignal,
  };
}
