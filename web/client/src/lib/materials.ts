/** 面试材料（面试档案）的前端数据模型与接口。 */

import i18n from "@/i18n";

export type InterviewLanguage = "zh" | "en";
export type CardStatus = "pending" | "generating" | "ready" | "failed";
export type CardSource = "ai" | "manual";

export type CardBodyKey =
  | "facts"
  | "defense"
  | "pushback"
  | "boundaries"
  | "depth"
  | "nextQuestion";

export const CARD_BODY_KEYS: CardBodyKey[] = [
  "facts",
  "defense",
  "pushback",
  "boundaries",
  "depth",
  "nextQuestion",
];

export const CARDS_MAX = 10;

export interface MaterialSection {
  original: string;
  content: string;
  updatedAt: string | null;
}

export interface ExperienceCard {
  slug: string;
  name: string;
  description: string;
  body: Record<CardBodyKey, string>;
  source: CardSource;
  status: CardStatus;
  error: string | null;
  sourceRevision: number;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewProfile {
  id: string;
  name: string;
  language: InterviewLanguage;
  resume: MaterialSection;
  jobDescription: MaterialSection;
  cards: ExperienceCard[];
  /** 和 AI 完善档案的对话记录（老档案可能没有这个字段）。 */
  coachChat?: CoachMessage[];
  /** 教练估的补齐进度。 */
  coachProgress?: CoachProgress;
  /** 每张卡已确认的维度：{ [cardSlug]: ["scale", "actions", …] }。 */
  coachCoverage?: Record<string, string[]>;
  materialsRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CoachMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CoachProgress {
  percent: number;
  remaining: string[];
}

export interface CoachReply {
  reply: string;
  coverage: Record<string, string[]>;
  percent: number;
  remaining: string[];
}

/** 教练对话整理出的卡片更新；确认后由前端写回。 */
export interface CardProposal {
  slug: string;
  name: string;
  description: string;
  body: Record<CardBodyKey, string>;
}

export interface ProfileSummary {
  id: string;
  name: string;
  language: InterviewLanguage;
  updatedAt: string;
  cardCount: number;
  readyCardCount: number;
  hasResume: boolean;
  hasJobDescription: boolean;
  materialsRevision: number;
}

export interface StorageInfo {
  dataDir: string;
  file: string;
  exists: boolean;
  fileExists: boolean;
}

export type MaterialKind = "resume" | "jobDescription";

export interface ProfilePatch {
  name?: string;
  language?: InterviewLanguage;
  resume?: Partial<MaterialSection>;
  jobDescription?: Partial<MaterialSection>;
  cards?: ExperienceCard[];
  coachChat?: CoachMessage[];
  coachProgress?: CoachProgress;
  coachCoverage?: Record<string, string[]>;
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
      detail ||
        i18n.t("materials.errors.http", { status: response.status }),
    );
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

export async function listProfiles(): Promise<ProfileSummary[]> {
  const data = await request<{ profiles: ProfileSummary[] }>("/api/profiles");
  return data.profiles;
}

export async function createProfile(name: string): Promise<InterviewProfile> {
  return request<InterviewProfile>("/api/profiles", json("POST", { name }));
}

export async function getProfile(id: string): Promise<InterviewProfile> {
  return request<InterviewProfile>(`/api/profiles/${id}`);
}

export async function patchProfile(
  id: string,
  patch: ProfilePatch,
): Promise<InterviewProfile> {
  return request<InterviewProfile>(`/api/profiles/${id}`, json("PATCH", patch));
}

export async function deleteProfile(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/profiles/${id}`, { method: "DELETE" });
}

export async function consolidateMaterial(
  id: string,
  kind: MaterialKind,
  content: string,
  language: InterviewLanguage,
): Promise<string> {
  const data = await request<{ content: string }>(
    `/api/profiles/${id}/consolidate`,
    json("POST", { kind, content, language }),
  );
  return data.content;
}

export async function planSkills(id: string): Promise<InterviewProfile> {
  return request<InterviewProfile>(
    `/api/profiles/${id}/skills/plan`,
    json("POST", {}),
  );
}

export async function generateSkill(
  id: string,
  slug: string,
): Promise<ExperienceCard> {
  return request<ExperienceCard>(
    `/api/profiles/${id}/skills/${encodeURIComponent(slug)}/generate`,
    json("POST", {}),
  );
}

export type CoachIntent = "continue" | "skip";

export async function coachReply(
  id: string,
  messages: CoachMessage[],
  intent?: CoachIntent,
): Promise<CoachReply> {
  return request<CoachReply>(
    `/api/profiles/${id}/coach`,
    json("POST", intent ? { messages, intent } : { messages }),
  );
}

export async function coachApply(
  id: string,
  messages: CoachMessage[],
): Promise<CardProposal[]> {
  const data = await request<{ cards: CardProposal[] }>(
    `/api/profiles/${id}/coach/apply`,
    json("POST", { messages }),
  );
  return data.cards;
}

export async function fetchStorage(): Promise<StorageInfo> {
  return request<StorageInfo>("/api/storage");
}

export async function saveStorage(
  dataDir: string,
  migrate = true,
): Promise<StorageInfo> {
  return request<StorageInfo>("/api/storage", json("PUT", { dataDir, migrate }));
}

export async function openStorageFolder(): Promise<void> {
  await request<{ ok: boolean }>("/api/storage/open", { method: "POST" });
}

/** 空卡片（手动新增时用）。 */
export function emptyCard(
  slug: string,
  name: string,
  sourceRevision: number,
  position: number,
): ExperienceCard {
  const now = new Date().toISOString();
  return {
    slug,
    name,
    description: "",
    body: {
      facts: "",
      defense: "",
      pushback: "",
      boundaries: "",
      depth: "",
      nextQuestion: "",
    },
    source: "manual",
    status: "ready",
    error: null,
    sourceRevision,
    position,
    createdAt: now,
    updatedAt: now,
  };
}

export function sortCards(cards: ExperienceCard[]): ExperienceCard[] {
  return [...cards].sort((a, b) => a.position - b.position);
}

export function isCardStale(
  card: ExperienceCard,
  materialsRevision: number,
): boolean {
  return card.source === "ai" && card.status === "ready" &&
    card.sourceRevision !== materialsRevision;
}
