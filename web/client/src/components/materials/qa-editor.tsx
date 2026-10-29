"use client";

import { Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
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
  proficiency: number;
  enabled: boolean;
}

function toDraft(item: QaItem): Draft {
  return {
    question: item.question,
    answer: item.answer,
    aliases: item.aliases.join(SEPARATOR),
    tags: item.tags.join(SEPARATOR),
    category: item.category,
    type: item.type,
    proficiency: item.proficiency,
    enabled: item.enabled,
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
  if (draft.proficiency !== item.proficiency) {
    patch.proficiency = draft.proficiency;
    changed = true;
  }
  if (draft.enabled !== item.enabled) {
    patch.enabled = draft.enabled;
    changed = true;
  }
  return changed ? patch : null;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-muted-foreground flex items-baseline gap-2 text-xs">
        <span className="text-foreground font-medium">{label}</span>
        {hint && <span className="truncate">{hint}</span>}
      </span>
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
    <div className="border-border/60 grid gap-3 border-t px-4 pb-4 pt-3">
      <Field label={t("qa.field.question")}>
        <Input
          value={draft.question}
          onChange={(event) => set("question", event.target.value)}
          placeholder={t("qa.field.questionHint")}
        />
      </Field>

      <Field label={t("qa.field.answer")}>
        <Textarea
          value={draft.answer}
          onChange={(event) => set("answer", event.target.value)}
          placeholder={t("qa.field.answerHint")}
          className="min-h-32 resize-y"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("qa.field.aliases")} hint={t("qa.field.listHint")}>
          <Input
            value={draft.aliases}
            onChange={(event) => set("aliases", event.target.value)}
            placeholder={t("qa.field.aliasesHint")}
          />
        </Field>
        <Field label={t("qa.field.tags")} hint={t("qa.field.listHint")}>
          <Input
            value={draft.tags}
            onChange={(event) => set("tags", event.target.value)}
            placeholder={t("qa.field.tagsHint")}
          />
        </Field>
        <Field label={t("qa.field.category")}>
          <Input
            value={draft.category}
            onChange={(event) => set("category", event.target.value)}
            placeholder={t("qa.field.categoryHint")}
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">{t("qa.field.proficiency")}</span>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={t("qa.field.proficiencyValue", { value })}
                onClick={() => set("proficiency", value)}
                className={cn(
                  "size-6 rounded-md text-xs transition-colors",
                  value <= draft.proficiency
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <Switch
            checked={draft.enabled}
            onCheckedChange={(next) => set("enabled", Boolean(next))}
          />
          <span className="text-muted-foreground text-xs">{t("qa.field.enabled")}</span>
        </label>

        <div className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
          {saving && <Spinner className="size-3" />}
          {saveFailed ? (
            <span className="text-destructive">{saveFailed}</span>
          ) : (
            <>
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  item.indexStatus === "ready"
                    ? "bg-emerald-500"
                    : item.indexStatus === "failed"
                      ? "bg-destructive"
                      : "bg-amber-500",
                )}
              />
              <span>{statusLabel}</span>
              {updatedAt && <span>· {t("qa.editor.updatedAt", { time: updatedAt })}</span>}
            </>
          )}
          <Button size="xs" variant="destructive" onClick={onDelete}>
            <Trash2Icon />
            {t("qa.delete")}
          </Button>
        </div>
      </div>

      {item.indexStatus === "failed" && item.indexError && (
        <p className="text-destructive text-xs">{item.indexError}</p>
      )}
    </div>
  );
}
