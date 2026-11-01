/** 首页/历史页共用的数字与时间格式化。 */

function isChinese(language: string): boolean {
  return language.startsWith("zh");
}

export function formatTokens(value: number, language: string): string {
  return new Intl.NumberFormat(language, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDuration(seconds: number, language: string): string {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (isChinese(language)) {
    if (hours) return `${hours} 小时 ${minutes} 分`;
    if (minutes) return `${minutes} 分 ${rest} 秒`;
    return `${rest} 秒`;
  }
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

export function formatDateTime(value: string | null | undefined, language: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatClock(value: string | null | undefined, language: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return String(Math.round(value));
}

export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return `${Math.round(value * 100)}%`;
}

/** 文件大小：B / KB / MB，资料列表用。 */
export function formatBytes(value: number): string {
  const bytes = Math.max(0, value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
