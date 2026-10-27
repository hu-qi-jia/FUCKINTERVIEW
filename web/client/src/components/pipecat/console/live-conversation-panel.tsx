"use client";

import type { ConversationMessage } from "@pipecat-ai/client-react";
import {
  usePipecatClientTransportState,
  usePipecatConversation,
} from "@pipecat-ai/client-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { ConsolePanel } from "@/components/pipecat/console/panel";
import { TextInput } from "@/components/pipecat/text-input";
import type { LiveMessage } from "@/lib/live-message";
import { cn } from "@/lib/utils";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function messageText(message: ConversationMessage): string {
  return message.parts.map((part) => part.text).join("");
}

function timeLabel(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : timeFormatter.format(date);
}

interface RenderedLine {
  id: string;
  text: string;
  createdAt: string;
  from: "interviewer" | "candidate";
}

export interface LiveConversationPanelProps {
  /** The candidate's lines, collected from the microphone session. */
  extraMessages?: LiveMessage[];
  /** In-flight candidate transcript, shown dimmed until it is final. */
  interimText?: string;
  noTextInput?: boolean;
  className?: string;
}

/**
 * Live-interview transcript: the interviewer's questions as left bubbles,
 * the candidate's own speech as plain right-aligned text. Assistant output
 * lives in the answer pane, so it is filtered out here.
 */
export function LiveConversationPanel({
  extraMessages = [],
  interimText,
  noTextInput = false,
  className,
}: LiveConversationPanelProps) {
  const { t } = useTranslation();
  const transportState = usePipecatClientTransportState();
  const { messages } = usePipecatConversation();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  const lines = React.useMemo<RenderedLine[]>(() => {
    const interviewer: RenderedLine[] = messages
      .filter((message) => message.role === "user")
      .map((message, index) => ({
        id: `interviewer-${message.createdAt}-${index}`,
        text: messageText(message),
        createdAt: message.createdAt,
        from: "interviewer",
      }));
    const candidate: RenderedLine[] = extraMessages.map((message) => ({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
      from: "candidate",
    }));
    return [...interviewer, ...candidate].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
  }, [messages, extraMessages]);

  const hasContent = lines.length > 0 || Boolean(interimText);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [lines, interimText]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distance <= 24;
  };

  const isConnecting =
    transportState === "authenticating" || transportState === "connecting";
  const isConnected =
    transportState === "connected" || transportState === "ready";

  return (
    <ConsolePanel className={className} data-slot="live-conversation-panel">
      <div className="flex items-center gap-2 border-b px-(--card-spacing) pb-(--card-spacing)">
        <span className="text-sm font-medium">{t("conversation.title")}</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {!hasContent ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="text-muted-foreground max-w-md text-sm">
              {isConnecting
                ? t("conversation.connecting")
                : isConnected
                  ? t("conversation.waiting")
                  : t("conversation.connectHint")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {lines.map((line) => (
              <div
                key={line.id}
                className={cn(
                  "flex flex-col gap-1",
                  line.from === "interviewer" ? "items-start" : "items-end",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap",
                    line.from === "interviewer"
                      ? "bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-sm"
                      : "text-right text-sm",
                  )}
                >
                  {line.text}
                </div>
                <span className="text-muted-foreground text-[11px]">
                  {timeLabel(line.createdAt)}
                </span>
              </div>
            ))}
            {interimText && (
              <div className="flex flex-col items-end gap-1">
                <div className="text-muted-foreground max-w-[85%] text-right text-sm whitespace-pre-wrap opacity-70">
                  {interimText}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!noTextInput && (
        <div className="border-t p-(--card-spacing)">
          <TextInput />
        </div>
      )}
    </ConsolePanel>
  );
}
