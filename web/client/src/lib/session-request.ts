import type { APIRequest } from "@pipecat-ai/client-js";

/** Session modes understood by server.py's run_bot(). */
export type SessionMode = "live" | "listen" | "mock";

/** Shared /start request data for the SmallWebRTC sessions. */
export const WEBRTC_REQUEST_DATA = {
  createDailyRoom: false,
  enableDefaultIceServers: true,
  transport: "webrtc",
} as const;

/**
 * `/start` request for one session. The runner only forwards `body` to the
 * bot, so the mode must live there.
 */
export function startBotParams(mode?: SessionMode): APIRequest {
  return {
    endpoint: "/start",
    requestData: mode
      ? { ...WEBRTC_REQUEST_DATA, body: { mode } }
      : { ...WEBRTC_REQUEST_DATA },
  };
}
