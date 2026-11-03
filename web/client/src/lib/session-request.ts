import type { APIRequest } from "@pipecat-ai/client-js";

/** Session modes understood by server.py's run_bot(). */
export type SessionMode = "live" | "listen";

/** Shared /start request data for the SmallWebRTC sessions. */
export const WEBRTC_REQUEST_DATA = {
  createDailyRoom: false,
  // 本机回环不需要 STUN；服务端默认会塞 Google STUN，反而让首连等 10 秒。
  enableDefaultIceServers: false,
  transport: "webrtc",
} as const;

/**
 * `/start` request for one session. The runner only forwards `body` to the
 * bot, so the mode (and any extra fields such as the bound interview
 * profile) must live there.
 */
export function startBotParams(
  mode?: SessionMode,
  extraBody?: Record<string, string>,
): APIRequest {
  const body = mode ? { mode, ...extraBody } : extraBody;
  return {
    endpoint: "/start",
    requestData: body
      ? { ...WEBRTC_REQUEST_DATA, body }
      : { ...WEBRTC_REQUEST_DATA },
  };
}
