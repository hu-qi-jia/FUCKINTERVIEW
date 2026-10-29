/** 问答库的前端数据模型与接口。 */

import i18n from "@/i18n";

export type QaType = "general" | "behavioral" | "knowledge" | "project";
export type QaIndexStatus = "pending" | "indexing" | "ready" | "failed";
export type QaDecision = "insert" | "update" | "skip";

export const QA_TYPES: QaType[] = ["general", "behavioral", "knowledge", "project"];

export interface QaItem {
  id: number;
  question: string;
  answer: string;
  aliases: string[];
  type: QaType;
  source: string;
  importId: number | null;
  sourceRef: string | null;
  indexStatus: QaIndexStatus;
  indexError: string | null;
  createdAt: string;
  updatedAt: string;
  /** 检索结果才有。 */
  score?: number;
  matchedText?: string | null;
  matchedBy?: string[];
}

export interface QaPatch {
  question?: string;
  answer?: string;
  aliases?: string[];
  type?: QaType;
}

export interface QaListResult {
  items: QaItem[];
  total: number;
}

export interface QaStats {
  model: string;
  modelDir: string;
  dim: string | null;
  total: number;
  ready: number;
  pending: number;
  indexing: number;
  failed: number;
  queue: number;
  lastError: string | null;
}

export interface QaPreviewRow {
  line: number | null;
  question: string;
  answerPreview: string;
  aliases: string[];
  type: QaType;
  proficiency: number;
  decision: QaDecision;
  existingId?: number | null;
  nearDuplicateOf?: number | null;
  nearDuplicateScore?: number | null;
}

export interface QaPreview {
  token: string;
  source: string;
  format: string;
  counts: {
    insert: number;
    update: number;
    skip: number;
    error: number;
    nearDuplicate: number;
  };
  previousImportAt: string | null;
  nearDuplicateError: string | null;
  items: QaPreviewRow[];
  errors: Array<{ line: number | null; message: string; question: string }>;
  truncated: boolean;
}

export interface QaCommitResult {
  importId: number;
  inserted: number;
  updated: number;
  skipped: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      i18n.t("qa.errors.network", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((data: { detail?: string }) => data.detail)
      .catch(() => undefined);
    throw new Error(detail || i18n.t("qa.errors.http", { status: response.status }));
  }
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** 后端用 snake_case 存库，这里统一翻成前端惯用的 camelCase。 */
function toItem(raw: Record<string, unknown>): QaItem {
  return {
    id: Number(raw.id),
    question: String(raw.question ?? ""),
    answer: String(raw.answer ?? ""),
    aliases: (raw.aliases as string[]) ?? [],
    type: (raw.type as QaType) ?? "general",
    source: String(raw.source ?? "manual"),
    importId: raw.import_id == null ? null : Number(raw.import_id),
    sourceRef: raw.source_ref == null ? null : String(raw.source_ref),
    indexStatus: (raw.index_status as QaIndexStatus) ?? "pending",
    indexError: raw.index_error == null ? null : String(raw.index_error),
    createdAt: String(raw.created_at ?? ""),
    updatedAt: String(raw.updated_at ?? ""),
    score: raw.score == null ? undefined : Number(raw.score),
    matchedText: raw.matchedText == null ? null : String(raw.matchedText),
    matchedBy: (raw.matchedBy as string[]) ?? undefined,
  };
}

export interface QaListParams {
  q?: string;
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listQa(params: QaListParams = {}): Promise<QaListResult> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const data = await request<{ items: Record<string, unknown>[]; total: number }>(
    `/api/qa?${query.toString()}`,
  );
  return { items: data.items.map(toItem), total: data.total };
}

export async function getQa(id: number): Promise<QaItem> {
  return toItem(await request<Record<string, unknown>>(`/api/qa/${id}`));
}

export async function createQa(patch: QaPatch): Promise<QaItem> {
  return toItem(await request<Record<string, unknown>>("/api/qa", json("POST", patch)));
}

export async function patchQa(id: number, patch: QaPatch): Promise<QaItem> {
  return toItem(
    await request<Record<string, unknown>>(`/api/qa/${id}`, json("PATCH", patch)),
  );
}

export async function deleteQa(id: number): Promise<void> {
  await request<{ ok: boolean }>(`/api/qa/${id}`, { method: "DELETE" });
}

export async function bulkDeleteQa(ids: number[]): Promise<number> {
  const data = await request<{ deleted: number }>(
    "/api/qa/bulk-delete",
    json("POST", { ids }),
  );
  return data.deleted;
}

export interface QaSearchResult {
  results: QaItem[];
  mode: string;
}

export async function searchQa(
  q: string,
  options: {
    limit?: number;
    types?: string[];
  } = {},
): Promise<QaItem[]> {
  const data = await request<{ results: Record<string, unknown>[] }>(
    "/api/qa/search",
    json("POST", { q, ...options }),
  );
  return data.results.map(toItem);
}

export async function qaStats(): Promise<QaStats> {
  return request<QaStats>("/api/qa/stats");
}

export async function reindexQa(scope: "all" | "failed" | "stale"): Promise<number> {
  const data = await request<{ queued: number }>("/api/qa/reindex", json("POST", { scope }));
  return data.queued;
}

export async function previewImport(file: File): Promise<QaPreview> {
  const body = new FormData();
  body.append("file", file);
  return request<QaPreview>("/api/qa/import/preview", { method: "POST", body });
}

export async function commitImport(
  token: string,
  mode: "merge" | "append",
): Promise<QaCommitResult> {
  return request<QaCommitResult>("/api/qa/import/commit", json("POST", { token, mode }));
}

export async function undoImport(importId: number): Promise<number> {
  const data = await request<{ deleted: number }>(`/api/qa/imports/${importId}`, {
    method: "DELETE",
  });
  return data.deleted;
}
