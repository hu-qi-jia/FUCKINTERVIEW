"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { TextInputView } from "@/components/pipecat/text-input";
import {
  ConsolePanel,
  ConsolePanelActions,
  ConsolePanelHeader,
  ConsolePanelTitle,
} from "@/components/pipecat/console/panel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  coachApply,
  coachReply,
  type CardProposal,
  type CoachIntent,
  type CoachMessage,
  type InterviewProfile,
  type ProfilePatch,
} from "@/lib/materials";
import { cn } from "@/lib/utils";

type QueueEntry = { message: CoachMessage; intent?: CoachIntent };

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
  const progress = profile.coachProgress ?? { percent: 0, remaining: [] };
  const readyCards = profile.cards.filter((card) => card.status === "ready");

  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposal, setProposal] = useState<CardProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // 发送是排队处理的：AI 还在回复时再发一条不会被丢掉，回复到了再按顺序处理。
  const sendingRef = useRef(false);
  const queueRef = useRef<QueueEntry[]>([]);
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  const findIndex = (list: CoachMessage[], message: CoachMessage) => {
    for (let index = 0; index < list.length; index += 1) {
      if (
        list[index].role === message.role &&
        list[index].content === message.content
      ) {
        return index;
      }
    }
    return -1;
  };

  const pump = async () => {
    if (sendingRef.current) return;
    const entry = queueRef.current.shift();
    if (!entry) return;
    const { message, intent } = entry;
    sendingRef.current = true;
    setSending(true);
    setError(null);

    const current = messagesRef.current;
    const index = findIndex(current, message);
    const history =
      index >= 0 ? current.slice(0, index + 1) : [...current, message];

    try {
      const result = await coachReply(profile.id, history, intent);
      if (!aliveRef.current) return;
      const after = messagesRef.current;
      const at = findIndex(after, message);
      const next = [...after];
      next.splice(at >= 0 ? at + 1 : next.length, 0, {
        role: "assistant",
        content: result.reply,
      });
      onPatch({
        coachChat: next,
        coachCoverage: result.coverage,
        coachProgress: {
          percent: result.percent,
          remaining: result.remaining,
        },
      });
    } catch (cause) {
      if (aliveRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      sendingRef.current = false;
      if (aliveRef.current) {
        setSending(false);
        void pump();
      }
    }
  };

  const openSession = async (intent?: CoachIntent) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const history = intent === "resume" ? messagesRef.current : [];
      const result = await coachReply(profile.id, history, intent);
      if (!aliveRef.current) return;
      onPatch({
        coachChat: [
          ...messagesRef.current,
          { role: "assistant", content: result.reply },
        ],
        coachCoverage: result.coverage,
        coachProgress: {
          percent: result.percent,
          remaining: result.remaining,
        },
      });
    } catch (cause) {
      if (aliveRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      sendingRef.current = false;
      if (aliveRef.current) {
        setSending(false);
        void pump();
      }
    }
  };

  const start = () => {
    setOpen(true);
    setProposal(null);
    // 有历史时让 AI 先回看对话，再接着问下一个问题；没有历史就从头开始。
    void openSession(messagesRef.current.length > 0 ? "resume" : undefined);
  };

  const enqueue = (text: string, intent?: CoachIntent) => {
    const message: CoachMessage = { role: "user", content: text };
    queueRef.current.push({ message, intent });
    onPatch({ coachChat: [...messagesRef.current, message] });
    void pump();
  };

  const handleSend = async (text: string) => {
    enqueue(text);
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
      <ConsolePanel className="mt-6 h-auto">
        <ConsolePanelHeader>
          <ConsolePanelTitle>{t("materials.coach.title")}</ConsolePanelTitle>
          <ConsolePanelActions>
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
          </ConsolePanelActions>
        </ConsolePanelHeader>
        <p className="text-muted-foreground px-(--card-spacing) text-xs">
          {readyCards.length > 0
            ? t("materials.coach.hint")
            : t("materials.coach.needCards")}
        </p>
      </ConsolePanel>
    );
  }

  return (
    <ConsolePanel className="mt-6 h-auto">
      <ConsolePanelHeader>
        <ConsolePanelTitle>{t("materials.coach.title")}</ConsolePanelTitle>
        <ConsolePanelActions>
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
        </ConsolePanelActions>
      </ConsolePanelHeader>

      <div className="grid gap-1 px-(--card-spacing)">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="shrink-0">
            {t("materials.coach.progress", { percent: progress.percent })}
          </span>
          <div className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
        {progress.remaining.length > 0 && (
          <p className="text-muted-foreground truncate text-xs">
            {t("materials.coach.remaining", {
              items: progress.remaining.join("、"),
            })}
          </p>
        )}
      </div>

      <div className="px-(--card-spacing)">
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
      </div>

      {proposal && (
        <div className="px-(--card-spacing)">
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
        </div>
      )}

      <div className="border-t p-(--card-spacing)">
        <TextInputView
          multiline
          placeholder={t("materials.coach.placeholder")}
          aria-label={t("materials.coach.placeholder")}
          disabled={Boolean(proposal)}
          onSend={handleSend}
        />
      </div>

      {error && (
        <p className="text-destructive px-(--card-spacing) text-xs">{error}</p>
      )}
    </ConsolePanel>
  );
}
