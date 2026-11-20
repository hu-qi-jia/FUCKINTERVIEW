"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getProfile,
  mergeCard,
  patchProfile,
  type CardPatch,
  type CoachSlots,
  type InterviewProfile,
  type ProfilePatch,
} from "@/lib/materials";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

const SAVE_DELAY_MS = 800;

function mergeMaterial<T extends object>(
  current: T,
  incoming: Partial<T> | undefined,
): T {
  return incoming ? { ...current, ...incoming } : current;
}

function applyPatch(
  current: InterviewProfile,
  next: ProfilePatch,
): InterviewProfile {
  return {
    ...current,
    ...next,
    resume: mergeMaterial(current.resume, next.resume),
    jobDescription: mergeMaterial(current.jobDescription, next.jobDescription),
  };
}

function mergePatch(
  base: ProfilePatch | null,
  next: ProfilePatch | null,
): ProfilePatch {
  if (!base) return next ?? {};
  if (!next) return base;
  return {
    ...base,
    ...next,
    resume: mergeMaterial(base.resume ?? {}, next.resume),
    jobDescription: mergeMaterial(
      base.jobDescription ?? {},
      next.jobDescription,
    ),
  };
}

/**
 * 一份面试档案的本地副本 + 自动保存。
 *
 * 所有编辑先落到本地状态，停手 800ms 后 PATCH；切换档案前调用 flush()
 * 保证没有丢在防抖窗口里的修改。
 */
export function useProfileEditor() {
  const [profile, setProfile] = useState<InterviewProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const profileRef = useRef<InterviewProfile | null>(null);
  const idRef = useRef<string | null>(null);
  const pendingRef = useRef<ProfilePatch | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const setBoth = useCallback((next: InterviewProfile | null) => {
    profileRef.current = next;
    setProfile(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(async () => {
    clearTimer();
    if (inFlightRef.current) await inFlightRef.current;

    const id = idRef.current;
    const patch = pendingRef.current;
    if (!id || !patch) return;

    pendingRef.current = null;
    setStatus("saving");
    setSaveError(null);

    const run = (async () => {
      try {
        const saved = await patchProfile(id, patch);
        if (idRef.current !== id) return;
        if (!pendingRef.current) {
          profileRef.current = saved;
          setProfile(saved);
        } else {
          // 请求期间又改了：只合并服务端维护的字段，别覆盖本地新编辑。
          setProfile((current) =>
            current && current.id === id
              ? {
                  ...current,
                  updatedAt: saved.updatedAt,
                  materialsRevision: saved.materialsRevision,
                }
              : current,
          );
        }
        setStatus("saved");
      } catch (error) {
        if (idRef.current !== id) return;
        pendingRef.current = mergePatch(patch, pendingRef.current);
        setStatus("failed");
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    })();

    inFlightRef.current = run.finally(() => {
      inFlightRef.current = null;
    });
    await inFlightRef.current;
  }, [clearTimer]);

  const patch = useCallback(
    (next: ProfilePatch) => {
      const id = idRef.current;
      if (!id) return;
      setProfile((current) => {
        if (!current || current.id !== id) return current;
        const merged = applyPatch(current, next);
        profileRef.current = merged;
        return merged;
      });
      pendingRef.current = mergePatch(pendingRef.current, next);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        void flush();
      }, SAVE_DELAY_MS);
    },
    [clearTimer, flush],
  );

  const load = useCallback(
    async (id: string, force = false) => {
      if (!force && idRef.current === id && profileRef.current) return;
      await flush();
      setLoading(true);
      setLoadError(null);
      try {
        const next = await getProfile(id);
        idRef.current = id;
        pendingRef.current = null;
        clearTimer();
        setBoth(next);
        setStatus("idle");
        setSaveError(null);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
        idRef.current = null;
        setBoth(null);
      } finally {
        setLoading(false);
      }
    },
    [clearTimer, flush, setBoth],
  );

  const open = useCallback((id: string) => load(id), [load]);

  const reload = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    await load(id, true);
  }, [load]);

  const clear = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
    idRef.current = null;
    setBoth(null);
    setStatus("idle");
    setSaveError(null);
    setLoadError(null);
  }, [clearTimer, setBoth]);

  /** 接口返回整份档案时直接替换（规划、手动刷新）。 */
  const replace = useCallback(
    (next: InterviewProfile) => {
      clearTimer();
      pendingRef.current = null;
      idRef.current = next.id;
      setBoth(next);
      setStatus("idle");
    },
    [clearTimer, setBoth],
  );

  /**
   * 同步一张服务端已经落盘（或正在流式写）的卡：按 slug 合并，没有就追加。
   *
   * 三个约定，改这里的时候别丢：
   * - **合并而不是整张覆盖**：流式生成会并发打进来半张半张的卡，四个并发
   *   同时改各自 slug 的字段，合并才不会互相冲掉。
   * - **不触发 PATCH**：这些是服务端状态，回写会把服务端刚落盘的结果冲掉。
   * - `dropAi` 为 true 时先清掉旧的 AI 卡：新规划落地那一刻服务端也刚清掉，
   *   两边一起动，界面上才不会出现两套卡。
   */
  const applyCard = useCallback((card: CardPatch, dropAi = false) => {
    setProfile((current) => {
      if (!current || current.id !== idRef.current) return current;
      const kept = dropAi
        ? current.cards.filter((item) => item.source !== "ai")
        : current.cards;
      const existing = kept.find((item) => item.slug === card.slug);
      const cards = existing
        ? kept.map((item) => (item.slug === card.slug ? mergeCard(item, card) : item))
        : [...kept, mergeCard(undefined, card)];
      const next = { ...current, cards };
      profileRef.current = next;
      return next;
    });
  }, []);

  /**
   * 补全清单已经由教练接口写盘：只同步本地，不再 PATCH 回服务器。
   * 否则整表回写会在另一个标签页刚写完时把它冲掉。
   */
  const applyCoachSlots = useCallback((slots: CoachSlots) => {
    setProfile((current) => {
      if (!current || current.id !== idRef.current) return current;
      const next = { ...current, coachSlots: slots };
      profileRef.current = next;
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  return {
    profile,
    loading,
    loadError,
    status,
    saveError,
    open,
    clear,
    patch,
    replace,
    applyCard,
    applyCoachSlots,
    flush,
    reload,
  };
}
