import i18n from "@/i18n";

/** 设置页的数据模型与供应商元信息。 */

export interface AsrSettings {
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  language: string;
}

export interface LlmSettings {
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  /** 关掉推理模型的思考，换取首字延迟；不认这个参数的供应商要关掉。 */
  disable_thinking?: boolean;
}

export interface EmbeddingSettings {
  /** 本地向量模型名，默认 BAAI/bge-small-zh-v1.5（ONNX，不需要 torch）。 */
  model: string;
  /** 实时面试里「命中即直出」的相似度阈值，本期只存不用。 */
  relevance_threshold?: number;
}

export interface AppSettings {
  asr: AsrSettings;
  llm: LlmSettings;
  embedding: EmbeddingSettings;
}

export interface ProviderMeta {
  value: string;
  /** i18n key：供应商名称会随界面语言切换。 */
  labelKey: string;
  models: string[];
}

export const ASR_PROVIDERS: ProviderMeta[] = [
  {
    value: "qwen",
    labelKey: "settings.providers.qwen",
    models: ["qwen3-asr-flash"],
  },
  {
    value: "minimax",
    labelKey: "settings.providers.minimax",
    models: ["asr-1.0"],
  },
  {
    value: "deepgram",
    labelKey: "settings.providers.deepgram",
    models: ["nova-3", "nova-2", "enhanced"],
  },
  {
    value: "openai",
    labelKey: "settings.providers.openaiWhisper",
    models: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
  },
];

export const LLM_PROVIDERS: ProviderMeta[] = [
  {
    value: "openai_compatible",
    labelKey: "settings.providers.openaiCompatible",
    models: ["gpt-4o-mini", "gpt-4o", "deepseek-chat", "qwen-plus"],
  },
  {
    value: "qwen",
    labelKey: "settings.providers.qwen",
    models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-max"],
  },
  {
    value: "anthropic",
    labelKey: "settings.providers.anthropic",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  },
];

export function findProvider<T extends ProviderMeta>(
  providers: T[],
  value: string,
): T | undefined {
  return providers.find((item) => item.value === value);
}

export async function fetchSettings(): Promise<AppSettings> {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    throw new Error(
      i18n.t("settings.readFailed", { status: response.status }),
    );
  }
  return (await response.json()) as AppSettings;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((data: { detail?: string }) => data.detail)
      .catch(() => undefined);
    throw new Error(
      detail || i18n.t("settings.saveFailed", { status: response.status }),
    );
  }
  return (await response.json()) as AppSettings;
}
