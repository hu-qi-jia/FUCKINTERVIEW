"use client";

import type { ConversationMessage } from "@pipecat-ai/client-react";
import {
  useConversationContext,
  usePipecatClientTransportState,
  usePipecatConversation,
} from "@pipecat-ai/client-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  ConversationMessageItem,
  type ConversationMessageItemProps,
  type TextRenderMode,
} from "@/components/pipecat/conversation-message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface ConversationViewProps extends Omit<
  ConversationMessageItemProps,
  "message" | "className"
> {
  /** Messages to render. */
  messages?: ConversationMessage[];
  /** Disable automatic scrolling when new messages arrive. */
  noAutoscroll?: boolean;
  /** Newest messages first; auto-scroll targets the top. */
  reverseOrder?: boolean;
  /** Rendered when there are no messages. */
  empty?: React.ReactNode;
  /**
   * 正在流式生成、还没进正式消息的文本（token 级）。
   * 显示在列表末尾，等正式消息追上来后由调用方传空。
   */
  pendingText?: string;
  className?: string;
  /** Classes for each message row. */
  messageClassName?: string;
}

/**
 * Scrolling conversation list. Auto-scrolls to the newest message unless
 * the user has scrolled away. Fully props-driven; pair with the connected
 * Conversation for Pipecat wiring.
 */
