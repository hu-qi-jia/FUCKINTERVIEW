"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 桌面端的「应用图标」：把任务栏和托盘图标换成别的样子，投屏时不暴露应用。
 *
 * 图标文件和当前选择都由主进程管理（见 desktop/electron/app-icon.js），
 * 页面只负责展示预设缩略图并下发切换。浏览器版没有这个能力，
 * supported 为 false，设置页据此隐藏这一栏。
 */
export function useAppIcon() {
  const api =
    typeof window === "undefined" ? undefined : window.desktop?.appIcon;
  const supported = Boolean(api);
  const [state, setState] = useState<AppIconState | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api
      .get()
      .then((value) => {
        if (!cancelled) setState(value);
      })
      .catch(() => {
        // 读不到就整栏不显示，比显示一堆空缩略图好。
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /** 统一收口：主进程失败时不改本地状态，避免选中框和实际图标对不上。 */
  const commit = useCallback(
    (pending: Promise<AppIconState | null>) =>
      pending
        .then((value) => {
          if (value) setState(value);
          return Boolean(value);
        })
        .catch(() => false),
    []
  );

  const setPreset = useCallback(
    (preset: string) => {
      if (!api) return Promise.resolve(false);
      return commit(api.set(preset));
    },
    [api, commit]
  );

  const pickImage = useCallback(() => {
    if (!api) return Promise.resolve(false);
    return commit(api.pickImage());
  }, [api, commit]);

  const pickApp = useCallback(() => {
    if (!api) return Promise.resolve(false);
    return commit(api.pickApp());
  }, [api, commit]);

  return { supported, state, setPreset, pickImage, pickApp };
}
