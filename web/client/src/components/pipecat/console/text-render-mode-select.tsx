"use client";

import { useTranslation } from "react-i18next";

import type { TextRenderMode } from "@/components/pipecat/conversation-message";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TEXT_RENDER_MODES: Array<{ value: TextRenderMode }> = [
  { value: "karaoke" },
  { value: "captions" },
  { value: "instant" },
];

/** Render-mode picker shared by the transcript and answer panes. */
export function TextRenderModeSelect({
  value,
  onValueChange,
}: {
  value: TextRenderMode;
  onValueChange: (mode: TextRenderMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      items={TEXT_RENDER_MODES.map((mode) => ({
        value: mode.value,
        label: t(`conversation.${mode.value}`),
      }))}
      value={value}
      onValueChange={(next) => onValueChange(next as TextRenderMode)}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("conversation.renderMode")}
        className="h-7 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {TEXT_RENDER_MODES.map((mode) => (
          <SelectItem key={mode.value} value={mode.value}>
            {t(`conversation.${mode.value}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
