"use client";

import {
  usePipecatClientTransportState,
  usePipecatConversation,
  useRTVIClientEvent,
} from "@pipecat-ai/client-react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { ConsolePanel } from "@/components/pipecat/console/panel";
import { conversationMessageText } from "@/components/pipecat/conversation-message";
import { TextInput } from "@/components/pipecat/text-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LiveMessage } from "@/lib/live-message";
import { cn } from "@/lib/utils";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

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
  // 面试官那一路的转写：STT 的中间结果在说话过程中就会到，先按半透明气泡显示，
  // 最终稿到了再换成正式消息。
  const [interviewerInterim, setInterviewerInterim] = React.useState("");
  useRTVIClientEvent(RTVIEvent.UserTranscript, (data) => {
    const text = (data?.text ?? "").trim();
    setInterviewerInterim(data?.final ? "" : text);
  });
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  const lines = React.useMemo<RenderedLine[]>(() => {
    const interviewer: RenderedLine[] = messages
      .filter((message) => message.role === "user")
      .map((message, index) => ({
        id: `interviewer-${message.createdAt}-${index}`,
        text: conversationMessageText(message),
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

  const hasContent =
    lines.length > 0 || Boolean(interimText) || Boolean(interviewerInterim);
  // 最终稿（或 SDK 已经渲染出来的同一段）进了正式消息就不再重复显示中间结果。
  const showInterviewerInterim =
    interviewerInterim.length > 0 &&
    !lines.some((line) => {
      if (line.from !== "interviewer") return false;
      const text = line.text.trim();
      return (
        text.length > 0 &&
        (text.includes(interviewerInterim) ||
          interviewerInterim.includes(text))
      );
    });

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [lines, interimText, interviewerInterim]);

  // 拖动栏宽或缩放窗口后重新排版，只要还贴着底部就继续跟住最新消息。
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (!stickToBottom.current) return;
      element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={scrollRef}
        onViewportScroll={onScroll}
        contentClassName="flex min-h-full flex-col p-4"
      >
        {!hasContent ? (
          <div className="flex flex-1 items-center justify-center px-4 text-center">
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
                      : "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2 text-right text-sm",
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
                <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-right text-sm whitespace-pre-wrap opacity-70">
                  {interimText}
                </div>
              </div>
            )}
            {showInterviewerInterim && (
              <div className="flex flex-col items-start gap-1">
                <div className="bg-muted max-w-[85%] rounded-2xl rounded-tl-sm px-3 py-2 text-sm whitespace-pre-wrap opacity-70">
                  {interviewerInterim}
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {!noTextInput && (
        <div className="border-t p-(--card-spacing)">
          <TextInput />
        </div>
      )}
    </ConsolePanel>
  );
}
