"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import * as React from "react";
import { cn } from "cn";

type ScrollAreaOrientation = "vertical" | "horizontal" | "both";

export interface ScrollAreaProps
  extends Omit<ScrollAreaPrimitive.Root.Props, "children"> {
  children?: React.ReactNode;
  /** 需要哪几条滚动条；默认只有纵向。 */
  orientation?: ScrollAreaOrientation;
  /** 真正的滚动元素（滚动区内容的父节点），用于 scrollTo / 读取 scrollTop。 */
  viewportRef?: React.Ref<HTMLDivElement>;
  /** 原生 scroll 监听。base-ui 的 viewport 自带 onScroll，会覆盖传入的同名属性。 */
  onViewportScroll?: (event: Event) => void;
  viewportClassName?: string;
  contentClassName?: string;
}

const SCROLLBAR_BASE =
  "absolute z-10 flex touch-none select-none transition-colors duration-200 data-[scrolling]:duration-0";

/**
 * 全站统一的滚动区：base-ui 的 ScrollArea（原生滚动容器 + 浮层滚动条）。
 * 滚动条绝对定位，不占内容宽度；空闲时保留半透明拇指，滚动或悬停时加深。
 */
export function ScrollArea({
  className,
  children,
  orientation = "vertical",
  viewportRef,
  onViewportScroll,
  viewportClassName,
  contentClassName,
  ...props
}: ScrollAreaProps) {
  const innerRef = React.useRef<HTMLDivElement | null>(null);

  const setViewportRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof viewportRef === "function") {
        viewportRef(node);
      } else if (viewportRef) {
        (viewportRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
      }
    },
    [viewportRef],
  );

  React.useEffect(() => {
    const node = innerRef.current;
    if (!node || !onViewportScroll) return;
    node.addEventListener("scroll", onViewportScroll, { passive: true });
    return () => node.removeEventListener("scroll", onViewportScroll);
  }, [onViewportScroll]);

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative min-h-0 overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={setViewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
          viewportClassName,
        )}
      >
        <ScrollAreaPrimitive.Content
          data-slot="scroll-area-content"
          className={cn("w-full", contentClassName)}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>

      {orientation !== "horizontal" && (
        <ScrollAreaPrimitive.Scrollbar
          orientation="vertical"
          data-slot="scroll-area-scrollbar"
          className={cn(
            SCROLLBAR_BASE,
            "group/scrollbar inset-y-0 right-0 w-2.5 justify-center py-0.5",
          )}
        >
          <ScrollAreaPrimitive.Thumb
            data-slot="scroll-area-thumb"
            className="w-1.5 rounded-full bg-foreground/20 transition-colors hover:bg-foreground/40 group-hover/scrollbar:bg-foreground/40 group-data-[scrolling]/scrollbar:bg-foreground/40 group-data-[hovering]/scrollbar:bg-foreground/40"
          />
        </ScrollAreaPrimitive.Scrollbar>
      )}

      {orientation !== "vertical" && (
        <ScrollAreaPrimitive.Scrollbar
          orientation="horizontal"
          data-slot="scroll-area-scrollbar"
          className={cn(
            SCROLLBAR_BASE,
            "group/scrollbar inset-x-0 bottom-0 h-2.5 items-center px-0.5",
          )}
        >
          <ScrollAreaPrimitive.Thumb
            data-slot="scroll-area-thumb"
            className="h-1.5 rounded-full bg-foreground/20 transition-colors hover:bg-foreground/40 group-hover/scrollbar:bg-foreground/40 group-data-[scrolling]/scrollbar:bg-foreground/40 group-data-[hovering]/scrollbar:bg-foreground/40"
          />
        </ScrollAreaPrimitive.Scrollbar>
      )}
    </ScrollAreaPrimitive.Root>
  );
}
