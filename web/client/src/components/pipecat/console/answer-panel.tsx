"use client";

import type { ConversationMessage } from "@pipecat-ai/client-react";
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
        />
      </ConsolePanelContent>
    </ConsolePanel>
  );
}
