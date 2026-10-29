"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Console-shared viewport check: true at or above the given width. Single
 * source for the desktop/mobile layout switch so panels are instantiated
 * once, in whichever tree renders.
 */
export function useMinWidth(px: number): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const query = window.matchMedia(`(min-width: ${px}px)`);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    [px],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => false,
  );
}

/**
 * Panel chrome for the console, styled over the stock Card so consumer Card
 * theming (tokens, radius, ring) flows straight through. Density is
 * container-driven: compact padding by default, relaxing at wider panel
 * widths — the same markup serves expanded panes, collapsed strips, and
 * mobile tabs.
 */
export function ConsolePanel({
  className,
  ...props
}: React.ComponentProps<typeof Card>) {
  return (
    <Card
      size="sm"
      className={cn(
        "@container/panel h-full min-h-0 gap-(--card-spacing) overflow-hidden",
        "[--card-spacing:--spacing(2)] @xs/panel:[--card-spacing:--spacing(3)] @md/panel:[--card-spacing:--spacing(4)]",
        className,
      )}
      data-slot="console-panel"
      {...props}
    />
  );
}

export function ConsolePanelHeader({
  className,
  ...props
}: React.ComponentProps<typeof CardHeader>) {
  return (
    <CardHeader
      className={cn("items-center border-b", className)}
      data-slot="console-panel-header"
      {...props}
    />
  );
}

export function ConsolePanelTitle({
  className,
  ...props
}: React.ComponentProps<typeof CardTitle>) {
  return (
    <CardTitle
      className={cn(
        "text-muted-foreground truncate text-xs font-medium tracking-wide uppercase",
        className,
      )}
      data-slot="console-panel-title"
      {...props}
    />
  );
}

export function ConsolePanelActions({
  className,
  ...props
}: React.ComponentProps<typeof CardAction>) {
  return (
    <CardAction
      className={cn("flex items-center gap-1 self-center", className)}
      data-slot="console-panel-actions"
      {...props}
    />
  );
}

export function ConsolePanelContent({
  className,
  scroll = true,
  children,
  ref,
  onScroll,
  ...props
}: React.ComponentProps<typeof CardContent> & { scroll?: boolean }) {
  if (!scroll) {
    return (
      <CardContent
        ref={ref}
        onScroll={onScroll}
        className={cn("scroll-stable min-h-0 flex-1 overflow-auto", className)}
        data-slot="console-panel-content"
        {...props}
      >
        {children}
      </CardContent>
    );
  }

  return (
    <CardContent
      className="min-h-0 flex-1 overflow-hidden p-0"
      data-slot="console-panel-content"
    >
      <ScrollArea
        className="h-full"
        viewportRef={ref as React.Ref<HTMLDivElement>}
        onViewportScroll={
          onScroll as ((event: Event) => void) | undefined
        }
        contentClassName={cn("px-(--card-spacing)", className)}
      >
        {children}
      </ScrollArea>
    </CardContent>
  );
}

/**
 * One section of a collapsed pane: a single icon button that opens the
 * section's content in a popover beside the icon strip.
 */
export function ConsoleCollapsedSection({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            {icon}
          </Button>
        }
      />
      <PopoverContent side="left" align="start" className="w-80 max-w-[90vw]">
        {children}
      </PopoverContent>
    </Popover>
  );
}
