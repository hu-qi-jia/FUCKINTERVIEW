"use client";

import { usePipecatClientCamControl } from "@pipecat-ai/client-react";
import {
  MicIcon,
  ScreenShareIcon,
  SlidersHorizontalIcon,
  VideoIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { UserAudioControl } from "@/components/pipecat/user-audio-control";
import { UserScreenControl } from "@/components/pipecat/user-screen-control";
import { UserVideoControl } from "@/components/pipecat/user-video-control";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
    let cancelled = false;
    let attempts = 0;
    setTarget(null);

    // The header slot is mounted by the Console, which can land a tick after
    // this portal; poll briefly instead of giving up on the first miss.
    const resolve = () => {
      if (cancelled) return;
      const node = document.getElementById(id);
      if (node) {
        setTarget(node);
        return;
      }
      if (attempts++ < 40) setTimeout(resolve, 50);
    };
    resolve();

    return () => {
      cancelled = true;
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
      className={cn("w-full", active && "pointer-events-none opacity-50")}
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
        <UserAudioControl className="w-full" />
      </Disabled>
      <Disabled active={disabled?.cam}>
        <UserVideoControl className="w-full" noVideo={!isCamEnabled} />
      </Disabled>
      <Disabled active={disabled?.screen}>
        <UserScreenControl className="w-full" />
      </Disabled>
    </div>
  );
}

function DevicePopover({
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
            className={cn(disabled && "opacity-50")}
          >
            {icon}
          </Button>
        }
      />
      <PopoverContent side="right" align="start" className="w-72 p-3">
        <Disabled active={disabled}>{children}</Disabled>
      </PopoverContent>
    </Popover>
  );
}

/** Icon strip for the collapsed sidebar; each icon opens its own control. */
export function CollapsedDeviceGroup({
  disabled,
  className,
}: {
  disabled?: DeviceDisabled;
  className?: string;
}) {
  const { t } = useTranslation();
  const { isCamEnabled } = usePipecatClientCamControl();

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 border-t border-sidebar-border py-2",
        className,
      )}
    >
      <DevicePopover
        label={t("devices.microphone")}
        icon={<MicIcon />}
        disabled={disabled?.mic}
      >
        <UserAudioControl className="w-full" />
      </DevicePopover>
      <DevicePopover
        label={t("devices.camera")}
        icon={<VideoIcon />}
        disabled={disabled?.cam}
      >
        <UserVideoControl className="w-full" noVideo={!isCamEnabled} />
      </DevicePopover>
      <DevicePopover
        label={t("devices.screenShare")}
        icon={<ScreenShareIcon />}
        disabled={disabled?.screen}
      >
        <UserScreenControl className="w-full" />
      </DevicePopover>
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
