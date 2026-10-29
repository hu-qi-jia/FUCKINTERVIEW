"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ConsolePanel,
  ConsolePanelActions,
  ConsolePanelHeader,
  ConsolePanelTitle,
} from "@/components/pipecat/console/panel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  COACH_DIMENSIONS,
  coachAnswer,
  coachQuestions,
  coachWriteBack,
  sortCards,
  type CoachDimension,
  type CoachSlot,
  type CoachSlots,
  type InterviewProfile,
} from "@/lib/materials";
import { cn } from "@/lib/utils";

function slotOf(slots: CoachSlots, slug: string, dimension: CoachDimension) {
  return (slots[slug] ?? {})[dimension] as CoachSlot | undefined;
}

function filledCount(slots: CoachSlots, slug: string) {
  return COACH_DIMENSIONS.filter((dimension) => slotOf(slots, slug, dimension)?.a)
    .length;
}

/**
 * 「和 AI 完善面试档案」：补全清单，不是聊天。
 *
 * 每张经历卡固定 6 个维度，AI 针对这张卡把问题一次性出好并存在档案里，
 * 回答也逐格落盘。界面上没有「会话」这个概念：重新打开、关掉页面、
 * 换台机器，看到的都是同一张清单，从还没答的那一格继续就行。
 */
