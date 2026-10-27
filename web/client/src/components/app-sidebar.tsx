"use client";

import {
  MicIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { PipecatLogo } from "@/components/pipecat/console/logo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function SidebarItem({
  icon,
  label,
  active = false,
  collapsed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "h-9 w-full gap-2.5 px-2 text-sm font-normal",
        collapsed ? "justify-center" : "justify-start",
        "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </Button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="block w-full" />}>
        {button}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 左侧导航：宽度由外层 ResizablePanel 控制，可拖拽调整；
 * 折叠后只保留图标，悬停显示名称。
 */
export function AppSidebar({
  collapsed,
  onToggle,
  onOpenSettings,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-2" : "gap-2 px-3",
        )}
      >
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("nav.expand")}
            onClick={onToggle}
          >
            <PanelLeftOpenIcon />
          </Button>
        ) : (
          <>
            <PipecatLogo height={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {t("app.title")}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("nav.collapse")}
              onClick={onToggle}
            >
              <PanelLeftCloseIcon />
            </Button>
          </>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2">
        <SidebarItem
          active
          collapsed={collapsed}
          icon={<MicIcon className="size-4 shrink-0" />}
          label={t("nav.interview")}
        />
      </nav>

      <div className="flex flex-col gap-1 border-t border-sidebar-border p-2">
        <SidebarItem
          collapsed={collapsed}
          icon={<SettingsIcon className="size-4 shrink-0" />}
          label={t("settings.title")}
          onClick={onOpenSettings}
        />
      </div>
    </aside>
  );
}
