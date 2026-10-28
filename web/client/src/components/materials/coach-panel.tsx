"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
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
  const [input, setInput] = useState("");
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

  const send = () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: CoachMessage[] = [
      ...messagesRef.current,
      { role: "user", content: text },
    ];
    onPatch({ coachChat: next });
    setInput("");
    void ask(next);
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

  return (
    <section className="border-border/70 mt-6 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("materials.coach.title")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("materials.coach.hint")}
          </p>
        </div>
        {open ? (
          <div className="flex items-center gap-1.5">
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
        ) : (
          <Button
            size="sm"
            disabled={busy || readyCards.length === 0}
            onClick={start}
          >
            {t("materials.coach.start")}
          </Button>
        )}
      </div>

      {!open && readyCards.length === 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          {t("materials.coach.needCards")}
        </p>
      )}

      {open && (
        <div className="mt-3 grid gap-2">
          <ScrollArea
            className="h-72 rounded-lg border bg-muted/20"
            viewportRef={viewportRef}
          >
            <div className="flex flex-col gap-2 p-3">
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
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Spinner className="size-3.5" />
                  {t("materials.coach.thinking")}
                </div>
              )}
            </div>
          </ScrollArea>

          {proposal && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
              <span className="min-w-0 flex-1">
                {t("materials.coach.confirm", { count: proposal.length })}
              </span>
              <Button size="xs" onClick={confirmApply}>
                {t("materials.coach.confirmApply")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setProposal(null)}
              >
                {t("materials.coach.cancel")}
              </Button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              rows={2}
              placeholder={t("materials.coach.placeholder")}
              className="field-sizing-fixed h-16 resize-none"
              disabled={sending || Boolean(proposal)}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                if (event.nativeEvent.isComposing) return;
                event.preventDefault();
                send();
              }}
            />
            <Button
              size="sm"
              disabled={sending || !input.trim() || Boolean(proposal)}
              onClick={send}
            >
              {t("materials.coach.send")}
            </Button>
          </div>

          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      )}
    </section>
  );
}
