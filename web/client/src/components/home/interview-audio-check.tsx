"use client";

import { Volume2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDeviceLabel } from "@/components/pipecat/device-select";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { readDeviceId, saveDeviceId } from "@/lib/preferences";

/** 浏览器把「系统默认」也叫一个设备；统一用这个值代表它。 */
const DEFAULT_DEVICE = "default";

/** 浏览器自带的两个别名设备，和上面的「系统默认」重复，列表里不显示。 */
const ALIAS_DEVICE_IDS = new Set([DEFAULT_DEVICE, "communications"]);

function isAudioInput(device: MediaDeviceInfo): boolean {
  return device.kind === "audioinput";
}

function isAudioOutput(device: MediaDeviceInfo): boolean {
  return device.kind === "audiooutput";
}

/**
 * 麦克风电平条。自己跑 requestAnimationFrame 直接改 DOM，
 * 不把采样写进 React state——否则每帧都会重渲染整个弹窗。
 */
function MicLevel({ stream }: { stream: MediaStream | null }) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !stream) return;
    if (typeof AudioContext === "undefined") return;

    const context = new AudioContext();
    // 自动播放策略下偶尔会挂起，分析器要跑起来才有电平。
    void context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    let frame = 0;
    let smoothed = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const value = (data[index] - 128) / 128;
        sum += value * value;
      }
      // 正常说话时 RMS 大约 0.03–0.25，放大后铺满这条 0–1 的条。
      const target = Math.min(1, Math.sqrt(sum / data.length) * 3.4);
      smoothed = target > smoothed ? target : smoothed * 0.88 + target * 0.12;
      bar.style.transform = `scaleX(${Math.max(0.02, smoothed).toFixed(3)})`;
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [stream]);

  return (
    <span
      role="img"
      aria-label={t("home.start.micLevel")}
      className="bg-muted block h-1.5 w-16 shrink-0 overflow-hidden rounded-full"
    >
      <span
        ref={barRef}
        className="block h-full w-full origin-left rounded-full bg-[var(--heat-4)]"
        style={{ transform: "scaleX(0.02)" }}
      />
    </span>
  );
}

function useAudioDevices() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    try {
      const list = await media.enumerateDevices();
      setMics(
        list.filter(
          (device) =>
            isAudioInput(device) && !ALIAS_DEVICE_IDS.has(device.deviceId)
        )
      );
      setSpeakers(
        list.filter(
          (device) =>
            isAudioOutput(device) && !ALIAS_DEVICE_IDS.has(device.deviceId)
        )
      );
    } catch {
      // 枚举失败就保留上一次的列表，弹窗里仍然可以选「系统默认」。
    }
  }, []);

  useEffect(() => {
    void refresh();
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const handleChange = () => void refresh();
    media.addEventListener("devicechange", handleChange);
    return () => media.removeEventListener("devicechange", handleChange);
  }, [refresh]);

  return { mics, speakers, refresh };
}

/**
 * 开始面试前的音频检查：选麦克风 / 扬声器，边说话边看电平条，
 * 点「试听」确认声音从选中的扬声器出来。选择即时写进浏览器偏好，
 * 连接时两路会话都按这里的设备走。
 */
