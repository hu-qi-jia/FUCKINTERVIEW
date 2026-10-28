"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { TextInputView } from "@/components/pipecat/text-input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  coachApply,
  coachReply,
  type CardProposal,
  type CoachMessage,
  type InterviewProfile,
  type ProfilePatch,
} from "@/lib/materials";
import { cn } from "@/lib/utils";

/**
 * 「和 AI 完善面试档案」：AI 像 grilling 一样一次问一个细节，
 * 聊完把新确认的事实整理成卡片更新，确认后写回经历卡。
 * 布局跟实时面试的对话栏一致：标题行 + 消息流 + 底部输入条。
 */
export function CoachPanel({
  profile,
  busy,
  onPatch,
}: {
  profile: InterviewProfile;
  busy: boolean;
  onPatch: (patch: ProfilePatch) => void;
}) {
  const { t } = useTranslation();
  const messages = profile.coachChat ?? [];
  const readyCards = profile.cards.filter((card) => card.status === "ready");

  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposal, setProposal] = useState<CardProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const ask = async (history: CoachMessage[]) => {
    setSending(true);
    setError(null);
    try {
      const reply = await coachReply(profile.id, history);
      onPatch({
        coachChat: [...history, { role: "assistant", content: reply }],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const start = () => {
    setOpen(true);
    setProposal(null);
    if (messagesRef.current.length === 0) void ask([]);
  };

  const handleSend = async (text: string) => {
    const next: CoachMessage[] = [
      ...messagesRef.current,
      { role: "user", content: text },
    ];
    onPatch({ coachChat: next });
    await ask(next);
  };

  const prepareApply = async () => {
    if (applying) return;
    setApplying(true);
    setError(null);
    try {
      const cards = await coachApply(profile.id, messagesRef.current);
      if (cards.length === 0) {
        setError(t("materials.coach.noChanges"));
        return;
      }
      setProposal(cards);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  };

  const confirmApply = () => {
    if (!proposal) return;
    const nextCards = profile.cards.map((card) => {
      const update = proposal.find((item) => item.slug === card.slug);
      return update
        ? {
            ...card,
            ...update,
            status: "ready" as const,
            error: null,
            sourceRevision: profile.materialsRevision,
          }
        : card;
    });
    onPatch({
      cards: nextCards,
      coachChat: [
        ...messages,
        {
          role: "assistant",
          content: t("materials.coach.applied", { count: proposal.length }),
        },
      ],
    });
    setProposal(null);
  };

  useEffect(() => {
    const element = viewportRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, sending, open]);

  if (!open) {
    return (
      <section className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("materials.coach.title")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {readyCards.length > 0
              ? t("materials.coach.hint")
              : t("materials.coach.needCards")}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || readyCards.length === 0}
          onClick={start}
        >
          {messages.length > 0
            ? t("materials.coach.resume")
            : t("materials.coach.start")}
        </Button>
      </section>
    );
  }

  return (
    <section className="mt-6 grid gap-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t("materials.coach.title")}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={sending || applying || messages.length === 0}
            onClick={() => void prepareApply()}
          >
            {applying && <Spinner className="size-3.5" />}
            {t("materials.coach.update")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t("materials.coach.close")}
          </Button>
        </div>
      </div>

      <ScrollArea className="max-h-80" viewportRef={viewportRef}>
        <div className="flex flex-col gap-2 pb-1">
          {messages.map((message, index) => (
            <div
              key={`${index}-${message.role}`}
              className={cn(
                "flex",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted rounded-tl-sm",
                )}
              >
                {message.content}
              </div>
            </div>
          ))}
          {sending && (
            <p className="text-muted-foreground text-xs">
              {t("materials.coach.thinking")}
            </p>
          )}
        </div>
      </ScrollArea>

      {proposal && (
        <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            {t("materials.coach.confirm", { count: proposal.length })}
          </span>
          <Button size="xs" onClick={confirmApply}>
            {t("materials.coach.confirmApply")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setProposal(null)}>
            {t("materials.coach.cancel")}
          </Button>
        </div>
      )}

      <TextInputView
        multiline
        placeholder={t("materials.coach.placeholder")}
        aria-label={t("materials.coach.placeholder")}
        disabled={Boolean(proposal)}
        onSend={handleSend}
      />

      {error && <p className="text-destructive text-xs">{error}</p>}
    </section>
  );
}
