/** 术语库的前端数据模型与接口。 */

import i18n from "@/i18n";

export type TermTemplate = "product" | "engineering" | "ai" | "ops" | "custom";

export const TERM_TEMPLATES: TermTemplate[] = ["product", "engineering", "ai", "ops"];

/** 和后端 app/terms.py 的上限保持一致。 */
export const MAX_TERM = 32;
export const MAX_ALIAS = 32;

export interface TermItem {
  id: number;
  template: TermTemplate;
  term: string;
  definition: string;
  aliases: string[];
  enabled: boolean;
  hidden: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TermPatch {
  term?: string;
  definition?: string;
  aliases?: string[];
  enabled?: boolean;
}

export interface TermStats {
  total: number;
  custom: number;
  templates: Record<string, boolean>;
  version: number;
}

export interface TemplateCatalogItem {
  id: TermTemplate;
  count: number;
  enabled: boolean;
  terms: Array<{ term: string; aliases: string[] }>;
}

export interface TermCorrection {
  from: string;
  to: string;
}

export interface TermSuggestion {
  from: string;
  to: string;
  reason: string;
}

export interface TermRecent {
  corrections: TermCorrection[];
  suggestions: TermSuggestion[];
}

export interface BulkParseRow {
  term: string;
  aliases: string[];
  definition: string;
}

export interface BulkParse {
  items: BulkParseRow[];
  errors: Array<{ line: number; message: string; text: string }>;
  truncated: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      i18n.t("terms.errors.network", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((data: { detail?: string }) => data.detail)
      .catch(() => undefined);
    throw new Error(detail || i18n.t("terms.errors.http", { status: response.status }));
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
function toItem(raw: Record<string, unknown>): TermItem {
  return {
    id: Number(raw.id),
    template: (raw.template as TermTemplate) ?? "custom",
    term: String(raw.term ?? ""),
    definition: String(raw.definition ?? ""),
    aliases: (raw.aliases as string[]) ?? [],
    enabled: Boolean(raw.enabled),
    hidden: Boolean(raw.hidden),
    sort_order: Number(raw.sort_order ?? 0),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

export async function listTerms(params: { q?: string; template?: string } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const data = await request<{ items: Record<string, unknown>[]; total: number }>(
    `/api/terms?${query.toString()}`,
  );
  return { items: data.items.map(toItem), total: data.total };
}

export async function createTerm(patch: TermPatch): Promise<TermItem> {
  return toItem(await request<Record<string, unknown>>("/api/terms", json("POST", patch)));
}

export async function updateTerm(id: number, patch: TermPatch): Promise<TermItem> {
  return toItem(
    await request<Record<string, unknown>>(`/api/terms/${id}`, json("PATCH", patch)),
  );
}

export async function deleteTerm(id: number): Promise<void> {
  await request<{ ok: boolean }>(`/api/terms/${id}`, { method: "DELETE" });
}

export async function termStats(): Promise<TermStats> {
  return request<TermStats>("/api/terms/stats");
}

export async function listTemplates(): Promise<TemplateCatalogItem[]> {
  const data = await request<{ items: TemplateCatalogItem[] }>("/api/terms/templates");
  return data.items;
}

export async function toggleTemplate(id: string, enabled: boolean) {
  return request<Record<string, boolean>>(
    `/api/terms/templates/${id}`,
    json("POST", { enabled }),
  );
}

export async function resetTemplate(id: string): Promise<number> {
  const data = await request<{ restored: number }>(
    `/api/terms/templates/${id}/reset`,
    { method: "POST" },
  );
  return data.restored;
}

export async function parseBulk(text: string): Promise<BulkParse> {
  return request<BulkParse>("/api/terms/parse", json("POST", { text }));
}

export async function commitBulk(text: string) {
  return request<{ created: number; updated: number; errors: number }>(
    "/api/terms/bulk",
    json("POST", { text }),
  );
}

export async function recentTerms(): Promise<TermRecent> {
  return request<TermRecent>("/api/terms/recent");
}

export async function clearRecent(): Promise<void> {
  await request<{ ok: boolean }>("/api/terms/recent/clear", { method: "POST" });
}
