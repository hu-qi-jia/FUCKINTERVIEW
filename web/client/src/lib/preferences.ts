/**
 * Preferences that only the browser needs (no server round-trip).
 *
 * Language and theme already live in their own modules; these are the
 * live-interview switches and the globally remembered device choices.
 */

export type DeviceSlot = "mic" | "cam" | "speaker";

const CAPTURE_MIC_KEY = "interview-assistant:capture-mic";
const deviceKey = (slot: DeviceSlot) => `interview-assistant:device:${slot}`;

/** Whether the candidate's microphone is transcribed in the live interview. */
export function readCaptureMic(): boolean {
  return localStorage.getItem(CAPTURE_MIC_KEY) !== "0";
}

export function saveCaptureMic(value: boolean): void {
  localStorage.setItem(CAPTURE_MIC_KEY, value ? "1" : "0");
}

/** Device choice shared by both pages (and, later, the desktop shell). */
export function readDeviceId(slot: DeviceSlot): string | null {
  return localStorage.getItem(deviceKey(slot));
}

export function saveDeviceId(slot: DeviceSlot, deviceId?: string): void {
  if (deviceId) localStorage.setItem(deviceKey(slot), deviceId);
}
