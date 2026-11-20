/**
 * 前端侧的可观测。
 *
 * 关键耗时报回后端 `/api/obs`，和后端的 span 共用同一个 traceId，
 * 所以一场面试从「点开始」到「bot-ready」的每一段都落在同一份 backend.log 里，
 * 不用在 DevTools 和日志文件之间来回对时间。
 *
 * 观测永远不能影响业务：上报失败就静默丢掉。
 */

import { newTraceId } from "@/lib/http";

export { newTraceId };

function format(fields: Record<string, unknown>): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      const text = String(value);
      return `${key}=${/\s|=/.test(text) ? `"${text.replace(/"/g, "'")}"` : text}`;
    });
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function report(
  name: string,
  fields: Record<string, unknown> = {},
  trace?: string,
): void {
  // 控制台也留一份，开发时不用翻 backend.log。
  console.info(`[obs] ${name} trace=${trace ?? "-"}${format(fields)}`);
  void fetch("/api/obs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, trace, ...fields }),
  }).catch(() => {
    /* 观测失败不影响业务 */
  });
}

/**
 * 记一段耗时：返回的函数一调用就把毫秒数报出去。
 *
 *   const stop = startTimer("interview.connect", trace);
 *   ...
 *   stop({ state: "ready" });
 */
export function startTimer(
  name: string,
  trace?: string,
): (fields?: Record<string, unknown>) => void {
  const started = performance.now();
  return (fields: Record<string, unknown> = {}) => {
    report(
      name,
      { ...fields, ms: Math.round(performance.now() - started) },
      trace,
    );
  };
}
