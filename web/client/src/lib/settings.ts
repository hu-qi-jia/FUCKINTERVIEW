import i18n from "@/i18n";

/** 设置页的数据模型与供应商元信息。 */

export interface AsrProviderConfig {
  api_key: string;
  base_url: string;
  model: string;
  language: string;
}

export interface AsrSettings {
  provider: string;
  /** 每个供应商各存一份：切换供应商不会丢另一家的 Key / 地址 / 模型。 */
  configs: Record<string, AsrProviderConfig>;
}

/** 材料生成的思考档位，对应 DeepSeek 的 reasoning_effort。只有这四档，没有连续刻度。 */
export const THINKING_EFFORTS = ["none", "low", "high", "max"] as const;
export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];

export interface LlmSettings {
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  /** 语音管线专用：关掉思考换首字延迟。不认这个参数的供应商要关掉。 */
  disable_thinking?: boolean;
/**
   * 经历卡生成专用的思考档位。
   *
   * 只有生成经历卡吃它：卡片要交给候选人照着说，值得多想一会儿。
   * 规划、简历整合、教练问答在等待路径上，思考实测慢好几倍却没换来更好的
   * 输出，后端把那几路压回了 none。
   *
   * 和 disable_thinking 分开：一个管实时语音，一个管经历卡生成。
   */
  thinking_effort?: ThinkingEffort;
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

export type AsrTransport = "websocket" | "upload";
export type AsrStreaming = "input" | "output" | "none";

export interface AsrModelMeta {
  id: string;
  /** websocket = 边说边发；upload = VAD 切段后整段上传。 */
  transport: AsrTransport;
  /** input = 音频流式；output = 结果流式；none = 整段识别。 */
  streaming: AsrStreaming;
  /** 切到这个模型时自动带出的请求地址。 */
  baseUrl?: string;
}

export interface AsrProviderMeta {
  value: string;
  labelKey: string;
  /** 供应商默认请求地址；模型没单独给地址时用它。 */
  defaultBaseUrl: string;
  models: AsrModelMeta[];
}

export const QWEN_HTTP_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const QWEN_REALTIME_BASE_URL =
  "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
export const MINIMAX_BASE_URL = "https://api.minimax.cn/v1";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const ASR_PROVIDERS: AsrProviderMeta[] = [
  {
    value: "qwen",
    labelKey: "settings.providers.qwen",
    defaultBaseUrl: QWEN_HTTP_BASE_URL,
    models: [
      {
        id: "qwen3-asr-flash",
        transport: "upload",
        streaming: "none",
        baseUrl: QWEN_HTTP_BASE_URL,
      },
      {
        id: "qwen3-asr-flash-realtime",
        transport: "websocket",
        streaming: "input",
        baseUrl: QWEN_REALTIME_BASE_URL,
      },
    ],
  },
  {
    value: "minimax",
    labelKey: "settings.providers.minimax",
    defaultBaseUrl: MINIMAX_BASE_URL,
    models: [
      {
        id: "asr-1.0",
        transport: "upload",
        streaming: "output",
        baseUrl: MINIMAX_BASE_URL,
      },
    ],
  },
  {
    value: "deepgram",
    labelKey: "settings.providers.deepgram",
    defaultBaseUrl: "",
    models: [
      { id: "nova-3", transport: "websocket", streaming: "input" },
      { id: "nova-2", transport: "websocket", streaming: "input" },
      { id: "enhanced", transport: "websocket", streaming: "input" },
    ],
  },
  {
    value: "openai",
    labelKey: "settings.providers.openaiWhisper",
    defaultBaseUrl: OPENAI_BASE_URL,
    models: [
      {
        id: "whisper-1",
        transport: "upload",
        streaming: "none",
        baseUrl: OPENAI_BASE_URL,
      },
      {
        id: "gpt-4o-transcribe",
        transport: "upload",
        streaming: "none",
        baseUrl: OPENAI_BASE_URL,
      },
      {
        id: "gpt-4o-mini-transcribe",
        transport: "upload",
        streaming: "none",
        baseUrl: OPENAI_BASE_URL,
      },
    ],
  },
];

export function findAsrProvider(value: string): AsrProviderMeta | undefined {
  return ASR_PROVIDERS.find((item) => item.value === value);
}

export function findAsrModel(
  provider: string,
  model: string,
): AsrModelMeta | undefined {
  return findAsrProvider(provider)?.models.find((item) => item.id === model);
}

/** 某家供应商的空配置（带默认地址和第一个模型）。 */
export function emptyAsrConfig(provider: string): AsrProviderConfig {
  const meta = findAsrProvider(provider);
  return {
    api_key: "",
    base_url: meta?.defaultBaseUrl ?? "",
    model: meta?.models[0]?.id ?? "",
    language: "zh",
  };
}

export function activeAsrConfig(asr: AsrSettings | undefined): AsrProviderConfig {
  if (!asr) return emptyAsrConfig("qwen");
  return asr.configs?.[asr.provider] ?? emptyAsrConfig(asr.provider);
}

/**
 * 把后端返回的 ASR 配置统一成新结构。
 *
 * 后端升级后会返回 configs；但开发版可能还连着旧后端，或者配置文件刚
 * 迁移完。旧平铺结构在这里兜一层，设置页不会因为 undefined 白屏。
 */
export function normalizeAsrSettings(raw: unknown): AsrSettings {
  const source = (raw ?? {}) as Record<string, unknown>;
  const provider = findAsrProvider(String(source.provider ?? ""))
    ? String(source.provider)
    : "qwen";
  const configs: Record<string, AsrProviderConfig> = {};
  for (const meta of ASR_PROVIDERS) {
    configs[meta.value] = emptyAsrConfig(meta.value);
  }

  const incoming = source.configs;
  if (incoming && typeof incoming === "object") {
    for (const meta of ASR_PROVIDERS) {
      const values = (incoming as Record<string, unknown>)[meta.value];
      if (!values || typeof values !== "object") continue;
      const cfg = values as Record<string, unknown>;
      configs[meta.value] = {
        api_key: String(cfg.api_key ?? ""),
        base_url: String(cfg.base_url ?? "") || meta.defaultBaseUrl,
        model: String(cfg.model ?? "") || meta.models[0]?.id || "",
        language: String(cfg.language ?? "") || "zh",
      };
    }
  } else {
    // 旧平铺结构只覆盖当前供应商。
    configs[provider] = {
      api_key: String(source.api_key ?? ""),
      base_url: String(source.base_url ?? "") || emptyAsrConfig(provider).base_url,
      model: String(source.model ?? "") || emptyAsrConfig(provider).model,
      language: String(source.language ?? "") || "zh",
    };
  }

  return { provider, configs };
}

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
  const data = (await response.json()) as AppSettings;
  return { ...data, asr: normalizeAsrSettings(data.asr) };
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
