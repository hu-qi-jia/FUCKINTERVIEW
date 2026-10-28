"use client";

import { usePipecatClientCamControl } from "@pipecat-ai/client-react";
import {
  CheckIcon,
  MicIcon,
  ScreenShareIcon,
  SlidersHorizontalIcon,
  VideoIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  formatDeviceLabel,
  usePipecatDevices,
  type DeviceKind,
} from "@/components/pipecat/device-select";
import { UserAudioControl } from "@/components/pipecat/user-audio-control";
import { UserScreenControl } from "@/components/pipecat/user-screen-control";
import { UserVideoControl } from "@/components/pipecat/user-video-control";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** Which controls are present but unusable on the current page. */
export interface DeviceDisabled {
  mic?: boolean;
  cam?: boolean;
  screen?: boolean;
}

const SIDEBAR_SLOT = "app-devices-slot";
const HEADER_SLOT = "app-devices-header-slot";

/** Renders into a DOM node owned by the shell (portals keep React context). */
export function PortalTo({
  id,
  version,
  children,
}: {
  id: string;
  /** Re-resolve the target when the shell re-creates it (e.g. page switch). */
  version?: unknown;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(null);
    const find = () => document.getElementById(id);
    const existing = find();
    if (existing) {
      setTarget(existing);
      return;
    }

    // The shell (e.g. the Console header) can mount after this portal, so
    // watch for the node instead of giving up after one lookup.
    const observer = new MutationObserver(() => {
      const node = find();
      if (!node) return;
      observer.disconnect();
      setTarget(node);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 10000);

    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [id, version]);

  return target ? createPortal(children, target) : null;
}

function Disabled({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      aria-disabled={active || undefined}
      inert={active || undefined}
      className={cn(
        "flex w-full justify-center",
        active && "pointer-events-none opacity-50",
      )}
    >
      {children}
    </div>
  );
}

/** The three device controls, in their normal (expanded) form. */
export function DeviceGroup({
  disabled,
  className,
}: {
  disabled?: DeviceDisabled;
  className?: string;
}) {
  const { t } = useTranslation();
  const { isCamEnabled } = usePipecatClientCamControl();

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="text-muted-foreground px-1 text-[11px] font-medium tracking-wide uppercase">
        {t("devices.title")}
      </div>
      <Disabled active={disabled?.mic}>
        {/* The stock controls reserve 8rem for the label; the sidebar can be
            160px wide, so let the group shrink instead of pushing the device
            chevron out of the rail. */}
        <UserAudioControl className="w-full [&>button]:!min-w-0" />
      </Disabled>
      <Disabled active={disabled?.cam}>
        <UserVideoControl
          className="w-full [&>button]:!min-w-0"
          noVideo={!isCamEnabled}
        />
      </Disabled>
      <Disabled active={disabled?.screen}>
        <UserScreenControl className="w-full" />
      </Disabled>
    </div>
  );
}

const DEVICE_FALLBACK: Record<DeviceKind, string> = {
  audioinput: "devices.microphone",
  audiooutput: "devices.speaker",
  videoinput: "devices.camera",
};

/** Selectable device rows for one device kind. */
function DeviceSelection({ kind, label }: { kind: DeviceKind; label: string }) {
  const { t } = useTranslation();
  const { devices, selectedDevice, updateDevice } = usePipecatDevices(kind);

  return (
    <div className="flex flex-col">
      <div className="text-muted-foreground px-2 py-1 text-xs font-medium">
        {label}
      </div>
      {devices.length === 0 ? (
        <div className="text-muted-foreground px-2 py-1.5 text-xs">
          {t("devices.none")}
        </div>
      ) : (
        devices.map((device, index) => {
          const selected = selectedDevice?.deviceId === device.deviceId;
          return (
            <button
              key={`${kind}-${device.deviceId || index}`}
              type="button"
              onClick={() => updateDevice(device.deviceId)}
              className={cn(
                "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                selected && "bg-accent",
              )}
            >
              <CheckIcon
                className={cn("size-4 shrink-0", !selected && "opacity-0")}
              />
              <span className="truncate">
                {formatDeviceLabel(device, t(DEVICE_FALLBACK[kind]))}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function SelectionPopover({
  label,
  icon,
  disabled,
  children,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
          >
            {icon}
          </Button>
        }
      />
      <PopoverContent side="right" align="start" className="w-72 p-1.5">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Icon strip for the collapsed sidebar. Only the icons stay visible; each one
 * opens a device-selection popover beside the rail.
 */
export function CollapsedDeviceGroup({
  disabled,
  className,
}: {
  disabled?: DeviceDisabled;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 border-t border-sidebar-border py-2",
        className,
      )}
    >
      <SelectionPopover
        label={t("devices.microphone")}
        icon={<MicIcon />}
        disabled={disabled?.mic}
      >
        <DeviceSelection
          kind="audioinput"
          label={t("devices.microphones")}
        />
        <Separator className="my-1" />
        <DeviceSelection
          kind="audiooutput"
          label={t("devices.speakers")}
        />
      </SelectionPopover>
      <SelectionPopover
        label={t("devices.camera")}
        icon={<VideoIcon />}
        disabled={disabled?.cam}
      >
        <DeviceSelection kind="videoinput" label={t("devices.cameras")} />
      </SelectionPopover>
      <SelectionPopover
        label={t("devices.screenShare")}
        icon={<ScreenShareIcon />}
        disabled={disabled?.screen}
      >
        <UserScreenControl className="w-full" />
      </SelectionPopover>
    </div>
  );
}

/** Device section portaled into the sidebar, above Settings. */
export function SidebarDevices({
  collapsed,
  disabled,
  version,
}: {
  collapsed: boolean;
  disabled?: DeviceDisabled;
  version?: unknown;
}) {
  return (
    <PortalTo id={SIDEBAR_SLOT} version={version}>
      {collapsed ? (
        <CollapsedDeviceGroup disabled={disabled} />
      ) : (
        <div className="border-t border-sidebar-border p-2">
          <DeviceGroup disabled={disabled} />
        </div>
      )}
    </PortalTo>
  );
}

/** Header entry for small screens, where the sidebar is hidden. */
export function HeaderDeviceButton({ disabled }: { disabled?: DeviceDisabled }) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label={t("devices.title")}
          >
            <SlidersHorizontalIcon />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-3">
        <DeviceGroup disabled={disabled} />
      </PopoverContent>
    </Popover>
  );
}

export { HEADER_SLOT, SIDEBAR_SLOT };
