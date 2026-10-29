"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { InlineConfirmButton } from "@/components/materials/inline-confirm-button";
import { IndexDot } from "@/components/materials/qa-bits";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { QA_TYPES, type QaItem, type QaPatch, type QaType } from "@/lib/qa";
import { cn } from "@/lib/utils";

const SEPARATOR = " | ";

interface Draft {
  question: string;
  answer: string;
  aliases: string;
  tags: string;
  category: string;
  type: QaType;
}

function toDraft(item: QaItem): Draft {
  return {
    question: item.question,
    answer: item.answer,
    aliases: item.aliases.join(SEPARATOR),
    tags: item.tags.join(SEPARATOR),
    category: item.category,
    type: item.type,
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[|;,、\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function diff(draft: Draft, item: QaItem): QaPatch | null {
  const patch: QaPatch = {};
  let changed = false;
  if (draft.question !== item.question) {
    patch.question = draft.question;
    changed = true;
  }
  if (draft.answer !== item.answer) {
    patch.answer = draft.answer;
    changed = true;
  }
  const aliases = splitList(draft.aliases);
  if (!sameList(aliases, item.aliases)) {
    patch.aliases = aliases;
    changed = true;
  }
  const tags = splitList(draft.tags);
  if (!sameList(tags, item.tags)) {
    patch.tags = tags;
    changed = true;
  }
  if (draft.category !== item.category) {
    patch.category = draft.category;
    changed = true;
  }
  if (draft.type !== item.type) {
    patch.type = draft.type;
    changed = true;
  }
  return changed ? patch : null;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** 字段规范见 web/client/FORM_SPEC.md：标签 12px muted、控件 h-8、提示写进 placeholder。 */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </label>
  );
}

/**
 * 单条问答的编辑区：停手 800ms 自动保存，和面试档案的节奏一致。
 * 内容改动会触发后台重新计算向量，界面只显示状态，不等待索引完成。
 */
export function QaEditor({
  item,
  saving,
  saveFailed,
  onSave,
  onDelete,
}: {
  item: QaItem;
  saving: boolean;
  saveFailed: string | null;
  onSave: (patch: QaPatch) => void | Promise<void>;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => toDraft(item));

  // 切换到另一条时重新取初值，避免把上一条的草稿带过来。
  useEffect(() => {
    setDraft(toDraft(item));
  }, [item.id]);

  useEffect(() => {
    const patch = diff(draft, item);
    if (!patch) return;
    if (!draft.question.trim() || !draft.answer.trim()) return; // 空内容不提交
    const timer = window.setTimeout(() => {
      void onSave(patch);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draft, item, onSave]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const updatedAt = useMemo(() => {
    const date = new Date(item.updatedAt);
    return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
  }, [item.updatedAt]);

  const statusLabel =
    item.indexStatus === "ready"
      ? t("qa.editor.indexed")
      : item.indexStatus === "failed"
        ? t("qa.editor.indexFailed")
        : t("qa.editor.indexing");

  return (
    <div className="border-t px-4 pb-4 pt-4">
      <div className="grid gap-3">
        <Field label={t("qa.field.question")}>
          <Input
            value={draft.question}
            onChange={(event) => set("question", event.target.value)}
            placeholder={t("qa.field.questionHint")}
            className="h-8"
          />
        </Field>

        <Field label={t("qa.field.answer")}>
          <Textarea
            value={draft.answer}
            rows={7}
            onChange={(event) => set("answer", event.target.value)}
            placeholder={t("qa.field.answerHint")}
            className="field-sizing-fixed resize-none leading-relaxed"
          />
        </Field>
      </div>

      <Separator className="my-4" />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("qa.field.aliases")}>
          <Input
            value={draft.aliases}
            onChange={(event) => set("aliases", event.target.value)}
            placeholder={t("qa.field.aliasesHint")}
            className="h-8"
          />
        </Field>
        <Field label={t("qa.field.tags")}>
          <Input
            value={draft.tags}
            onChange={(event) => set("tags", event.target.value)}
            placeholder={t("qa.field.tagsHint")}
            className="h-8"
          />
        </Field>
        <Field label={t("qa.field.category")}>
          <Input
            value={draft.category}
            onChange={(event) => set("category", event.target.value)}
            placeholder={t("qa.field.categoryHint")}
            className="h-8"
          />
        </Field>
        <Field label={t("qa.field.type")}>
          <Select
            items={QA_TYPES.map((value) => ({
              value,
              label: t(`qa.type.${value}`),
            }))}
            value={draft.type}
            onValueChange={(next) => set("type", String(next) as QaType)}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {QA_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`qa.type.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t pt-3 text-[11px] text-muted-foreground">
        {saving ? (
          <span className="flex items-center gap-1.5">
            <Spinner className="size-3" />
            {t("qa.editor.saving")}
          </span>
        ) : saveFailed ? (
          <span className="text-destructive max-w-72 truncate" title={saveFailed}>
            {saveFailed}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <IndexDot status={item.indexStatus} />
            {statusLabel}
            {updatedAt && (
              <>
                <span className="text-border">·</span>
                <span>{t("qa.editor.updatedAt", { time: updatedAt })}</span>
              </>
            )}
          </span>
        )}

        <InlineConfirmButton
          size="xs"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive ml-auto"
          label={t("qa.delete")}
          confirmLabel={t("qa.deleteConfirm")}
          onConfirm={onDelete}
        />
      </div>

      {item.indexStatus === "failed" && item.indexError && (
        <p className="text-destructive mt-2 text-xs">{item.indexError}</p>
      )}
    </div>
  );
}
