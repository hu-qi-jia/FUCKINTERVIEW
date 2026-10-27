"use client";

import { MicIcon, SettingsIcon } from "lucide-react";
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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="block w-full" />}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          className={cn(
            "h-9 w-full justify-center gap-2.5 px-2 text-sm font-normal",
            "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "lg:justify-start lg:px-3",
            active &&
              "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
          )}
        >
          {icon}
          <span className="hidden truncate lg:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" className="lg:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * 左侧导航：桌面端展开为 224px，平板折叠成 56px 图标栏，手机端隐藏。
 * 设置项打开设置弹窗（同一份设置界面）。
 */
export function AppSidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation();

  return (
    <aside className="hidden w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex lg:w-56">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-3 lg:px-4">
        <PipecatLogo height={16} className="shrink-0" />
        <span className="hidden truncate text-sm font-semibold lg:block">
          {t("app.title")}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2">
        <SidebarItem
          active
          icon={<MicIcon className="size-4 shrink-0" />}
          label={t("nav.interview")}
        />
      </nav>

      <div className="flex flex-col gap-1 border-t border-sidebar-border p-2">
        <SidebarItem
          icon={<SettingsIcon className="size-4 shrink-0" />}
          label={t("settings.title")}
          onClick={onOpenSettings}
        />
        <div className="hidden px-2 pt-1 pb-1 text-[11px] text-muted-foreground lg:block">
          {t("nav.footer")}
        </div>
      </div>
    </aside>
  );
}
