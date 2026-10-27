"use client";

import type { DeviceErrorReason } from "@pipecat-ai/client-js";
import {
  type OptionalMediaDeviceInfo,
  useMediaState,
  usePipecatClientMediaDevices,
} from "@pipecat-ai/client-react";
import { Loader2Icon } from "lucide-react";
import { createContext, useContext } from "react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

/** Which class of media device to list and control. */
export type DeviceKind = "audioinput" | "audiooutput" | "videoinput";

const KIND_DEFAULTS: Record<
  DeviceKind,
  { placeholderKey: string; menuLabelKey: string; fallbackNameKey: string }
> = {
  audioinput: {
    placeholderKey: "devices.selectMicrophone",
    menuLabelKey: "devices.microphones",
    fallbackNameKey: "devices.microphone",
  },
  audiooutput: {
    placeholderKey: "devices.selectSpeaker",
    menuLabelKey: "devices.speakers",
    fallbackNameKey: "devices.speaker",
  },
  videoinput: {
    placeholderKey: "devices.selectCamera",
    menuLabelKey: "devices.cameras",
    fallbackNameKey: "devices.camera",
  },
};

/**
 * Devices, selection, and updater for one device kind, sourced from the
 * Pipecat client. Must be used inside a PipecatClientProvider.
 */
export function usePipecatDevices(kind: DeviceKind): {
  devices: MediaDeviceInfo[];
  selectedDevice: OptionalMediaDeviceInfo;
  updateDevice: (deviceId: string) => void;
} {
  const {
    availableCams,
    availableMics,
    availableSpeakers,
    selectedCam,
    selectedMic,
    selectedSpeaker,
    updateCam,
    updateMic,
    updateSpeaker,
  } = usePipecatClientMediaDevices();

  switch (kind) {
    case "audiooutput":
      return {
        devices: availableSpeakers,
        selectedDevice: selectedSpeaker,
        updateDevice: updateSpeaker,
      };
    case "videoinput":
      return {
        devices: availableCams,
        selectedDevice: selectedCam,
        updateDevice: updateCam,
      };
    case "audioinput":
    default:
      return {
        devices: availableMics,
        selectedDevice: selectedMic,
        updateDevice: updateMic,
      };
  }
}

/** Speaker enumeration depends on microphone permission, so audiooutput follows mic MediaState. */
export function usePipecatDeviceState(kind: DeviceKind): {
  isLoading: boolean;
  unavailableText?: string;
} {
  const { mic, cam } = useMediaState();
  const state = kind === "videoinput" ? cam : mic;
  return {
    isLoading: state.state === "initializing",
    unavailableText:
      state.state === "error" ? deviceErrorText(state.reason) : undefined,
  };
}

/** Short, user-facing message for a device error. */
function deviceErrorText(reason: DeviceErrorReason): string {
  switch (reason) {
    case "blocked":
      return i18n.t("devices.blocked");
    case "already-in-use":
      return i18n.t("devices.inUse");
    case "not-found":
      return i18n.t("devices.notFound");
    case "not-supported":
      return i18n.t("devices.notSupported");
    case "unknown":
    default:
      return i18n.t("devices.unavailable");
  }
}

/** Human-readable device label with a stable fallback. */
export function formatDeviceLabel(
  device: MediaDeviceInfo,
  fallbackName: string,
) {
  if (device.label) return device.label;
  // Pre-permission, browsers may return devices with empty labels and ids.
  return device.deviceId
    ? `${fallbackName} ${device.deviceId.slice(0, 5)}`
    : fallbackName;
}

/** Narrows OptionalMediaDeviceInfo (which may be an empty object) to a real device. */
export function asMediaDevice(
  device?: OptionalMediaDeviceInfo,
): MediaDeviceInfo | undefined {
  return device && "deviceId" in device
    ? (device as MediaDeviceInfo)
    : undefined;
}

export interface DeviceSelectViewProps extends Omit<
  React.ComponentProps<typeof SelectTrigger>,
  "children"
> {
  /** Devices to list. */
  devices?: MediaDeviceInfo[];
  /** Currently selected device, matched by deviceId. */
  selectedDevice?: OptionalMediaDeviceInfo;
  /** Called with the deviceId when the user picks a device. */
  onDeviceChange?: (deviceId: string) => void;
  /** Device kind — controls default placeholder and fallback labels. */
  kind?: DeviceKind;
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
  /** Optional leading content inside the trigger (icon or short label). */
  guide?: React.ReactNode;
  /** Disables the trigger and shows a spinner (e.g. while devices initialize). */
  isLoading?: boolean;
  /** Content shown next to the spinner while loading. Spinner only by default. */
  loadingText?: React.ReactNode;
  /**
   * When set, the trigger renders disabled with this message (device access
   * blocked, in use, …). Takes precedence over the interactive state;
   * isLoading takes precedence over both.
   */
  unavailableText?: React.ReactNode;
}

