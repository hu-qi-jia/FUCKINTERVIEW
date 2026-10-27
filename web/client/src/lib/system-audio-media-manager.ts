import type { Tracks } from "@pipecat-ai/client-js";

/**
 * Media manager that hands the transport a pre-captured audio track.
 *
 * SmallWebRTCTransport only supports one outbound audio track, and its
 * default manager captures the microphone via Daily. The live interview
 * sends the *interviewer* over that track, so we swap the manager for this
 * thin one: `setStream` is called with the system-audio stream right before
 * connecting, and every device call is a no-op.
 */
export class SystemAudioMediaManager {
  private track: MediaStreamTrack | null = null;
  private micEnabled = true;

  setStream(stream: MediaStream | null): void {
    const next = stream?.getAudioTracks()[0] ?? null;
    if (this.track && this.track !== next) this.track.stop();
    this.track = next;
  }

  /** Stops the captured track (e.g. when the call ends). */
  stop(): void {
    this.track?.stop();
    this.track = null;
  }

  setClientOptions(): void {}

  async initialize(): Promise<void> {}

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  tracks(): Tracks {
    return {
      local: this.track ? { audio: this.track } : {},
    };
  }

  async getAllMics(): Promise<MediaDeviceInfo[]> {
    return [];
  }

  async getAllCams(): Promise<MediaDeviceInfo[]> {
    return [];
  }

  async getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    return [];
  }

  async updateMic(): Promise<void> {}

  async updateCam(): Promise<void> {}

  async updateSpeaker(): Promise<void> {}

  get selectedMic(): Record<string, never> {
    return {};
  }

  get selectedCam(): Record<string, never> {
    return {};
  }

  get selectedSpeaker(): Record<string, never> {
    return {};
  }

  enableMic(enable: boolean): void {
    this.micEnabled = enable;
  }

  enableCam(): void {}

  async enableScreenShare(): Promise<void> {}

  get isMicEnabled(): boolean {
    return this.micEnabled;
  }

  get isCamEnabled(): boolean {
    return false;
  }

  get isSharingScreen(): boolean {
    return false;
  }

  get supportsScreenShare(): boolean {
    return false;
  }
}
