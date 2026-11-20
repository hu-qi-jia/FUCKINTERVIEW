"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { InlineConfirmButton } from "@/components/materials/inline-confirm-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  CARD_BODY_KEYS,
  CARDS_MAX,
  emptyCard,
  generateSkillStream,
  isCardStale,
  planSkillsStream,
  sortCards,
  type CardBodyKey,
  type CardPatch,
  type ExperienceCard,
  type InterviewProfile,
  type ProfilePatch,
} from "@/lib/materials";
import { isAbortError, newTraceId } from "@/lib/http";
import { cn } from "@/lib/utils";

type Phase = "idle" | "planning" | "generating";

/**
 * 并发生成的上限。
 *
 * 每张卡是一次独立的 LLM 调用，互不依赖，所以并行就是把墙钟时间除以并发数。
 * 4 是个折中：再高容易撞上服务商的并发/限流，再低就白瞎了并行。
 */
const GENERATION_CONCURRENCY = 4;

const BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-none";

function randomSlug(): string {
  return `manual-${Math.random().toString(36).slice(2, 10)}`;
}

export function CardsStep({
  profile,
  busy,
  onPatch,
  onApplyCard,
  onFlush,
  onBusyChange,
}: {
  profile: InterviewProfile;
  busy: boolean;
  onPatch: (patch: ProfilePatch) => void;
  onReplace: (profile: InterviewProfile) => void;
  onApplyCard: (card: CardPatch, dropAi?: boolean) => void;
  onFlush: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({
    planned: 0,
    done: 0,
    failed: 0,
  });
  const [runningSlugs, setRunningSlugs] = useState<Set<string>>(new Set());
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  // 生成是并发的：拿最新 cards 不能依赖闭包里的那份快照。
  const cardsRef = useRef<ExperienceCard[]>(profile.cards);
  cardsRef.current = profile.cards;

  const cards = useMemo(() => sortCards(profile.cards), [profile.cards]);
  const pending = cards.filter((card) => card.status === "pending");
  const stale = cards.some((card) => isCardStale(card, profile.materialsRevision));
  const running = phase !== "idle";
  const locked = busy || running;
  const hasMaterials =
    Boolean(profile.resume.content.trim()) &&
    Boolean(profile.jobDescription.content.trim());

  // 组件卸载时把在跑的请求掐了，别让流挂在后台。
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const updateCard = useCallback(
    (slug: string, fields: Partial<ExperienceCard>) => {
      onPatch({
        cards: cards.map((card) =>
          card.slug === slug ? { ...card, ...fields } : card,
        ),
      });
    },
    [cards, onPatch],
  );

  /** 跑一张卡：字段到一个显示一个，出错只影响这一张。 */
  const runOne = useCallback(
    async (slug: string, signal: AbortSignal, trace: string) => {
      setRunningSlugs((previous) => new Set(previous).add(slug));
      try {
        for await (const event of generateSkillStream(profile.id, slug, {
          trace,
          signal,
        })) {
          if (event.type === "field") {
            if (event.key === "name" || event.key === "description") {
              onApplyCard({ slug, [event.key]: event.value });
            } else {
              onApplyCard({
                slug,
                body: {
                  [event.key]: event.value,
                } as Partial<Record<CardBodyKey, string>>,
              });
            }
          } else if (event.type === "done") {
            onApplyCard(event.card);
            setProgress((previous) => ({ ...previous, done: previous.done + 1 }));
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      } catch (cause) {
        // 取消不算失败：服务端已经把这张卡退回 pending，界面上看得见、点得动。
        if (isAbortError(cause)) return;
        setProgress((previous) => ({
          ...previous,
          failed: previous.failed + 1,
        }));
        onApplyCard({
          slug,
          status: "failed",
          error: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        setRunningSlugs((previous) => {
          const next = new Set(previous);
          next.delete(slug);
          return next;
        });
      }
    },
    [onApplyCard, profile.id],
  );

  /**
   * 一次完整跑：边规划边生成。
   *
   * 规划是流式的，出一个单元就落一张卡、立刻排进生成队列，
   * 不用等整个规划结束——这就是「正在分析简历…」那段死时间被吃掉的地方。
   *
   * 传 `slugs` 就跳过规划，只跑指定的卡（取消之后重新跑剩下的、或单张重试）。
   */
  const startRun = useCallback(
    async (only?: string[]) => {
      if (locked || (only ? only.length === 0 : !hasMaterials)) return;

      // 先把本地没落盘的编辑存掉，免得和流式写回来的卡打架。
      await onFlush();

      const trace = newTraceId();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setPhase(only ? "generating" : "planning");
      setProgress({
        planned: only ? only.length : 0,
        done: 0,
        failed: 0,
      });
      onBusyChange(true);

      const queue: string[] = [...(only ?? [])];
      let inflight = 0;
      let planDone = Boolean(only);
      let failure: string | null = null;
      // 服务端在第一个单元落地时才清掉旧的 AI 卡，本地同步在那一刻一起清。
      let dropAi = true;

      const settle = () => {
        if (!planDone || inflight > 0) return;
        abortRef.current = null;
        setPhase("idle");
        setStopping(false);
        onBusyChange(false);
        if (failure) setError(failure);
      };

      const pump = () => {
        while (inflight < GENERATION_CONCURRENCY && queue.length > 0) {
          const slug = queue.shift();
          if (!slug) break;
          inflight += 1;
          void runOne(slug, controller.signal, trace).finally(() => {
            inflight -= 1;
            pump();
          });
        }
        settle();
      };

      if (only) {
        pump();
        return;
      }

      try {
        for await (const event of planSkillsStream(profile.id, {
          trace,
          signal: controller.signal,
        })) {
          if (event.type === "unit") {
            onApplyCard(event.card, dropAi);
            dropAi = false;
            setProgress((previous) => ({
              ...previous,
              planned: previous.planned + 1,
            }));
            queue.push(event.card.slug);
            if (queue.length > GENERATION_CONCURRENCY) setPhase("generating");
            pump();
          } else if (event.type === "error") {
            failure = event.message;
            break;
          }
          // done 不需要动本地状态：每个 unit 事件已经把卡落进来了。
        }
      } catch (cause) {
        if (!isAbortError(cause)) {
          failure = cause instanceof Error ? cause.message : String(cause);
        }
      } finally {
        planDone = true;
        setPhase("generating");
        pump();
      }
    },
    [hasMaterials, locked, onBusyChange, onFlush, profile.id, runOne],
  );

  /** 真正的取消：掐掉在跑的请求，服务端把卡退回 pending。 */
  const stopRun = useCallback(() => {
    setStopping(true);
    abortRef.current?.abort();
  }, []);

  const regenerateCard = useCallback(
    async (slug: string) => {
      if (locked) return;
      const trace = newTraceId();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setPhase("generating");
      onBusyChange(true);
      try {
        await runOne(slug, controller.signal, trace);
      } finally {
        abortRef.current = null;
        setPhase("idle");
        onBusyChange(false);
      }
    },
    [locked, onBusyChange, runOne],
  );

  const addCard = useCallback(() => {
    if (cards.length >= CARDS_MAX || locked) return;
    const card = emptyCard(
      randomSlug(),
      t("materials.cards.newCardName"),
      profile.materialsRevision,
      cards.length,
    );
    onPatch({ cards: [...cards, card] });
    setExpanded((previous) => new Set(previous).add(card.slug));
  }, [cards, locked, onPatch, profile.materialsRevision, t]);

  const deleteCard = useCallback(
    (slug: string) => {
      onPatch({ cards: cards.filter((card) => card.slug !== slug) });
      setExpanded((previous) => {
        const next = new Set(previous);
        next.delete(slug);
        return next;
      });
    },
    [cards, onPatch],
  );

  const moveCard = useCallback(
    (slug: string, delta: number) => {
      const ordered = [...cards];
      const index = ordered.findIndex((card) => card.slug === slug);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      onPatch({
        cards: ordered.map((card, position) => ({ ...card, position })),
      });
    },
    [cards, onPatch],
  );

  const toggleExpanded = (slug: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          {t("materials.cards.count", {
            count: cards.length,
            max: CARDS_MAX,
          })}
        </span>
        <span className="min-w-0 flex-1" />
        {cards.length > 0 ? (
          <InlineConfirmButton
            size="sm"
            variant="outline"
            disabled={locked || !hasMaterials}
            label={t("materials.cards.regenerate")}
            confirmLabel={t("materials.cards.confirmRegenerate")}
            onConfirm={() => void startRun()}
          />
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={locked || !hasMaterials}
            onClick={() => void startRun()}
          >
            {running ? <Spinner className="size-3.5" /> : null}
            {t("materials.cards.generate")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || cards.length >= CARDS_MAX}
          onClick={addCard}
        >
          <PlusIcon className="size-3.5" />
          {t("materials.cards.manualAdd")}
        </Button>
      </div>

      {!hasMaterials && (
        <p className="text-muted-foreground text-xs">
          {t("materials.cards.needMaterials")}
        </p>
      )}

      {stale && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <span className="min-w-0 flex-1">{t("materials.cards.stale")}</span>
          <Button
            size="xs"
            variant="outline"
            disabled={locked || !hasMaterials}
            onClick={() => void startRun()}
          >
            {t("materials.cards.regenerate")}
          </Button>
        </div>
      )}

      {running && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <Spinner className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">
            {t("materials.cards.runProgress", {
              planned: progress.planned,
              done: progress.done,
              running: runningSlugs.size,
            })}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={stopping}
            onClick={stopRun}
          >
            {stopping ? t("materials.cards.stopping") : t("materials.cards.stop")}
          </Button>
        </div>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

      {pending.length > 0 && !running && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
          <span className="text-muted-foreground min-w-0 flex-1">
            {t("materials.cards.pendingLeft", { count: pending.length })}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={locked}
            onClick={() =>
              void startRun(pending.map((card) => card.slug))
            }
          >
            {t("materials.cards.generatePending")}
          </Button>
        </div>
      )}

      {cards.length === 0 && !running && (
        <p className="text-muted-foreground text-xs">
          {t("materials.cards.empty")}
        </p>
      )}

      <ul className="grid gap-2">
        {cards.map((card) => {
          const index = cards.findIndex((item) => item.slug === card.slug);
          const isPending = card.status === "pending";
          const isGenerating = runningSlugs.has(card.slug);
          const isOpen = expanded.has(card.slug);

          return (
            <li
              key={`${card.slug}-${card.status}`}
              className={cn(
                card.status === "ready" &&
                  "animate-in fade-in-0 slide-in-from-bottom-1 duration-300",
              )}
            >
              <Card
                size="sm"
                className={cn(
                  "gap-0 py-0",
                  card.status === "failed" && "ring-destructive/40",
                )}
              >
                <div className="flex items-start gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(card.slug)}
                    aria-expanded={isOpen}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {card.name || t("materials.cards.untitled")}
                      </span>
                      {card.source === "manual" && (
                        <span
                          className={cn(BADGE, "bg-muted text-muted-foreground")}
                        >
                          {t("materials.cards.manual")}
                        </span>
                      )}
                      {isPending && (
                        <span
                          className={cn(
                            BADGE,
                            "border border-dashed text-muted-foreground",
                          )}
                        >
                          {t("materials.cards.pending")}
                        </span>
                      )}
                      {isGenerating && (
                        <span
                          className={cn(BADGE, "bg-primary/10 text-primary")}
                        >
                          <Spinner className="size-3" />
                          {t("materials.cards.generating")}
                        </span>
                      )}
                      {card.status === "failed" && (
                        <span
                          className={cn(
                            BADGE,
                            "bg-destructive/10 text-destructive",
                          )}
                        >
                          {t("materials.cards.failedShort")}
                        </span>
                      )}
                      {isCardStale(card, profile.materialsRevision) && (
                        <span
                          className={cn(
                            BADGE,
                            "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                          )}
                        >
                          {t("materials.cards.staleBadge")}
                        </span>
                      )}
                    </div>
                    {card.description && (
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                        {card.description}
                      </p>
                    )}
                  </button>

                  <div className="flex shrink-0 items-center">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("materials.cards.moveUp")}
                      disabled={locked || index === 0}
                      onClick={() => moveCard(card.slug, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("materials.cards.moveDown")}
                      disabled={locked || index === cards.length - 1}
                      onClick={() => moveCard(card.slug, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    {card.source === "ai" && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("materials.cards.regenerateCard")}
                        disabled={locked || isGenerating}
                        onClick={() => void regenerateCard(card.slug)}
                      >
                        <RefreshCwIcon />
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("materials.cards.deleteCard")}
                      disabled={locked || isGenerating}
                      onClick={() => deleteCard(card.slug)}
                    >
                      <Trash2Icon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={
                        isOpen
                          ? t("materials.cards.collapse")
                          : t("materials.cards.expand")
                      }
                      onClick={() => toggleExpanded(card.slug)}
                    >
                      <ChevronDownIcon
                        className={cn(
                          "transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </Button>
                  </div>
                </div>

                {isGenerating && (
                  <div className="grid gap-2 border-t p-3">
                    <div className="bg-muted h-2.5 w-2/3 animate-pulse rounded" />
                    <div className="bg-muted h-2.5 w-full animate-pulse rounded" />
                    <div className="bg-muted h-2.5 w-5/6 animate-pulse rounded" />
                  </div>
                )}

                {card.status === "failed" && (
                  <div className="grid gap-2 border-t p-3">
                    <p className="text-destructive text-xs">
                      {t("materials.cards.failed", {
                        message: card.error || "",
                      })}
                    </p>
                    <Button
                      size="xs"
                      variant="outline"
                      className="w-fit"
                      disabled={locked}
                      onClick={() => void regenerateCard(card.slug)}
                    >
                      {t("materials.cards.retryCard")}
                    </Button>
                  </div>
                )}

                {isOpen && !isGenerating && (
                  <CardEditor
                    card={card}
                    disabled={locked}
                    onChange={(fields) => updateCard(card.slug, fields)}
                  />
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CardEditor({
  card,
  disabled,
  onChange,
}: {
  card: ExperienceCard;
  disabled: boolean;
  onChange: (fields: Partial<ExperienceCard>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 border-t p-3">
      <label className="grid gap-1">
        <span className="text-muted-foreground text-xs">
          {t("materials.cardFields.name")}
        </span>
        <Input
          value={card.name}
          disabled={disabled}
          className="h-8"
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground text-xs">
          {t("materials.cardFields.description")}
        </span>
        <Textarea
          value={card.description}
          disabled={disabled}
          rows={3}
          className="field-sizing-fixed h-20 resize-y"
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </label>
      {CARD_BODY_KEYS.map((key: CardBodyKey) => (
        <label key={key} className="grid gap-1">
          <span className="text-muted-foreground text-xs">
            {t(`materials.cardFields.${key}`)}
          </span>
          <Textarea
            value={card.body[key]}
            disabled={disabled}
            rows={4}
            className="field-sizing-fixed h-28 resize-y"
            onChange={(event) =>
              onChange({
                body: { ...card.body, [key]: event.target.value },
              })
            }
          />
        </label>
      ))}
    </div>
  );
}
