/**
 * System-audio capture for the browser build.
 *
 * The desktop shell will replace the source with a native loopback stream,
 * but the rest of the chain (this module's output shape, the media manager,
 * the pipeline) stays the same.
 */

export type CaptureErrorCode = "unsupported" | "cancelled" | "no-audio";

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  constructor(code: CaptureErrorCode) {
    super(code);
    this.name = "CaptureError";
    this.code = code;
  }
}

/**
 * Asks the user to share their screen and keeps only the system-audio track.
 *
 * Chrome/Edge on Windows can attach system audio (WASAPI loopback) when the
 * user picks the entire screen and ticks "share system audio"; a browser tab
 * yields that tab's audio instead.
 */
export async function captureSystemAudio(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new CaptureError("unsupported");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // getDisplayMedia always needs video; we drop the track right away.
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Keep playing the captured audio locally so the candidate still
        // hears the interviewer.
        suppressLocalAudioPlayback: false,
      },
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new CaptureError("cancelled");
    }
    // Electron shells without a display-media handler land here.
    if (name === "NotSupportedError" || name === "TypeError") {
      throw new CaptureError("unsupported");
    }
    throw error;
  }

  for (const track of stream.getVideoTracks()) {
    track.stop();
    stream.removeTrack(track);
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    for (const track of stream.getTracks()) track.stop();
    throw new CaptureError("no-audio");
  }

  // 桌面端环回音轨偶尔会「存在但已经结束」；继续连接只会得到永远静音的
  // 会话，看起来像「识别不到声音」。这里直接当成没有系统音频。
  const ended = audioTracks.find((track) => track.readyState === "ended");
  if (ended || audioTracks.every((track) => track.readyState !== "live")) {
    for (const track of stream.getTracks()) track.stop();
    throw new CaptureError("no-audio");
  }

  // muted 在刚拿到环回音轨时可能短暂为 true（还没有声音播放），不阻断，
  // 但写进控制台方便排查「音轨在、始终静音」的问题。
  if (audioTracks.every((track) => track.muted)) {
    console.warn("[capture] 系统音频轨当前为 muted，可能暂时收不到声音");
  }

  return stream;
}
