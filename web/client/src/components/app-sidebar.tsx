"use client";

import {
  BookOpenIcon,
  FilesIcon,
  HistoryIcon,
  HomeIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Wordmark } from "@/components/home/wordmark";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Top-level pages. Each renders its own Console and connection. */
export type AppPage =
  | "home"
  | "history"
  | "interview"
  | "materials"
  | "documents";

interface NavItem {
  id: AppPage;
  label: string;
  icon: ReactNode;
}

/** 侧栏和窄屏顶栏共用同一份入口定义，图标和顺序不会两边跑偏。 */
function navItems(t: (key: string) => string): NavItem[] {
  return [
    {
      id: "home",
      label: t("nav.home"),
      icon: <HomeIcon className="size-4 shrink-0" />,
    },
    {
      id: "materials",
      label: t("nav.materials"),
      icon: <BookOpenIcon className="size-4 shrink-0" />,
    },
    {
      id: "documents",
      label: t("nav.documents"),
      icon: <FilesIcon className="size-4 shrink-0" />,
    },
    {
      id: "history",
      label: t("nav.history"),
      icon: <HistoryIcon className="size-4 shrink-0" />,
    },
  ];
}

/** 面试页由首页进入，侧栏和顶栏都把「首页」点亮。 */
function isActive(id: AppPage, activePage: AppPage): boolean {
  return id === activePage || (id === "home" && activePage === "interview");
}

function SidebarItem({
  icon,
  label,
  active = false,
  collapsed,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  collapsed: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
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
 * 窄屏（<768px）的页面入口：侧栏隐藏后，每个页面一个图标按钮排在顶栏左侧，
 * 取代原来的下拉选择框。
 */
export function MobileNav({
  activePage,
  onNavigate,
  disabled = false,
}: {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("nav.pages")}
      className="flex min-w-0 items-center gap-0.5 md:hidden"
    >
      {navItems(t).map((page) => {
        const active = isActive(page.id, activePage);
        return (
          <Button
            key={page.id}
            variant="ghost"
            size="icon-sm"
            aria-label={page.label}
            aria-current={active ? "page" : undefined}
            disabled={disabled}
            onClick={() => onNavigate(page.id)}
            className={cn(
              "text-muted-foreground hover:text-foreground shrink-0",
              active && "bg-accent text-accent-foreground"
            )}
          >
            {page.icon}
          </Button>
        );
      })}
    </nav>
  );
}

/**
 * 左侧导航：宽度由外层容器控制，可拖拽调整；
 * 折叠后只保留图标，悬停显示名称。
 */
export function AppSidebar({
  collapsed,
  activePage,
  onNavigate,
  onToggle,
  onOpenSettings,
  locked = false,
}: {
  collapsed: boolean;
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  onToggle: () => void;
  onOpenSettings: () => void;
  /** 实时面试进行中：除设备选择外全部置灰，结束后才放开。 */
  locked?: boolean;
}) {
  const { t } = useTranslation();

  const pages = navItems(t);

  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div
        className={cn(
          "app-drag flex h-12 shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-2" : "gap-2 px-3",
        )}
      >
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("nav.expand")}
            disabled={locked}
            onClick={onToggle}
            className="app-no-drag"
          >
            <PanelLeftOpenIcon />
          </Button>
        ) : (
          <>
            {/* 和首页同款字标，高度对齐原来的标题文字。 */}
            <Wordmark fit className="h-4 min-w-0 flex-1" />
            <span className="sr-only">{t("app.title")}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("nav.collapse")}
              disabled={locked}
              onClick={onToggle}
              className="app-no-drag"
            >
              <PanelLeftCloseIcon />
            </Button>
          </>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2">
        {pages.map((page) => (
          <SidebarItem
            key={page.id}
            active={isActive(page.id, activePage)}
            collapsed={collapsed}
            disabled={locked}
            icon={page.icon}
            label={page.label}
            onClick={() => onNavigate(page.id)}
          />
        ))}
      </nav>

      {/* Device controls are portaled here by the active page. */}
      <div id="app-devices-slot" />

      <div className="flex flex-col gap-1 border-t border-sidebar-border p-2">
        <SidebarItem
          collapsed={collapsed}
          disabled={locked}
          icon={<SettingsIcon className="size-4 shrink-0" />}
          label={t("settings.title")}
          onClick={onOpenSettings}
        />
      </div>
    </aside>
  );
}
