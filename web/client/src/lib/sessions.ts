/** 面试历史的前端数据模型与接口。 */

import i18n from "@/i18n";

export type SessionMode = "live" | "mock";
export type SessionStatus = "open" | "completed" | "interrupted";
export type SessionTurnRole = "interviewer" | "candidate" | "ai";
export type SessionTurnSource =
  | "interviewer_stt"
  | "candidate_stt"
  | "llm"
  | "qa";

export interface SessionModels {
  asr: string | null;
  llm: string | null;
  tts: string | null;
}

export interface SessionTokens {
  prompt: number;
  completion: number;
  total: number;
  cacheRead: number;
}

export interface SessionSummary {
  id: number;
  interviewId: string;
  mode: SessionMode;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  profileId: string | null;
  profileName: string | null;
  models: SessionModels;
  tokens: SessionTokens;
  ttfbAvgMs: number | null;
  ttftAvgMs: number | null;
  sttSeconds: number;
  turnCount: number;
  aiTurnCount: number;
  qaHitCount: number;
}

export interface SessionTurn {
  id: number;
  role: SessionTurnRole;
  source: SessionTurnSource;
  text: string;
  createdAt: string;
}

export interface SessionCorrection {
  from: string;
  to: string;
  kind: "corrected" | "suspected";
}

export interface SessionDetail extends SessionSummary {
  turns: SessionTurn[];
  corrections: SessionCorrection[];
}

export interface HeatmapDay {
  date: string;
  sessions: number;
  tokens: number;
}

export interface SessionHeatmap {
  /** 范围第一天，已对齐到周一。 */
  start: string;
  /** 范围最后一天，本地时区的今天。 */
  end: string;
  days: HeatmapDay[];
}

export interface SessionStatsSummary {
  totalSessions: number;
  weekSessions: number;
  totalTokens: number;
  avgTokens: number | null;
  totalDurationSec: number;
  totalTurns: number;
  qaHitCount: number;
  qaRatio: number | null;
  avgTtfbMs: number | null;
  avgTtftMs: number | null;
}

export interface ModelSetting {
  provider: string;
  model: string;
}

export interface SessionStats {
  heatmap: SessionHeatmap;
  summary: SessionStatsSummary;
  models: {
    asr: ModelSetting;
    llm: ModelSetting;
    tts: ModelSetting;
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      i18n.t("materials.errors.network", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((data: { detail?: string }) => data.detail)
      .catch(() => undefined);
    throw new Error(
      detail || i18n.t("materials.errors.http", { status: response.status }),
    );
  }
  return response.json() as Promise<T>;
}

export async function fetchSessionStats(): Promise<SessionStats> {
  return request<SessionStats>("/api/sessions/stats");
}

export async function fetchSessions({
  mode = "all",
  limit = 30,
  offset = 0,
}: {
  mode?: SessionMode | "all";
  limit?: number;
  offset?: number;
} = {}): Promise<{ sessions: SessionSummary[]; total: number }> {
  const params = new URLSearchParams({
    mode,
    limit: String(limit),
    offset: String(offset),
  });
  return request(`/api/sessions?${params.toString()}`);
}

export async function fetchSession(id: number): Promise<SessionDetail> {
  return request<SessionDetail>(`/api/sessions/${id}`);
}

/**
 * 主动结束（点断开、切页）时上报，让后端把这一场记为正常结束。
 * 用 keepalive：页面正在卸载时请求也要发出去；失败不打扰用户。
 */
export async function markSessionEnded(interviewId: string): Promise<void> {
  if (!interviewId) return;
  try {
    await fetch("/api/sessions/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewId }),
      keepalive: true,
    });
  } catch {
    // 记不上就按中断处理，不影响断开本身。
  }
}