export function InterviewAudioCheck() {
  const { t } = useTranslation();
  const { mics, speakers, refresh } = useAudioDevices();
  const [micId, setMicId] = useState(
    () => readDeviceId("mic") ?? DEFAULT_DEVICE
  );
  const [speakerId, setSpeakerId] = useState(
    () => readDeviceId("speaker") ?? DEFAULT_DEVICE
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [speakerError, setSpeakerError] = useState(false);
  const testingTimer = useRef(0);

  // 打开弹窗就申请一次麦克风：既拿到设备名称，也让电平条有东西可画。
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setMicError(t("home.start.micUnsupported"));
      return;
    }
    let cancelled = false;
    let active: MediaStream | null = null;

    const start = async () => {
      try {
        const captured = await media.getUserMedia({
          audio:
            micId && micId !== DEFAULT_DEVICE
              ? { deviceId: { exact: micId } }
              : true,
          video: false,
        });
        if (cancelled) {
          captured.getTracks().forEach((track) => track.stop());
          return;
        }
        active = captured;
        setStream(captured);
        setMicError(null);
        // 授权之后浏览器才会给出设备名称，重新枚举一次。
        void refresh();
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof Error ? error.name : "";
        if (name === "OverconstrainedError" || name === "NotFoundError") {
          // 记着的设备已经拔掉了：清掉、退回系统默认再来一次。
          saveDeviceId("mic", DEFAULT_DEVICE);
          setMicId(DEFAULT_DEVICE);
          return;
        }
        setStream(null);
        setMicError(
          t(
            name === "NotAllowedError"
              ? "home.start.micBlocked"
              : "home.start.micFailed"
          )
        );
      }
    };
    void start();

    return () => {
      cancelled = true;
      active?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [micId, refresh, t]);

  const testSpeaker = useCallback(async () => {
    setSpeakerError(false);
    setTesting(true);
    window.clearTimeout(testingTimer.current);
    testingTimer.current = window.setTimeout(() => setTesting(false), 700);
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      // 短暂的一声「叮」，带起落，免得爆音。
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, context.currentTime + 0.04);
      gain.gain.setValueAtTime(0.12, context.currentTime + 0.3);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.42);
      oscillator.connect(gain);
      gain.connect(destination);

      const audio = new Audio() as HTMLAudioElement & {
        setSinkId?: (deviceId: string) => Promise<void>;
      };
      audio.srcObject = destination.stream;
      if (speakerId !== DEFAULT_DEVICE) await audio.setSinkId?.(speakerId);
      await audio.play();
      oscillator.start();
      oscillator.stop(context.currentTime + 0.45);
      window.setTimeout(() => {
        oscillator.disconnect();
        audio.pause();
        audio.srcObject = null;
        void context.close();
      }, 800);
    } catch {
      setSpeakerError(true);
    }
  }, [speakerId]);

  useEffect(() => () => window.clearTimeout(testingTimer.current), []);

  const micItems = [
    { value: DEFAULT_DEVICE, label: t("home.start.systemDefault") },
    ...mics.map((device) => ({
      value: device.deviceId,
      label: formatDeviceLabel(device, t("devices.microphone")),
    })),
  ];
  const speakerItems = [
    { value: DEFAULT_DEVICE, label: t("home.start.systemDefault") },
    ...speakers.map((device) => ({
      value: device.deviceId,
      label: formatDeviceLabel(device, t("devices.speaker")),
    })),
  ];

  const handleMicChange = (value: string) => {
    setMicId(value);
    saveDeviceId("mic", value);
  };
  const handleSpeakerChange = (value: string) => {
    setSpeakerId(value);
    saveDeviceId("speaker", value);
  };

  const showHint = !micError && !speakerError;

  return (
    <div className="grid gap-2">
      <span className="text-muted-foreground text-xs font-medium">
        {t("home.start.audioTitle")}
      </span>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-12 shrink-0 text-xs">
          {t("home.start.mic")}
        </span>
        <Select
          items={micItems}
          value={micId}
          onValueChange={(value) => handleMicChange(String(value))}
        >
          <SelectTrigger
            aria-label={t("devices.selectMicrophone")}
            className="h-8 min-w-0 flex-1"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {micItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <MicLevel stream={stream} />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-12 shrink-0 text-xs">
          {t("home.start.speaker")}
        </span>
        <Select
          items={speakerItems}
          value={speakerId}
          onValueChange={(value) => handleSpeakerChange(String(value))}
        >
          <SelectTrigger
            aria-label={t("devices.selectSpeaker")}
            className="h-8 min-w-0 flex-1"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {speakerItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          disabled={testing}
          onClick={() => void testSpeaker()}
        >
          <Volume2Icon />
          {t("home.start.testSpeaker")}
        </Button>
      </div>

      {micError && (
        <p className="text-destructive text-[11px] leading-relaxed">
          {micError}
        </p>
      )}
      {speakerError && (
        <p className="text-destructive text-[11px] leading-relaxed">
          {t("home.start.speakerFailed")}
        </p>
      )}
      {showHint && (
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          {t("home.start.audioHint")}
        </p>
      )}
    </div>
  );
}
