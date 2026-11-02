"use strict";

/**
 * URL 白名单。不能拿字符串前缀判断「是不是应用内地址」：
 * `http://127.0.0.1:7860@evil.example/` 会通过 startsWith，真实 host 却是
 * evil.example。这里统一用 WHATWG URL 解析后比较精确 Origin。
 */

function normalizeOrigin(raw) {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** 站外链接只允许 http/https；其它协议（file:、javascript: 等）返回 null。 */
function safeExternalUrl(raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  return target.href;
}

function createUrlPolicy(loadingPage) {
  let appOrigin = null;

  return {
    setAppOrigin(raw) {
      appOrigin = normalizeOrigin(raw);
    },
    getAppOrigin() {
      return appOrigin;
    },
    isAppUrl(raw) {
      if (raw === loadingPage) return true;
      if (!appOrigin) return false;
      return normalizeOrigin(raw) === appOrigin;
    },
    isAppOrigin(raw) {
      if (!appOrigin || !raw) return false;
      return normalizeOrigin(raw) === appOrigin;
    },
  };
}

module.exports = { createUrlPolicy, normalizeOrigin, safeExternalUrl };
