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
        if (!cancelled) setState((current) => merge(current, value));
      })
      .catch(() => {
        // 读不到就整栏不显示，比显示一堆空缩略图好。
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  /**
   * 选中态当场就换，不等 IPC 回话。
   *
   * 早先要等主进程整条链路（含起 PowerShell 改快捷方式）跑完才变，点一下
   * 要呆半秒到两秒。现在主进程只做「写盘 + 换窗体图标」就回话，任务栏在
   * 后台跑，这里的乐观更新让点击的反馈是即时的。
   *
   * 主进程就算拒绝了（比如还没上传自定义图就想切过去），回的也是它认可的
   * 状态，下面 commit 会立刻纠正过来，不会停在错误的选中框上。
   */
  const select = useCallback((preset: string) => {
    setState((current) => (current ? { ...current, preset } : current));
  }, []);

  /** 统一收口：主进程失败时不改本地状态，避免选中框和实际图标对不上。 */
  const commit = useCallback(
    (pending: Promise<AppIconState | null>) =>
      pending
        .then((value) => {
          if (!value) return false;
          setState((current) => merge(current, value));
          return true;
        })
        .catch(() => false),
    []
  );

  const setPreset = useCallback(
    (preset: string) => {
      if (!api) return Promise.resolve(false);
      select(preset);
      return commit(api.set(preset));
    },
    [api, commit, select]
  );

  const pickImage = useCallback(() => {
    if (!api) return Promise.resolve(false);
    return commit(api.pickImage());
  }, [api, commit]);

  /** 重启应用，让任务栏图标重新读快捷方式。 */
  const relaunch = useCallback(() => {
    if (!api) return Promise.resolve(false);
    return api.relaunch().catch(() => false);
  }, [api]);

  return { supported, state, setPreset, pickImage, relaunch };
}

/**
 * 两次 describe() 结果一样就沿用旧对象，别触发重渲染。
 *
 * 主进程那边缩略图是缓存的，dataUrl 每次都是同一串字符，所以这个比较是
 * 有效的：点一下图标只换选中框，四张 `<img>` 一个都不会重新解码重绘。
 */
function merge(
  current: AppIconState | null,
  next: AppIconState | null,
): AppIconState | null {
  if (!next) return current;
  if (!current) return next;
  const same =
    current.preset === next.preset &&
    current.custom === next.custom &&
    current.presets.length === next.presets.length &&
    current.presets.every(
      (item, index) =>
        item.id === next.presets[index].id &&
        item.dataUrl === next.presets[index].dataUrl,
    );
  return same ? { ...current, preset: next.preset } : next;
}
