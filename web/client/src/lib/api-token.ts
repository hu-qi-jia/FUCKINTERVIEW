/**
 * 本地接口的访问令牌。
 *
 * 服务端渲染 /client/ 时把本次启动随机生成的令牌写进
 * `<meta name="app-token">`；这里给所有同源 /api/* 请求自动补上
 * `X-App-Token`。跨源页面拿不到这份 HTML，也就拿不到令牌。
 */

const TOKEN_SELECTOR = 'meta[name="app-token"]';

export function installApiToken(): void {
  if (typeof window === "undefined") return;
  const token = document
    .querySelector<HTMLMetaElement>(TOKEN_SELECTOR)
    ?.getAttribute("content");
  if (!token) return;

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL;
    try {
      const raw =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : String(input);
      url = new URL(raw, window.location.href);
    } catch {
      return original(input, init);
    }

    if (
      url.origin === window.location.origin &&
      url.pathname.startsWith("/api/") &&
      url.pathname !== "/api/offer"
    ) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set("X-App-Token", token);
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
}
