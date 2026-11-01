/** 统一的 JSON 接口请求：网络错误和 HTTP 错误都抛成带说明的 Error。 */

import i18n from "@/i18n";

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      i18n.t("common.request.network", {
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
      detail || i18n.t("common.request.http", { status: response.status }),
    );
  }
  return (await response.json()) as T;
}

export function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