export function CoachPanel({
  profile,
  busy,
  onCoachSlots,
  onReplace,
  onFlush,
}: {
  profile: InterviewProfile;
  busy: boolean;
  /** 清单已经由接口落盘，这里只同步本地状态，不再回写服务器。 */
  onCoachSlots: (slots: CoachSlots) => void;
  onReplace: (profile: InterviewProfile) => void;
  onFlush: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const cards = sortCards(profile.cards.filter((card) => card.status === "ready"));
  const slots = profile.coachSlots ?? {};

  const [slug, setSlug] = useState("");
  const [active, setActive] = useState<CoachDimension | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState<CoachDimension | null>(null);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 出题失败后的重试：清掉「已请求过」标记再跑一次同一个 effect。
  const [retryToken, setRetryToken] = useState(0);
  // 这张卡的问题要不要生成：默认不动手，等用户点「开始补全」再调模型。
  const [started, setStarted] = useState(false);

  // 已经为哪些卡请求过问题：避免每次渲染都重新请求。
  const requested = useRef(new Set<string>());
  // 已保存回答的那个维度：下一次自动展开从它后面接着找。
  const advanceFrom = useRef<CoachDimension | null>(null);
  // 回答保存后要跳到下一格，用这个标记区分「刚保存完」和「用户主动点开」。
  const advanceRef = useRef(false);
  // 异步请求返回时档案可能已经换了一份：用它把上一份的结果丢掉。
  const profileIdRef = useRef(profile.id);
  profileIdRef.current = profile.id;

  // 换档案时全部重置，别把上一份问题出的结果带到这一份上。
  useEffect(() => {
    requested.current.clear();
    advanceFrom.current = null;
    advanceRef.current = false;
    setActive(null);
    setDraft("");
    setError(null);
    setStarted(false);
  }, [profile.id]);

  // 默认选第一张还没补完的卡。
  useEffect(() => {
    if (cards.some((card) => card.slug === slug)) return;
    const next =
      cards.find((card) => filledCount(slots, card.slug) < COACH_DIMENSIONS.length) ??
      cards[0];
    setSlug(next?.slug ?? "");
  }, [cards, slug, slots]);

  const cardSlots = slug ? (slots[slug] ?? {}) : {};
  const slugValid = Boolean(slug) && cards.some((card) => card.slug === slug);
  const questionsReady =
    Boolean(slug) &&
    COACH_DIMENSIONS.every((dimension) => Boolean(cardSlots[dimension]?.q));

  // 第一次打开这张卡：让 AI 出题，落盘后本地跟着更新。
  useEffect(() => {
    if (!started) return;
    if (!slug || !slugValid || questionsReady || requested.current.has(slug)) {
      return;
    }
    const profileId = profile.id;
    requested.current.add(slug);
    setError(null);
    void (async () => {
      try {
        const next = await coachQuestions(profileId, slug);
        if (profileIdRef.current !== profileId) return;
        // 服务端会补全缺失的维度；真回不全就不要停在骨架屏上，给个可重试的错。
        if (!COACH_DIMENSIONS.every((dimension) => next[slug]?.[dimension]?.q)) {
          requested.current.delete(slug);
          setError(t("materials.coach.incomplete"));
          return;
        }
        onCoachSlots(next);
      } catch (cause) {
        if (profileIdRef.current !== profileId) return;
        requested.current.delete(slug);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, slugValid, questionsReady, started, profile.id, retryToken]);

  // 切卡时清空编辑状态，也回到「还没开始出题」。
  useEffect(() => {
    setActive(null);
    setDraft("");
    setError(null);
    setStarted(false);
  }, [slug]);

  // 问题到手 / 刚保存完一格：自动展开下一个还没答的维度。
  const answeredCount = COACH_DIMENSIONS.filter(
    (dimension) => cardSlots[dimension]?.a,
  ).length;
  useEffect(() => {
    if (!questionsReady) return;
    if (!advanceRef.current && active !== null) return;
    advanceRef.current = false;

    // 从刚保存的那一项往后找第一个没答的，找不到再从头绕一圈。
    const from = advanceFrom.current;
    advanceFrom.current = null;
    const start = from ? COACH_DIMENSIONS.indexOf(from) + 1 : 0;
    const order = [
      ...COACH_DIMENSIONS.slice(start),
      ...COACH_DIMENSIONS.slice(0, start),
    ];
    setActive(order.find((dimension) => !cardSlots[dimension]?.a) ?? null);
    setDraft("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionsReady, answeredCount]);

  const toggle = (dimension: CoachDimension) => {
    if (active === dimension) {
      setActive(null);
      setDraft("");
      return;
    }
    setActive(dimension);
    setDraft(cardSlots[dimension]?.a ?? "");
  };

  const save = async (dimension: CoachDimension) => {
    const text = draft.trim();
    if (!text || saving) return;
    const profileId = profile.id;
    setSaving(dimension);
    setError(null);
    try {
      const next = await coachAnswer(profileId, slug, dimension, text);
      if (profileIdRef.current !== profileId) return;
      advanceFrom.current = dimension;
      advanceRef.current = true;
      onCoachSlots(next);
    } catch (cause) {
      if (profileIdRef.current !== profileId) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(null);
    }
  };

  const writeBack = async () => {
    if (writing || !slug) return;
    const profileId = profile.id;
    setWriting(true);
    setError(null);
    try {
      await onFlush();
      const next = await coachWriteBack(profileId, slug);
      if (profileIdRef.current !== profileId) return;
      onReplace(next);
      // 写回后直接停到下一个还没答的维度上，不用再点一次。
      const after = next.coachSlots?.[slug] ?? {};
      setActive(
        COACH_DIMENSIONS.find((dimension) => !after[dimension]?.a) ?? null,
      );
      setDraft("");
    } catch (cause) {
      if (profileIdRef.current !== profileId) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWriting(false);
    }
  };

  if (cards.length === 0) {
    return (
      <ConsolePanel className="mt-6 h-auto">
        <ConsolePanelHeader>
          <ConsolePanelTitle>{t("materials.coach.title")}</ConsolePanelTitle>
        </ConsolePanelHeader>
        <p className="text-muted-foreground px-(--card-spacing) pb-(--card-spacing) text-xs">
          {t("materials.coach.needCards")}
        </p>
      </ConsolePanel>
    );
  }

  const filled = slug ? filledCount(slots, slug) : 0;
  const total = COACH_DIMENSIONS.length;
  const pending = slug
    ? COACH_DIMENSIONS.filter(
        (dimension) => cardSlots[dimension]?.a && !cardSlots[dimension]?.applied,
      ).length
    : 0;
  const percent = Math.round((filled / total) * 100);

  return (
    <ConsolePanel className="mt-6 h-auto">
      <ConsolePanelHeader>
        <ConsolePanelTitle>{t("materials.coach.title")}</ConsolePanelTitle>
        <ConsolePanelActions>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || writing || pending === 0}
            onClick={() => void writeBack()}
          >
            {writing && <Spinner className="size-3.5" />}
            {writing ? t("materials.coach.writing") : t("materials.coach.write")}
          </Button>
        </ConsolePanelActions>
      </ConsolePanelHeader>

      <div className="grid gap-2 px-(--card-spacing) pb-(--card-spacing)">
        <div className="flex items-center gap-2">
          <Select
            items={cards.map((card) => ({
              value: card.slug,
              label: `${card.name || t("materials.coach.untitled")} · ${filledCount(slots, card.slug)}/${total}`,
            }))}
            value={slug}
            onValueChange={(value) => setSlug(String(value))}
          >
            <SelectTrigger
              className="h-8 min-w-0 flex-1"
              disabled={busy || writing || saving !== null}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {cards.map((card) => (
                <SelectItem key={card.slug} value={card.slug}>
                  <span className="flex w-full items-center justify-between gap-4">
                    <span className="truncate">
                      {card.name || t("materials.coach.untitled")}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {filledCount(slots, card.slug)}/{total}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {t("materials.coach.progress", { filled, total })}
          </span>
        </div>

        <div className="bg-muted h-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        {started && !questionsReady && !error ? (
          <div className="grid gap-2 pt-1">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Spinner className="size-3" />
              {t("materials.coach.preparing")}
            </p>
            {COACH_DIMENSIONS.map((dimension, index) => (
              <div
                key={dimension}
                className="grid grid-cols-[1.125rem_minmax(0,1fr)] gap-x-3"
              >
                <span className="bg-muted/60 mt-0.5 size-4.5 shrink-0 rounded-full" />
                <div className="grid animate-pulse gap-1.5 pb-2">
                  <span className="bg-muted h-2.5 w-24 rounded-full" />
                  <span
                    className="bg-muted/60 h-2.5 rounded-full"
                    style={{ width: `${70 - index * 4}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : questionsReady ? (
          <ol className="grid pt-1">
            {COACH_DIMENSIONS.map((dimension, index) => {
              const slot = cardSlots[dimension];
              const filledSlot = Boolean(slot?.a);
              const open = active === dimension;
              return (
                <li
                  key={dimension}
                  className="grid grid-cols-[1.125rem_minmax(0,1fr)] gap-x-3"
                >
                  <div className="relative flex justify-center">
                    {index < COACH_DIMENSIONS.length - 1 && (
                      <span
                        aria-hidden
                        className="bg-border absolute top-5 bottom-0 w-px"
                      />
                    )}
                    <span
                      className={cn(
                        "relative z-10 mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border text-[0.625rem] font-medium transition-colors",
                        filledSlot
                          ? "border-primary bg-primary text-primary-foreground"
                          : open
                            ? "border-primary bg-background text-primary"
                            : "border-border bg-background text-muted-foreground/70",
                      )}
                    >
                      {filledSlot ? (
                        <CheckIcon className="size-3" />
                      ) : (
                        index + 1
                      )}
                    </span>
                  </div>

                  <div
                    className={cn(
                      "min-w-0",
                      index < COACH_DIMENSIONS.length - 1 && "pb-3",
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(dimension)}
                      className="flex w-full items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm leading-[1.125rem] font-medium",
                          open || !filledSlot
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {t(`materials.coach.dimensions.${dimension}`)}
                      </span>
                      {filledSlot && (
                        <span
                          className={cn(
                            "mt-px shrink-0 text-[0.6875rem] leading-4",
                            slot.applied
                              ? "text-muted-foreground/70"
                              : "text-primary",
                          )}
                        >
                          {slot.applied
                            ? t("materials.coach.written")
                            : t("materials.coach.pendingWrite")}
                        </span>
                      )}
                    </button>

                    {open ? (
                      <div className="animate-in fade-in-0 grid gap-2 pt-2 duration-150">
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {slot?.q}
                        </p>
                        <Textarea
                          autoFocus
                          value={draft}
                          disabled={busy || saving !== null}
                          placeholder={t("materials.coach.placeholder")}
                          className="field-sizing-fixed h-20 resize-y text-sm"
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (
                              (event.metaKey || event.ctrlKey) &&
                              event.key === "Enter"
                            ) {
                              event.preventDefault();
                              void save(dimension);
                            }
                          }}
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          {filledSlot && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={saving !== null}
                              onClick={() => {
                                setActive(null);
                                setDraft("");
                              }}
                            >
                              {t("materials.coach.cancel")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            disabled={
                              busy ||
                              saving !== null ||
                              !draft.trim() ||
                              draft.trim() === (slot?.a ?? "")
                            }
                            onClick={() => void save(dimension)}
                          >
                            {saving === dimension && (
                              <Spinner className="size-3" />
                            )}
                            {t("materials.coach.save")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p
                        className={cn(
                          "mt-1 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap",
                          filledSlot
                            ? "text-muted-foreground/80"
                            : "text-muted-foreground",
                        )}
                      >
                        {filledSlot ? slot.a : slot?.q}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : error ? (
          <div className="grid justify-start gap-2 pt-1">
            <p className="text-destructive text-xs leading-relaxed">{error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                requested.current.delete(slug);
                setError(null);
                setStarted(true);
                setRetryToken((token) => token + 1);
              }}
            >
              {t("materials.retry")}
            </Button>
          </div>
        ) : (
          <div className="grid justify-start gap-2 pt-1">
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("materials.coach.startHint")}
            </p>
            <Button size="sm" disabled={busy} onClick={() => setStarted(true)}>
              {t("materials.coach.start")}
            </Button>
          </div>
        )}

        {filled === total && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <CheckIcon className="text-primary size-3.5" />
            {pending > 0
              ? t("materials.coach.allFilled")
              : t("materials.coach.allWritten")}
          </p>
        )}

        {error && questionsReady && (
          <p className="text-destructive text-xs leading-relaxed">{error}</p>
        )}
      </div>
    </ConsolePanel>
  );
}
