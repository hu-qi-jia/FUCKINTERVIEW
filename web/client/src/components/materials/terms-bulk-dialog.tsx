"use client";

import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { commitBulk, parseBulk, type BulkParse } from "@/lib/terms";

/**
 * 批量粘贴的弹窗：一行一条，解析出预览，确认后一次性写库。
 * 列表页不再为它切视图，取消就什么都没发生。
 */
export function TermsBulkDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<BulkParse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setParsed(null);
    setError(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void parseBulk(text)
        .then(setParsed)
        .catch((caught) =>
          setError(caught instanceof Error ? caught.message : String(caught)),
        );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, open]);

  if (!open) return null;

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      await commitBulk(text);
      await onDone();
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
        aria-label={t("terms.bulk.title")}
        className="border-border bg-background flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-border flex h-12 shrink-0 items-center justify-between border-b px-4">
          <h2 className="text-sm font-semibold">{t("terms.bulk.title")}</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("terms.bulk.cancel")}
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4">
          <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-line">
            {t("terms.bulk.hint")}
          </p>
          <Textarea
            value={text}
            rows={9}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("terms.bulk.placeholder")}
            className="field-sizing-fixed resize-none font-mono text-xs leading-relaxed"
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
          {parsed && (
            <div className="text-xs">
              <p className="text-muted-foreground">
                {t("terms.bulk.summary", {
                  count: parsed.items.length,
                  errors: parsed.errors.length,
                })}
              </p>
              {parsed.errors.length > 0 && (
                <ul className="text-destructive mt-1 grid gap-0.5">
                  {parsed.errors.slice(0, 5).map((item) => (
                    <li key={item.line}>
                      {t("terms.bulk.errorLine", { line: item.line, message: item.message })}
                    </li>
                  ))}
                </ul>
              )}
              {parsed.items.length > 0 && (
                <ul className="mt-2 grid gap-1">
                  {parsed.items.slice(0, 8).map((item) => (
                    <li key={item.term} className="truncate">
                      <span className="font-medium">{item.term}</span>
                      {item.aliases.length > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {item.aliases.join(" / ")}
                        </span>
                      )}
                      {item.definition && (
                        <span className="text-muted-foreground"> · {item.definition}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            {t("terms.bulk.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={busy || !parsed || parsed.items.length === 0}
            onClick={() => void commit()}
          >
            {busy && <Spinner className="size-3" />}
            {t("terms.bulk.commit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