/** Loading takes precedence over unavailability. The trigger is named from kind unless overridden. */
export function DeviceSelectView({
  devices,
  selectedDevice,
  onDeviceChange,
  kind = "audioinput",
  placeholder,
  guide,
  isLoading = false,
  loadingText,
  unavailableText,
  disabled,
  className,
  ...triggerProps
}: DeviceSelectViewProps) {
  const defaults = KIND_DEFAULTS[kind];
  const { t } = useTranslation();
  const fallbackName = t(defaults.fallbackNameKey);
  const selected = asMediaDevice(selectedDevice);
  const selectedValue = selected?.deviceId ?? null;
  const blocked = isLoading || !!unavailableText;

  return (
    <Select
      value={selectedValue}
      onValueChange={(value) => {
        if (typeof value === "string") onDeviceChange?.(value);
      }}
    >
      <SelectTrigger
        data-slot="device-select"
        aria-label={t(defaults.placeholderKey)}
        aria-busy={isLoading || undefined}
        data-state={
          isLoading ? "loading" : unavailableText ? "unavailable" : undefined
        }
        className={cn("min-w-0", className)}
        {...triggerProps}
        disabled={blocked || disabled}
      >
        {isLoading ? (
          <>
            <Loader2Icon className="animate-spin" />
            {loadingText && <span className="truncate">{loadingText}</span>}
          </>
        ) : unavailableText ? (
          <span className="truncate">{unavailableText}</span>
        ) : (
          <>
            {guide ? (
              <span className="text-muted-foreground flex items-center gap-1.5">
                {guide}
              </span>
            ) : null}
            <SelectValue>
              <span className="truncate">
                {selected
                  ? formatDeviceLabel(selected, fallbackName)
                  : (placeholder ?? t(defaults.placeholderKey))}
              </span>
            </SelectValue>
          </>
        )}
      </SelectTrigger>
      {/* Pop below the trigger (popover-style) rather than Base UI's
          default of overlaying the selected item on the trigger, so both
          picker UIs position consistently. */}
      <SelectContent alignItemWithTrigger={false}>
        {devices?.length ? (
          devices.map((device, index) => (
            <SelectItem key={device.deviceId || index} value={device.deviceId}>
              {formatDeviceLabel(device, fallbackName)}
            </SelectItem>
          ))
        ) : (
          <SelectItem value="__none" disabled>
            {t("devices.none")}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

export interface DeviceSelectProps extends Omit<
  DeviceSelectViewProps,
  | "devices"
  | "selectedDevice"
  | "onDeviceChange"
  | "isLoading"
  | "unavailableText"
> {
  /** Replaces the automatically derived device-error message. */
  unavailableText?: React.ReactNode;
}

/**
 * Device picker (select) wired to the Pipecat client: device list,
 * selection, and loading/error states for the given kind.
 * Must be rendered inside a PipecatClientProvider.
 */
export function DeviceSelect({
  kind = "audioinput",
  unavailableText,
  ...props
}: DeviceSelectProps) {
  const { devices, selectedDevice, updateDevice } = usePipecatDevices(kind);
  const derived = usePipecatDeviceState(kind);

  return (
    <DeviceSelectView
      kind={kind}
      devices={devices}
      selectedDevice={selectedDevice}
      onDeviceChange={updateDevice}
      isLoading={derived.isLoading}
      unavailableText={unavailableText ?? derived.unavailableText}
      {...props}
    />
  );
}

interface DeviceDropdownContextValue {
  devices?: MediaDeviceInfo[];
  selectedDevice?: OptionalMediaDeviceInfo;
  onDeviceChange?: (deviceId: string) => void;
  kind: DeviceKind;
  isLoading: boolean;
  loadingText?: React.ReactNode;
  unavailableText?: React.ReactNode;
}

const DeviceDropdownContext = createContext<DeviceDropdownContextValue | null>(
  null,
);

function useDeviceDropdownContext() {
  const context = useContext(DeviceDropdownContext);
  if (!context) {
    throw new Error(
      "DeviceDropdown components must be used within DeviceDropdownView or DeviceDropdown",
    );
  }
  return context;
}

export interface DeviceDropdownViewProps {
  /** Anatomy: a DeviceDropdownTrigger and a DeviceDropdownContent. */
  children: React.ReactNode;
  /** Devices to list. */
  devices?: MediaDeviceInfo[];
  /** Currently selected device, matched by deviceId. */
  selectedDevice?: OptionalMediaDeviceInfo;
  /** Called with the deviceId when the user picks a device. */
  onDeviceChange?: (deviceId: string) => void;
  /** Device kind — controls default menu label and fallback names. */
  kind?: DeviceKind;
  /** Shows a loading row in the menu instead of devices. */
  isLoading?: boolean;
  /** Content for the loading row. "Loading devices…" by default. */
  loadingText?: React.ReactNode;
  /**
   * When set, the menu shows this message instead of devices (device
   * access blocked, in use, …). isLoading takes precedence.
   */
  unavailableText?: React.ReactNode;
}

/** Compose with DeviceDropdownTrigger and DeviceDropdownContent. Name icon-only triggers with aria-label. */
export function DeviceDropdownView({
  children,
  devices,
  selectedDevice,
  onDeviceChange,
  kind = "audioinput",
  isLoading = false,
  loadingText,
  unavailableText,
}: DeviceDropdownViewProps) {
  return (
    <DeviceDropdownContext.Provider
      value={{
        devices,
        selectedDevice,
        onDeviceChange,
        kind,
        isLoading,
        loadingText,
        unavailableText,
      }}
    >
      <DropdownMenu>{children}</DropdownMenu>
    </DeviceDropdownContext.Provider>
  );
}

/** Menu trigger — compose your own element via the render prop. */
export const DeviceDropdownTrigger = DropdownMenuTrigger;

export interface DeviceDropdownContentProps extends React.ComponentProps<
  typeof DropdownMenuContent
> {
  /** Menu heading. Pass null to hide. */
  menuLabel?: React.ReactNode | null;
}

/**
 * Menu content listing the root's devices, with loading, unavailable,
 * and empty states. Must be used within a DeviceDropdownView.
 */
export function DeviceDropdownContent({
  menuLabel,
  align = "end",
  ...props
}: DeviceDropdownContentProps) {
  const {
    devices,
    selectedDevice,
    onDeviceChange,
    kind,
    isLoading,
    loadingText,
    unavailableText,
  } = useDeviceDropdownContext();
  const defaults = KIND_DEFAULTS[kind];
  const { t } = useTranslation();
  const resolvedLabel =
    menuLabel === undefined ? t(defaults.menuLabelKey) : menuLabel;
  const fallbackName = t(defaults.fallbackNameKey);

  return (
    <DropdownMenuContent align={align} {...props}>
      {/* Base UI requires GroupLabel to live inside a Group. */}
      <DropdownMenuGroup>
        {resolvedLabel !== null && (
          <>
            <DropdownMenuLabel>{resolvedLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {isLoading ? (
          <DropdownMenuLabel
            aria-busy
            className="text-muted-foreground flex items-center gap-1.5 font-normal"
          >
            <Loader2Icon className="size-3.5 animate-spin" />
            {loadingText ?? t("devices.loading")}
          </DropdownMenuLabel>
        ) : unavailableText ? (
          <DropdownMenuLabel className="text-muted-foreground font-normal">
            {unavailableText}
          </DropdownMenuLabel>
        ) : devices?.length ? (
          devices.map((device, index) => (
            <DropdownMenuCheckboxItem
              key={device.deviceId || index}
              checked={selectedDevice?.deviceId === device.deviceId}
              onCheckedChange={(checked) => {
                if (checked) onDeviceChange?.(device.deviceId);
              }}
            >
              {formatDeviceLabel(device, fallbackName)}
            </DropdownMenuCheckboxItem>
          ))
        ) : (
          <DropdownMenuLabel className="text-muted-foreground font-normal">
            {t("devices.none")}
          </DropdownMenuLabel>
        )}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}

export interface DeviceDropdownProps extends Omit<
  DeviceDropdownViewProps,
  | "devices"
  | "selectedDevice"
  | "onDeviceChange"
  | "isLoading"
  | "unavailableText"
> {
  /** Replaces the automatically derived device-error message. */
  unavailableText?: React.ReactNode;
}

/**
 * Device picker (dropdown menu) wired to the Pipecat client: device
 * list, selection, and loading/error states for the given kind.
 * Must be rendered inside a PipecatClientProvider.
 */
export function DeviceDropdown({
  kind = "audioinput",
  unavailableText,
  children,
  ...props
}: DeviceDropdownProps) {
  const { devices, selectedDevice, updateDevice } = usePipecatDevices(kind);
  const derived = usePipecatDeviceState(kind);

  return (
    <DeviceDropdownView
      kind={kind}
      devices={devices}
      selectedDevice={selectedDevice}
      onDeviceChange={updateDevice}
      isLoading={derived.isLoading}
      unavailableText={unavailableText ?? derived.unavailableText}
      {...props}
    >
      {children}
    </DeviceDropdownView>
  );
}
