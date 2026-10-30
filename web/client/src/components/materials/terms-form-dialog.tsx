"use client";

import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ALIAS, MAX_TERM, type TermItem, type TermPatch } from "@/lib/terms";

const SEPARATOR = ", ";

function splitList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 新建 / 编辑术语的同一个弹窗。``item`` 为空是新建，否则编辑——内置模板的术语
 * 不能改名（后端也会拒绝），其余字段都能改。列表行只在弹窗里改，不再就地展开。
 */
export function TermsFormDialog({
  open,
  item,
  onClose,
  onSubmit,
}: {
  open: boolean;
  item: TermItem | null;
  onClose: () => void;
  onSubmit: (fields: TermPatch) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const [aliases, setAliases] = useState("");
  const [definition, setDefinition] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTerm(item?.term ?? "");
    setAliases(item ? item.aliases.join(SEPARATOR) : "");
    setDefinition(item?.definition ?? "");
    setError(null);
    setBusy(false);
  }, [open, item]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const readOnlyTerm = Boolean(item) && item?.template !== "custom";

  const submit = async () => {
    const value = term.trim();
    if (!value) {
      setError(t("terms.dialog.required"));
      return;
    }
    const list = splitList(aliases);
    const tooLong = list.find((entry) => entry.length > MAX_ALIAS);
    if (tooLong) {
      setError(t("terms.field.aliasTooLong", { value: tooLong, max: MAX_ALIAS }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...(readOnlyTerm ? {} : { term: value }),
        aliases: list,
        definition: definition.trim(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item ? t("terms.dialog.edit") : t("terms.dialog.title")}
        className="border-border bg-background flex w-full max-w-md flex-col overflow-hidden rounded-xl border shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-border flex h-12 shrink-0 items-center justify-between border-b px-4">
          <h2 className="text-sm font-semibold">
            {item ? t("terms.dialog.edit") : t("terms.dialog.title")}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("terms.dialog.cancel")}
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>

        <div className="grid gap-3 p-4">
          <label className="grid gap-1.5">
            <span className="text-muted-foreground text-xs">{t("terms.field.term")}</span>
            <Input
              autoFocus={!item}
              value={term}
              maxLength={MAX_TERM}
              disabled={readOnlyTerm}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={t("terms.field.termHint")}
              className="h-8"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  void submit();
                }
              }}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-muted-foreground text-xs">{t("terms.field.aliases")}</span>
            <Input
              value={aliases}
              onChange={(event) => setAliases(event.target.value)}
              placeholder={t("terms.field.aliasesHint", { max: MAX_ALIAS })}
              className="h-8"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-muted-foreground text-xs">{t("terms.field.definition")}</span>
            <Textarea
              value={definition}
              rows={3}
              onChange={(event) => setDefinition(event.target.value)}
              placeholder={t("terms.field.definitionHint")}
              className="field-sizing-fixed resize-none leading-relaxed"
            />
          </label>

          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>

        <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            {t("terms.dialog.cancel")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy && <Spinner className="size-3" />}
            {item ? t("terms.dialog.save") : t("terms.dialog.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
