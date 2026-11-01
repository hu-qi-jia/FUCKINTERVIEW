"use client";

import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

const DRAG = { WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

function windowButtonClass(extra?: string) {
  return cn(
    "inline-flex h-full w-11 items-center justify-center text-muted-foreground/80 transition-colors",
    "hover:bg-accent hover:text-foreground focus-visible:outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
    extra
  );
}

/**
 * 桌面端窗口顶部的一条拖拽区：不加任何标题或图标，只留右侧三个窗口按钮，
 * 背景透明，视觉上和窗口本身连成一片。浏览器里 `window.desktop` 不存在，
 * 直接不渲染。
 */
export function DesktopTitleBar() {
  const desktop = typeof window === "undefined" ? undefined : window.desktop;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    void desktop.isMaximized().then((value) => {
      if (alive) setMaximized(value);
    });
    const unsubscribe = desktop.onMaximizeChange(setMaximized);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div
      className="flex h-8 shrink-0 items-center justify-end select-none"
      style={DRAG}
      onDoubleClick={() => desktop.toggleMaximize()}
    >
      <div className="flex h-full" style={NO_DRAG}>
        <button
          type="button"
          aria-label="最小化"
          className={windowButtonClass()}
          onClick={() => desktop.minimize()}
        >
          <MinusIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label={maximized ? "还原" : "最大化"}
          className={windowButtonClass()}
          onClick={() => desktop.toggleMaximize()}
        >
          {maximized ? (
            <CopyIcon className="size-3.5" />
          ) : (
            <SquareIcon className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          aria-label="关闭到托盘"
          title="关闭到托盘"
          className={windowButtonClass("hover:bg-destructive hover:text-white")}
          onClick={() => desktop.close()}
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
