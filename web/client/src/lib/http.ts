/** 统一的接口请求：网络错误和 HTTP 错误都抛成带说明的 Error。 */

import i18n from "@/i18n";

export interface RequestOptions {
  /** 追溯号：后端日志、产物里的 meta 都用它串起来。不传就现生成一个。 */
  trace?: string;
  /** 取消信号。点「停止」时 abort，请求和后端流会一起断掉。 */
  signal?: AbortSignal;
}

/** 一次「事情」一个追溯号：一次规划、一张卡的生成、一场面试。 */
export function newTraceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function withTrace(init: RequestInit | undefined, options: RequestOptions): RequestInit {
  const headers = new Headers(init?.headers);
  if (options.trace) headers.set("X-Trace-Id", options.trace);
  return {
    ...init,
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

async function errorFrom(response: Response): Promise<Error> {
  const detail = await response
    .json()
    .then((data: { detail?: string }) => data.detail)
    .catch(() => undefined);
  return new Error(
    detail || i18n.t("common.request.http", { status: response.status }),
  );
}

export async function request<T>(
  url: string,
  init?: RequestInit,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, withTrace(init, options));
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    throw new Error(
      i18n.t("common.request.network", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

/** 取消统一成这个错误，调用方好认。 */
export function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * 让后端把面试要用到的重活提前热掉（ONNX 两个模型、向量模型、供应商 SDK）。
 *
 * 后台跑、不等结果，失败也不影响任何功能——预热只为缩短「开始面试」到
 * 「连上」那一段，热不热得到都照样能面试。
 */
export function prewarm(): void {
  void fetch("/api/prewarm", { method: "POST" }).catch(() => {});
}

/**
 * 读一条 SSE 流，逐个 yield 出 `data:` 后面的 JSON 对象。
 *
 * 取消：给 options.signal 传一个 AbortController 的 signal，
 * abort 之后生成器抛 AbortError 并且底层 fetch 会立刻断开，
 * 后端那边会收到取消、把卡片退回 pending——这就是「可闭环」的另一半。
 */
export async function* streamRequest<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
  options: RequestOptions = {},
): AsyncGenerator<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...withTrace(init, options),
      headers: new Headers({ ...(init?.headers as object), Accept: "text/event-stream" }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    throw new Error(
      i18n.t("common.request.network", {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  if (!response.ok) throw await errorFrom(response);
  if (!response.body) {
    throw new Error(i18n.t("common.request.network", { message: "empty body" }));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const payload = parseSseChunk(chunk);
        if (payload !== undefined) yield payload as T;
        split = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    throw error;
  } finally {
    reader.releaseLock();
  }

  // 流末尾可能还压着一条没带空行的。
  const tail = parseSseChunk(buffer);
  if (tail !== undefined) yield tail as T;
}

function parseSseChunk(chunk: string): Record<string, unknown> | undefined {
  const data = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  if (!data) return undefined;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
