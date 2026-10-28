"use client";

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
import { Metrics } from "@/components/pipecat/metrics/metrics";
import { TextInput } from "@/components/pipecat/text-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface ConsoleConversationPanelProps {
  /** Hides the conversation tab. Default false. */
  noConversation?: boolean;
  /** Hides the metrics tab. Default false. */
  noMetrics?: boolean;
  /** Hides the text input under the transcript. Default false. */
  noTextInput?: boolean;
  /** Hides the render-mode select in the header. Default false. */
  noTextRenderModeSwitch?: boolean;
  /** Seeds (and can push) the transcript render mode. Default "karaoke". */
  textRenderMode?: TextRenderMode;
  /** Fired when the user picks a render mode in the header. */
  onTextRenderModeChange?: (mode: TextRenderMode) => void;
  /** Overrides merged onto the Conversation (labels, renderers, …). */
  conversationProps?: Partial<ConversationProps>;
  className?: string;
}

/**
 * Console center pane: the live transcript (with text input) and the
 * metrics dashboard as tabs. The conversation tab stays mounted so scroll
 * position survives tab switches; metrics re-reads its shared store. Must
 * be rendered inside a PipecatClientProvider.
 */
export function ConsoleConversationPanel({
  noConversation = false,
  noMetrics = false,
  noTextInput = false,
  noTextRenderModeSwitch = false,
  textRenderMode,
  onTextRenderModeChange,
  conversationProps,
  className,
}: ConsoleConversationPanelProps) {
  // Local selection seeded from the prop; a defined prop change pushes it.
  const [renderMode, setRenderMode] = React.useState<TextRenderMode>(
    textRenderMode ?? "karaoke",
  );
  const { t } = useTranslation();
  React.useEffect(() => {
    if (textRenderMode !== undefined) setRenderMode(textRenderMode);
  }, [textRenderMode]);

  if (noConversation && noMetrics) return null;

  const handleRenderMode = (mode: TextRenderMode) => {
    setRenderMode(mode);
    onTextRenderModeChange?.(mode);
  };

  // With only one section there is no tab to switch between, so the header
  // shows a plain title instead of a lone tab.
  const showTabs = !noConversation && !noMetrics;
  const sectionTitle = noConversation
    ? t("conversation.metrics")
    : t("conversation.title");

  return (
    <Tabs
      defaultValue={noConversation ? "metrics" : "conversation"}
      className={className}
      data-slot="console-conversation-panel"
    >
      <ConsolePanel>
        <div className="flex items-center gap-2 border-b px-(--card-spacing) pb-(--card-spacing)">
          {showTabs ? (
            <TabsList>
              <TabsTrigger value="conversation">
                {t("conversation.title")}
              </TabsTrigger>
              <TabsTrigger value="metrics">
                {t("conversation.metrics")}
              </TabsTrigger>
            </TabsList>
          ) : (
            <span className="text-sm font-medium">{sectionTitle}</span>
          )}
          {!noConversation && !noTextRenderModeSwitch && (
            <ConsolePanelActions className="ml-auto">
              <TextRenderModeSelect
                value={renderMode}
                onValueChange={handleRenderMode}
              />
            </ConsolePanelActions>
          )}
        </div>
        {!noConversation && (
          <TabsContent
            value="conversation"
            keepMounted
            className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden"
          >
            <ConsolePanelContent scroll={false}>
              <Conversation
                textRenderMode={renderMode}
                {...conversationProps}
              />
            </ConsolePanelContent>
            {!noTextInput && (
              <div className="border-t p-(--card-spacing)">
                <TextInput />
              </div>
            )}
          </TabsContent>
        )}
        {!noMetrics && (
          <TabsContent value="metrics" className="min-h-0 flex-1">
            <ConsolePanelContent>
              <Metrics />
            </ConsolePanelContent>
          </TabsContent>
        )}
      </ConsolePanel>
    </Tabs>
  );
}
