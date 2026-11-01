"use client";

import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const BUTTON_CLASS = cn(
  "inline-flex size-8 items-center justify-center rounded-md",
  "text-muted-foreground transition-colors",
  "hover:bg-accent hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
);

/**
 * 桌面端的最小化 / 最大化 / 关闭。
 *
 * 不单独占一条标题栏：按钮浮在页头右端（页头自己留出 padding），
 * 背景透明、尺寸和项目里的 icon-sm 按钮一致，视觉上就是页头的一部分。
 * 浏览器里 `window.desktop` 不存在，整组不渲染。
 */
export function WindowControls() {
  const desktop = typeof window === "undefined" ? undefined : window.desktop;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    // 页头靠这个标记让出右侧空间（见 index.css 的 .app-page-header）。
    document.documentElement.dataset.desktop = "true";
    let alive = true;
    void desktop.isMaximized().then((value) => {
      if (alive) setMaximized(value);
    });
    const unsubscribe = desktop.onMaximizeChange(setMaximized);
    return () => {
      alive = false;
      unsubscribe();
      delete document.documentElement.dataset.desktop;
    };
  }, [desktop]);

  if (!desktop) return null;

  const maximizeLabel = maximized ? "还原" : "最大化";

  return (
    <div
      role="group"
      aria-label="窗口控制"
      className="app-no-drag fixed top-0 right-2 z-40 flex h-12 items-center gap-1"
    >
      <button
        type="button"
        aria-label="最小化"
        title="最小化"
        className={BUTTON_CLASS}
        onClick={() => desktop.minimize()}
      >
        <MinusIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        className={BUTTON_CLASS}
        onClick={() => desktop.toggleMaximize()}
      >
        {maximized ? (
          <CopyIcon className="size-3.5" />
        ) : (
          <SquareIcon className="size-3" />
        )}
      </button>
      <button
        type="button"
        aria-label="关闭到托盘"
        title="关闭到托盘"
        className={cn(BUTTON_CLASS, "hover:bg-destructive hover:text-white")}
        onClick={() => desktop.close()}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