export function ConversationView({
  messages = [],
  noAutoscroll = false,
  reverseOrder = false,
  empty,
  pendingText,
  className,
  messageClassName,
  ...messageProps
}: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledToEdge = useRef(true);
  const { t } = useTranslation();

  const maybeScrollToEdge = useCallback(() => {
    if (!scrollRef.current) return;
    if (isScrolledToEdge.current) {
      scrollRef.current.scrollTo({
        top: reverseOrder ? 0 : scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [reverseOrder]);

  const lastScrollTop = useRef(0);

  // Only a scroll away from the edge detaches. Our own smooth scroll reports
  // intermediate positions short of the edge while it moves toward it.
  const updateScrollState = useCallback(() => {
    if (!scrollRef.current) return;
    const { clientHeight, scrollHeight, scrollTop } = scrollRef.current;
    const movedAway = reverseOrder
      ? scrollTop > lastScrollTop.current
      : scrollTop < lastScrollTop.current;
    // Tracked even while noAutoscroll is set, so re-enabling starts fresh.
    lastScrollTop.current = scrollTop;
    if (noAutoscroll) return;
    const atEdge = reverseOrder
      ? scrollTop <= 1
      : Math.ceil(scrollHeight - scrollTop) <= Math.ceil(clientHeight);
    if (atEdge) isScrolledToEdge.current = true;
    else if (movedAway) isScrolledToEdge.current = false;
  }, [noAutoscroll, reverseOrder]);

  useEffect(() => {
    if (noAutoscroll) return;
    if (messages.length === 0) {
      isScrolledToEdge.current = true;
      lastScrollTop.current = 0;
    }
    maybeScrollToEdge();
  }, [messages, maybeScrollToEdge, noAutoscroll]);

  // 流式回答时 messages 不一定会换引用，每次渲染都检查一次：
  // 只要还贴着边缘，就把最新内容留在可视区底部。
  useEffect(() => {
    if (noAutoscroll) return;
    const element = scrollRef.current;
    if (!element || !isScrolledToEdge.current) return;
    element.scrollTop = reverseOrder ? 0 : element.scrollHeight;
  });

  // 拖动栏宽或缩放窗口会重新排版；仍然贴着边缘时继续跟住最新内容。
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || noAutoscroll) return;
    const observer = new ResizeObserver(() => {
      if (!isScrolledToEdge.current) return;
      element.scrollTop = reverseOrder ? 0 : element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [noAutoscroll, reverseOrder]);

  if (messages.length === 0 && !pendingText) {
    return (
      <div
        data-slot="conversation"
        className={cn("relative flex h-full flex-col", className)}
      >
        <div className="flex flex-1 items-center justify-center">
          {empty ?? (
            <div className="text-muted-foreground text-sm">
              {t("conversation.waiting")}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="conversation"
      className={cn("relative flex h-full flex-col", className)}
    >
      <ScrollArea
        className="relative min-h-0 flex-1"
        viewportRef={scrollRef}
        onViewportScroll={updateScrollState}
        contentClassName="p-4"
      >
        <div className="flex flex-col gap-4">
          {(reverseOrder ? [...messages].reverse() : messages).map(
            (message, index) => (
              <ConversationMessageItem
                key={`${message.createdAt}-${index}`}
                message={message}
                className={messageClassName}
                {...messageProps}
              />
            ),
          )}
          {pendingText && (
            <div className="text-sm leading-relaxed whitespace-pre-wrap">
              {pendingText}
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-[-2px]"
              />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export interface ConversationProps extends Omit<
  ConversationViewProps,
  "messages" | "empty"
> {
  /** Hide function-call messages (they remain captured in the store). */
  noFunctionCalls?: boolean;
  /** Controls how bot message text is rendered. */
  textRenderMode?: TextRenderMode;
  /** Only render messages with these roles. All roles when unset. */
  roles?: ConversationMessage["role"][];
  /** Shown when connected but there are no messages to render. */
  empty?: React.ReactNode;
  /** 覆盖 SDK 的会话消息，例如流式期间先隐藏正在写的那一条。 */
  messages?: ConversationMessage[];
}

/**
 * Live conversation wired to the Pipecat client, with connection-aware
 * empty states. Must be rendered inside a PipecatClientProvider.
 */
export function Conversation({
  noFunctionCalls = false,
  textRenderMode,
  roles,
  empty: emptyWhenConnected,
  aggregationMetadata,
  ...props
}: ConversationProps) {
  const transportState = usePipecatClientTransportState();
  const { t } = useTranslation();

  // "captions" mode only needs spoken text; the other modes need all data.
  const botOutputFilter = useMemo(() => {
    if (textRenderMode === "captions") return { unspoken: false };
    return undefined;
  }, [textRenderMode]);

  const { messages: allMessages } = usePipecatConversation({
    aggregationMetadata,
    botOutputFilter,
  });
  const { botOutputSupported } = useConversationContext();

  const messages = useMemo(() => {
    let visible = noFunctionCalls
      ? allMessages.filter((m) => m.role !== "function_call")
      : allMessages;
    if (roles) visible = visible.filter((m) => roles.includes(m.role));
    return visible;
  }, [allMessages, noFunctionCalls, roles]);

  const isConnecting =
    transportState === "authenticating" || transportState === "connecting";
  const isConnected =
    transportState === "connected" || transportState === "ready";

  let empty: React.ReactNode;
  if (isConnecting) {
    empty = (
      <div className="text-muted-foreground text-sm">
        {t("conversation.connecting")}
      </div>
    );
  } else if (!isConnected) {
    empty = (
      <div className="p-4 text-center">
        <div className="text-muted-foreground mb-2">
          {t("conversation.notConnected")}
        </div>
        <p className="text-muted-foreground max-w-md text-sm">
          {t("conversation.connectHint")}
        </p>
      </div>
    );
  } else if (botOutputSupported === false) {
    empty = (
      <div className="max-w-md p-4 text-center">
        <div className="text-destructive mb-2 font-medium">
          {t("conversation.botOutputUnsupported")}
        </div>
        <p className="text-muted-foreground text-sm">
          {t("conversation.botOutputHint")}
        </p>
      </div>
    );
  } else {
    empty = emptyWhenConnected;
  }

  return (
    <ConversationView
      messages={messages}
      empty={empty}
      textRenderMode={textRenderMode}
      aggregationMetadata={aggregationMetadata}
      {...props}
    />
  );
}
