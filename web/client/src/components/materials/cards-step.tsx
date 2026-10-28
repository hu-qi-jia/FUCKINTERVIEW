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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  CARD_BODY_KEYS,
  CARDS_MAX,
  emptyCard,
  generateSkill,
  isCardStale,
  planSkills,
  sortCards,
  type CardBodyKey,
  type ExperienceCard,
  type InterviewProfile,
  type ProfilePatch,
} from "@/lib/materials";
import { cn } from "@/lib/utils";

type Phase = "idle" | "planning" | "generating";

const BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-none";

function randomSlug(): string {
  return `manual-${Math.random().toString(36).slice(2, 10)}`;
}

export function CardsStep({
  profile,
  busy,
  onPatch,
  onReplace,
  onApplyCard,
  onFlush,
  onBusyChange,
}: {
  profile: InterviewProfile;
  busy: boolean;
  onPatch: (patch: ProfilePatch) => void;
  onReplace: (profile: InterviewProfile) => void;
  onApplyCard: (card: ExperienceCard) => void;
  onFlush: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState<{
    slug: string;
    index: number;
    total: number;
  } | null>(null);
  const [multiRun, setMultiRun] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopRef = useRef(false);
  const cards = useMemo(() => sortCards(profile.cards), [profile.cards]);
  const pending = cards.filter((card) => card.status === "pending");
  const hasReady = cards.some((card) => card.status === "ready");
  const stale = cards.some((card) => isCardStale(card, profile.materialsRevision));
  const running = phase === "generating";
  const locked = busy || running || phase === "planning";
  const hasMaterials =
    Boolean(profile.resume.content.trim()) &&
    Boolean(profile.jobDescription.content.trim());

  // 新计划到达时默认全选。
  useEffect(() => {
    setSelected(new Set(pending.map((card) => card.slug)));
    // 只在待生成集合变化时重置，避免覆盖用户的勾选。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.map((card) => card.slug).join("|")]);

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

  const startPlan = useCallback(async () => {
    if (!hasMaterials || locked) return;
    setPhase("planning");
    setError(null);
    onBusyChange(true);
    try {
      const next = await planSkills(profile.id);
      onReplace(next);
      setCurrent(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPhase("idle");
      onBusyChange(false);
    }
  }, [hasMaterials, locked, onBusyChange, onReplace, profile.id]);

  const runGeneration = useCallback(
    async (slugs: string[], dropped: string[]) => {
      if (slugs.length === 0) return;
      stopRef.current = false;
      setStopping(false);
      setMultiRun(true);
      setError(null);
      setPhase("generating");
      onBusyChange(true);

      if (dropped.length > 0) {
        onPatch({
          cards: cards.filter((card) => !dropped.includes(card.slug)),
        });
        await onFlush();
      }

      try {
        for (const [index, slug] of slugs.entries()) {
          if (stopRef.current) break;
          setCurrent({ slug, index, total: slugs.length });
          const source = cards.find((card) => card.slug === slug);
          try {
            const card = await generateSkill(profile.id, slug);
            onApplyCard(card);
          } catch (cause) {
            if (!source) continue;
            onApplyCard({
              ...source,
              status: "failed",
              error: cause instanceof Error ? cause.message : String(cause),
            });
          }
        }
      } finally {
        setCurrent(null);
        setStopping(false);
        setMultiRun(false);
        setPhase("idle");
        onBusyChange(false);
      }
    },
    [cards, onApplyCard, onBusyChange, onFlush, onPatch, profile.id],
  );

  const startGeneration = useCallback(() => {
    const chosen = pending.filter((card) => selected.has(card.slug));
    const dropped = pending
      .filter((card) => !selected.has(card.slug))
      .map((card) => card.slug);
    void runGeneration(
      chosen.map((card) => card.slug),
      dropped,
    );
  }, [pending, runGeneration, selected]);

  const regenerateCard = useCallback(
    async (slug: string) => {
      if (locked) return;
      setError(null);
      setPhase("generating");
      onBusyChange(true);
      setCurrent({ slug, index: 0, total: 1 });
      const source = cards.find((card) => card.slug === slug);
      try {
        const card = await generateSkill(profile.id, slug);
        onApplyCard(card);
      } catch (cause) {
        if (source) {
          onApplyCard({
            ...source,
            status: "failed",
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      } finally {
        setCurrent(null);
        setPhase("idle");
        onBusyChange(false);
      }
    },
    [cards, locked, onApplyCard, onBusyChange, profile.id],
  );

  const cancelPlan = useCallback(() => {
    onPatch({ cards: cards.filter((card) => card.status !== "pending") });
  }, [cards, onPatch]);

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

  const currentCard =
    current && cards.find((card) => card.slug === current.slug);
  const listed = cards.filter(
    (card) => !(card.status === "pending" && !running),
  );

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
            onConfirm={() => void startPlan()}
          />
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={locked || !hasMaterials}
            onClick={() => void startPlan()}
          >
            {phase === "planning" ? <Spinner className="size-3.5" /> : null}
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
            onClick={() => void startPlan()}
          >
            {t("materials.cards.regenerate")}
          </Button>
        </div>
      )}

      {phase === "planning" && (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Spinner className="size-3.5" />
          {t("materials.cards.planning")}
        </p>
      )}

      {running && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <Spinner className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">
            {current
              ? t("materials.cards.progress", {
                  current: Math.min(current.index + 1, current.total),
                  total: current.total,
                  name: currentCard?.name || t("materials.cards.untitled"),
                })
              : t("materials.cards.generating")}
          </span>
          {multiRun && (
            <Button
              size="xs"
              variant="outline"
              disabled={stopping}
              onClick={() => {
                stopRef.current = true;
                setStopping(true);
              }}
            >
              {stopping
                ? t("materials.cards.stopping")
                : t("materials.cards.stop")}
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

      {pending.length > 0 && !running && (
        <div className="grid gap-4 rounded-lg border border-dashed p-4">
          <p className="text-sm">
            {t("materials.cards.planTitle", { count: pending.length })}
          </p>
          <ul className="grid gap-3">
            {pending.map((card) => (
              <li key={card.slug} className="flex items-start gap-3">
                <Checkbox
                  aria-label={card.name}
                  className="mt-1"
                  checked={selected.has(card.slug)}
                  onCheckedChange={(checked) => {
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(card.slug);
                      else next.delete(card.slug);
                      return next;
                    });
                  }}
                />
                <div className="grid min-w-0 flex-1 gap-1">
                  <input
                    value={card.name}
                    aria-label={t("materials.cardFields.name")}
                    className="text-foreground -mx-1.5 h-7 w-[calc(100%+0.75rem)] min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                    onChange={(event) =>
                      updateCard(card.slug, { name: event.target.value })
                    }
                  />
                  {card.description && (
                    <p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
                      {card.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={selected.size === 0 || busy}
              onClick={startGeneration}
            >
              {hasReady
                ? t("materials.cards.continue")
                : t("materials.cards.start")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={cancelPlan}
            >
              {t("materials.cards.cancelPlan")}
            </Button>
          </div>
        </div>
      )}

      {cards.length === 0 && phase !== "planning" && (
        <p className="text-muted-foreground text-xs">
          {t("materials.cards.empty")}
        </p>
      )}

      <ul className="grid gap-2">
        {listed.map((card) => {
          const index = cards.findIndex((item) => item.slug === card.slug);
          const isPending = card.status === "pending";
          const isGenerating =
            card.status === "generating" ||
            (running && current?.slug === card.slug);
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
                          className={cn(
                            BADGE,
                            "bg-primary/10 text-primary",
                          )}
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
                        disabled={locked}
                        onClick={() => void regenerateCard(card.slug)}
                      >
                        <RefreshCwIcon />
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("materials.cards.deleteCard")}
                      disabled={locked}
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

                {(isPending || isGenerating) && (
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

                {isOpen && !isPending && !isGenerating && (
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
