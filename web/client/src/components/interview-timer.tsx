"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/** 计时显示：不到一小时用 MM:SS，超过一小时才带小时位。 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * 面试计时器：挂载即开始，精确到秒。
 *
 * 每场面试换一个 key 重新挂载，所以「开始面试」会自然归零；
 * 它只是给候选人看的，不参与任何记录或统计。
 */
export function InterviewTimer({ className }: { className?: string }) {
  const startedAt = React.useRef(Date.now());
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const tick = () => setElapsed(Date.now() - startedAt.current);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span
      className={cn(
        "font-mono text-lg font-semibold tabular-nums",
        className,
      )}
    >
      {formatElapsed(elapsed)}
    </span>
  );
}
