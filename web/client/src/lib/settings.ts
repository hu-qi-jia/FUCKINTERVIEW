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

export interface TtsSettings {
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  voice: string;
  group_id: string;
  language: string;
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
  tts: TtsSettings;
  embedding: EmbeddingSettings;
}

export interface ProviderMeta {
  value: string;
  label: string;
  defaultModel: string;
  defaultBaseUrl: string;
  models: string[];
}

export interface TtsProviderMeta extends ProviderMeta {
  defaultVoice: string;
  needsGroupId?: boolean;
}

export const ASR_PROVIDERS: ProviderMeta[] = [
  {
    value: "qwen",
    label: "Qwen（百炼 DashScope）",
    defaultModel: "qwen3-asr-flash",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3-asr-flash"],
  },
  {
    value: "minimax",
    label: "MiniMax",
    defaultModel: "asr-1.0",
    defaultBaseUrl: "https://api.minimax.io/v1",
    models: ["asr-1.0"],
  },
  {
    value: "deepgram",
    label: "Deepgram",
    defaultModel: "nova-3",
    defaultBaseUrl: "",
    models: ["nova-3", "nova-2", "enhanced"],
  },
  {
    value: "openai",
    label: "OpenAI Whisper（兼容接口）",
    defaultModel: "whisper-1",
    defaultBaseUrl: "https://api.openai.com/v1",
    models: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
  },
];

export const LLM_PROVIDERS: ProviderMeta[] = [
  {
    value: "openai_compatible",
    label: "OpenAI 兼容接口",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "deepseek-chat", "qwen-plus"],
  },
  {
    value: "qwen",
    label: "Qwen（百炼 DashScope）",
    defaultModel: "qwen-plus",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-max"],
  },
  {
    value: "anthropic",
    label: "Anthropic Claude",
    defaultModel: "claude-sonnet-5-5",
    defaultBaseUrl: "",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  },
];

export const TTS_PROVIDERS: TtsProviderMeta[] = [
  {
    value: "minimax",
    label: "MiniMax",
    defaultModel: "speech-2.8-turbo",
    defaultBaseUrl: "",
    defaultVoice: "Calm_Woman",
    models: ["speech-2.8-turbo", "speech-2.6-turbo", "speech-02-turbo"],
    needsGroupId: true,
  },
  {
    value: "qwen",
    label: "Qwen（百炼 DashScope）",
    defaultModel: "qwen3-tts-flash",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    defaultVoice: "Cherry",
    models: ["qwen3-tts-flash", "qwen-tts"],
  },
  {
    value: "openai",
    label: "OpenAI TTS",
    defaultModel: "gpt-4o-mini-tts",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultVoice: "alloy",
    models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
  },
  {
    value: "elevenlabs",
    label: "ElevenLabs",
    defaultModel: "eleven_flash_v2_5",
    defaultBaseUrl: "",
    defaultVoice: "21m00Tcm4TlvDq8ikWAM",
    models: ["eleven_flash_v2_5", "eleven_multilingual_v2"],
  },
  {
    value: "cartesia",
    label: "Cartesia",
    defaultModel: "sonic-2",
    defaultBaseUrl: "",
    defaultVoice: "86e30c1d-714b-4074-a1f2-1cb6b552fb49",
    models: ["sonic-2", "sonic"],
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
