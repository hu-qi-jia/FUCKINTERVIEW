"use client";

import { RTVIEvent } from "@pipecat-ai/client-js";
import type { ConversationMessage } from "@pipecat-ai/client-react";
import { useRTVIClientEvent } from "@pipecat-ai/client-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  ConsolePanel,
  ConsolePanelContent,
} from "@/components/pipecat/console/panel";
import {
  Conversation,
  type ConversationProps,
} from "@/components/pipecat/conversation";

/** The bot's own turns only; that is the answer being read out. */
const ANSWER_ROLES: ConversationMessage["role"][] = ["assistant"];

/** 一轮回答：从 bot-llm-started 到 bot-llm-stopped。 */
interface AnswerTurn {
  id: string;
  text: string;
  createdAt: string;
  final: boolean;
}

export interface ConsoleAnswerPanelProps {
  /** Overrides merged onto the Conversation (labels, renderers, …). */
  conversationProps?: Partial<ConversationProps>;
  className?: string;
}

/**
 * Console answer pane: the assistant's messages only, in the same window
 * chrome as the transcript pane. Must be rendered inside a
 * PipecatClientProvider.
 *
 * 回答列表由这里自己攒：没有 TTS 时 RTVI 拿不到「说完了」的边界，SDK 会把
 * 后面几轮回答都并回同一个 assistant 消息里；按 bot-llm-started/stopped
 * 切分就能一轮一条。
 */
export function ConsoleAnswerPanel({
  conversationProps,
  className,
}: ConsoleAnswerPanelProps) {
  const { t } = useTranslation();
  const [turns, setTurns] = React.useState<AnswerTurn[]>([]);

  // 重新连上就从头记。
  useRTVIClientEvent(RTVIEvent.BotReady, () => setTurns([]));

  useRTVIClientEvent(RTVIEvent.BotLlmStarted, () =>
    setTurns((previous) => [
      ...previous,
      {
        id: `turn-${Date.now()}-${previous.length}`,
        text: "",
        createdAt: new Date().toISOString(),
        final: false,
      },
    ])
  );

  useRTVIClientEvent(RTVIEvent.BotLlmText, (data) => {
    const chunk = (data as { text?: string } | null)?.text ?? "";
    if (!chunk) return;
    setTurns((previous) => {
      const last = previous[previous.length - 1];
      if (!last) {
        return [
          {
            id: `turn-${Date.now()}-0`,
            text: chunk,
            createdAt: new Date().toISOString(),
            final: false,
          },
        ];
      }
      return [
        ...previous.slice(0, -1),
        { ...last, text: last.text + chunk },
      ];
    });
  });

  useRTVIClientEvent(RTVIEvent.BotLlmStopped, () =>
    setTurns((previous) =>
      previous.length === 0
        ? previous
        : [
            ...previous.slice(0, -1),
            { ...previous[previous.length - 1], final: true },
          ]
    )
  );

  const messages = React.useMemo<ConversationMessage[]>(
    () =>
      turns
        .filter((turn) => turn.text.trim())
        .map((turn) => ({
          role: "assistant" as const,
          final: turn.final,
          createdAt: turn.createdAt,
          parts: [
            {
              text: { spoken: turn.text, unspoken: "" },
              final: turn.final,
              createdAt: turn.createdAt,
              aggregatedBy: "sentence",
            },
          ],
        })),
    [turns]
  );

  return (
    <ConsolePanel
      className={className}
      data-slot="console-answer-panel"
      data-state="expanded"
    >
      <div className="flex items-center gap-2 border-b px-(--card-spacing) pb-(--card-spacing)">
        <span className="text-sm font-medium">{t("conversation.answer")}</span>
      </div>
      <ConsolePanelContent scroll={false}>
        <Conversation
          roles={ANSWER_ROLES}
          showRole={false}
          empty={
            <div className="text-muted-foreground text-sm">
              {t("conversation.waitingAnswer")}
            </div>
          }
          {...conversationProps}
          messages={messages}
        />
      </ConsolePanelContent>
    </ConsolePanel>
  );
}
