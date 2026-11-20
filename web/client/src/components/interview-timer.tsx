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
 * 面试计时器。
 *
 * 从 `startAt` 那一刻开始计，精确到秒；没连上之前一直是 00:00——
 * 早先是从进页面就开始计，把连接那十几秒也算成了「面试时长」，看着吓人
 * 也没法用来对会话记录。
 *
 * 每场面试换一个 key 重新挂载，所以「开始面试」会自然归零；
 * 它只是给候选人看的，不参与任何记录或统计。
 */
export function InterviewTimer({
  className,
  startAt,
}: {
  className?: string;
  /** 开始计时的时刻（毫秒时间戳）；null / undefined 表示还没连上。 */
  startAt?: number | null;
}) {
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = startAt ? now - startAt : 0;

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
