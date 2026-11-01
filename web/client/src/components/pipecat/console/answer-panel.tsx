"use client";

import { RTVIEvent } from "@pipecat-ai/client-js";
import type { ConversationMessage } from "@pipecat-ai/client-react";
import {
  usePipecatConversation,
  useRTVIClientEvent,
} from "@pipecat-ai/client-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  ConsolePanel,
  ConsolePanelActions,
  ConsolePanelContent,
} from "@/components/pipecat/console/panel";
import { TextRenderModeSelect } from "@/components/pipecat/console/text-render-mode-select";
import {
  Conversation,
  type ConversationProps,
} from "@/components/pipecat/conversation";
import { conversationMessageText } from "@/components/pipecat/conversation-message";
import type { TextRenderMode } from "@/components/pipecat/conversation-message";

/** The bot's own turns only; that is the answer being read out. */
const ANSWER_ROLES: ConversationMessage["role"][] = ["assistant"];

export interface ConsoleAnswerPanelProps {
  /** Seeds (and can push) the transcript render mode. Default "karaoke". */
  textRenderMode?: TextRenderMode;
  /** Fired when the user picks a render mode in the header. */
  onTextRenderModeChange?: (mode: TextRenderMode) => void;
  /** Hides the render-mode select in the header. Default false. */
  noTextRenderModeSwitch?: boolean;
  /** Overrides merged onto the Conversation (labels, renderers, …). */
  conversationProps?: Partial<ConversationProps>;
  className?: string;
}

/**
 * Console answer pane: the assistant's messages only, in the same window
 * chrome as the transcript pane. Must be rendered inside a
 * PipecatClientProvider.
 */
export function ConsoleAnswerPanel({
  textRenderMode,
  onTextRenderModeChange,
  noTextRenderModeSwitch = false,
  conversationProps,
  className,
}: ConsoleAnswerPanelProps) {
  const { t } = useTranslation();
  const [renderMode, setRenderMode] = React.useState<TextRenderMode>(
    textRenderMode ?? "karaoke",
  );

  // 回答在写完之前由这里自己显示：SDK 的正式消息按句到（还要等朗读），
  // 这里用 bot-llm-text 的逐 token 事件拼出「正在写」的全文。
  // 正式消息追上来了再把显示权交还给它（对得上的判断看前 24 个字）。
  const { messages } = usePipecatConversation();
  const assistantCount = messages.filter(
    (message) => message.role === "assistant",
  ).length;
  const assistantCountRef = React.useRef(assistantCount);
  assistantCountRef.current = assistantCount;

  const [stream, setStream] = React.useState("");
  const [streamOpen, setStreamOpen] = React.useState(false);
  // 从第几条 assistant 消息开始藏（streamCut 为 null 时全部显示）。
  const [streamCut, setStreamCut] = React.useState<number | null>(null);

  useRTVIClientEvent(RTVIEvent.BotLlmStarted, () => {
    setStream("");
    setStreamOpen(true);
    setStreamCut(assistantCountRef.current);
  });
  useRTVIClientEvent(RTVIEvent.BotLlmText, (data) => {
    const text = (data as { text?: string } | null)?.text ?? "";
    if (text) setStream((previous) => previous + text);
  });
  useRTVIClientEvent(RTVIEvent.BotLlmStopped, () => setStreamOpen(false));

  const compact = (value: string) => value.replace(/\s+/g, "");
  const lastAssistantText = React.useMemo(() => {
    const last = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    return last ? conversationMessageText(last) : "";
  }, [messages]);

  // 正式消息追上流式文本后，把显示权交还给它。
  // 必须等它至少一样长再换，否则会看到文字先缩回去再一句句长出来。
  React.useEffect(() => {
    if (streamOpen || !stream) return;
    const streamText = compact(stream);
    const finalText = compact(lastAssistantText);
    const head = streamText.slice(0, 12);
    if (
      head &&
      finalText.includes(head) &&
      finalText.length >= streamText.length
    ) {
      setStream("");
      setStreamCut(null);
    }
  }, [streamOpen, stream, lastAssistantText]);

  // 这一轮什么都没有（比如被中断）：别再藏着正式消息。
  React.useEffect(() => {
    if (streamOpen || stream || streamCut === null) return;
    const timer = window.setTimeout(() => setStreamCut(null), 800);
    return () => window.clearTimeout(timer);
  }, [streamOpen, stream, streamCut]);

  const visibleMessages = React.useMemo(() => {
    let seen = -1;
    return messages.filter((message) => {
      if (message.role !== "assistant") return false;
      seen += 1;
      return streamCut === null || seen < streamCut;
    });
  }, [messages, streamCut]);

  const pendingText = streamCut !== null && stream ? stream : undefined;

  React.useEffect(() => {
    if (textRenderMode !== undefined) setRenderMode(textRenderMode);
  }, [textRenderMode]);

  const handleRenderMode = (mode: TextRenderMode) => {
    setRenderMode(mode);
    onTextRenderModeChange?.(mode);
  };

  return (
    <ConsolePanel
      className={className}
      data-slot="console-answer-panel"
      data-state="expanded"
    >
      <div className="flex items-center gap-2 border-b px-(--card-spacing) pb-(--card-spacing)">
        <span className="text-sm font-medium">{t("conversation.answer")}</span>
        {!noTextRenderModeSwitch && (
          <ConsolePanelActions className="ml-auto">
            <TextRenderModeSelect
              value={renderMode}
              onValueChange={handleRenderMode}
            />
          </ConsolePanelActions>
        )}
      </div>
      <ConsolePanelContent scroll={false}>
        <Conversation
          roles={ANSWER_ROLES}
          showRole={false}
          textRenderMode={renderMode}
          empty={
            <div className="text-muted-foreground text-sm">
              {t("conversation.waitingAnswer")}
            </div>
          }
          {...conversationProps}
          messages={visibleMessages}
          pendingText={pendingText}
        />
      </ConsolePanelContent>
    </ConsolePanel>
  );
}
