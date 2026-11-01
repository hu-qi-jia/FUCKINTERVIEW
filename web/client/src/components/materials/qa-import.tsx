"use client";

import {
  CheckCircle2Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  commitImport,
  previewImport,
  undoImport,
  type QaCommitResult,
  type QaPreview,
  type QaPreviewRow,
} from "@/lib/qa";

const TEMPLATES = [
  { file: "qa-template.xlsx", label: "templateXlsx" },
  { file: "qa-template.csv", label: "templateCsv" },
  { file: "qa-template.md", label: "templateMd" },
] as const;

function DecisionBadge({ row }: { row: QaPreviewRow }) {
  const { t } = useTranslation();
  const base = "rounded-full px-1.5 py-0.5 text-[10px] leading-none";
  if (row.nearDuplicateOf) {
    return (
      <span className={cn(base, "bg-amber-500/15 text-amber-600 dark:text-amber-400")}>
        {t("qa.import.decision.nearDuplicate")}
      </span>
    );
  }
  if (row.decision === "update") {
    return (
      <span className={cn(base, "bg-sky-500/15 text-sky-600 dark:text-sky-400")}>
        {t("qa.import.decision.update")}
      </span>
    );
  }
  if (row.decision === "skip") {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        {t("qa.import.decision.skip")}
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")}>
      {t("qa.import.decision.insert")}
    </span>
  );
}

function CountChip({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "insert" | "update" | "skip" | "error" | "duplicate";
}) {
  const tones: Record<typeof tone, string> = {
    insert: "text-emerald-600 dark:text-emerald-400",
    update: "text-sky-600 dark:text-sky-400",
    skip: "text-muted-foreground",
    error: "text-destructive",
    duplicate: "text-amber-600 dark:text-amber-400",
  };
  return (
    <span className="bg-muted/50 flex items-baseline gap-1 rounded-md px-2 py-1">
      <span className={cn("text-sm font-semibold tabular-nums", tones[tone])}>{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </span>
  );
}

/**
 * 导入流程：选文件 → 预览（新增 / 更新 / 跳过 / 疑似重复）→ 确认入库。
 * 确认后只写库，向量交给后台线程补算，所以界面立刻返回。
 * 「返回问答库」在顶部的标签栏里，和面试档案的交互位置一致。
 */
export function QaImport({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<QaPreview | null>(null);
  const [result, setResult] = useState<QaCommitResult | null>(null);
  const [mode, setMode] = useState<"merge" | "append">("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState<number | null>(null);

  const pick = async (chosen: File | null) => {
    if (!chosen) return;
    setFile(chosen);
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy(true);
    try {
      setPreview(await previewImport(chosen));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const committed = await commitImport(preview.token, mode);
      setResult(committed);
      setUndone(null);
      setPreview(null);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  /** 撤销只删除这一批新增的条目；被更新过的老条目保持更新后的内容。 */
  const undo = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const deleted = await undoImport(result.importId);
      setResult(null);
      setUndone(deleted);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const counts = preview?.counts;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto min-h-0 w-full max-w-7xl flex-1 overflow-y-auto px-4 pb-6 pt-3 scroll-stable">
        <div className="grid gap-3">
          <div className="bg-card ring-foreground/10 rounded-xl p-4 ring-1">
            <div className="flex items-start gap-3">
              <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                <FileSpreadsheetIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("qa.import.title")}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">{t("qa.import.hint")}</p>
              </div>
              <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                <UploadIcon />
                {t("qa.import.choose")}
              </Button>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xlsm,.csv,.md,.markdown"
              className="hidden"
              onChange={(event) => {
                void pick(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />

            <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span>{t("qa.import.templates")}</span>
              {TEMPLATES.map(({ file: name, label }) => (
                <a
                  key={name}
                  href={name}
                  download
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                >
                  <DownloadIcon className="size-3" />
                  {t(`qa.import.${label}`)}
                </a>
              ))}
            </div>

            {file && (
              <p className="text-muted-foreground mt-2 truncate text-xs">
                {t("qa.import.selected", { name: file.name })}
              </p>
            )}
          </div>

          {busy && !preview && (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
              <Spinner />
              {t("qa.import.parsing")}
            </div>
          )}

          {error && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
            </div>
          )}

          {result && (
            <div className="border-emerald-500/30 bg-emerald-500/5 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
              <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="min-w-0 flex-1">
                {t("qa.import.done", {
                  inserted: result.inserted,
                  updated: result.updated,
                  skipped: result.skipped,
                })}
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => void undo()}
              >
                {t("qa.import.undo")}
              </Button>
            </div>
          )}

          {undone !== null && (
            <div className="bg-muted/50 text-muted-foreground rounded-lg px-3 py-2 text-xs">
              {t("qa.import.undone", { count: undone })}
            </div>
          )}

          {preview && counts && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <CountChip value={counts.insert} label={t("qa.import.decision.insert")} tone="insert" />
                <CountChip value={counts.update} label={t("qa.import.decision.update")} tone="update" />
                <CountChip value={counts.skip} label={t("qa.import.decision.skip")} tone="skip" />
                {counts.nearDuplicate > 0 && (
                  <CountChip
                    value={counts.nearDuplicate}
                    label={t("qa.import.decision.nearDuplicate")}
                    tone="duplicate"
                  />
                )}
                {counts.error > 0 && (
                  <CountChip value={counts.error} label={t("qa.import.decision.error")} tone="error" />
                )}
              </div>

              {preview.previousImportAt && (
                <p className="text-muted-foreground text-xs">
                  {t("qa.import.previous", { time: preview.previousImportAt })}
                </p>
              )}
              {preview.nearDuplicateError && (
                <p className="text-amber-600 dark:text-amber-400 text-xs">
                  {t("qa.import.nearDuplicateUnavailable")}
                </p>
              )}

              <div className="bg-card ring-foreground/10 overflow-hidden rounded-xl ring-1">
                <ul className="divide-border/60 divide-y">
                  {preview.items.map((row, index) => (
                    <li key={`${row.line}-${index}`} className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <DecisionBadge row={row} />
                        <span className="min-w-0 flex-1 truncate text-sm">{row.question}</span>
                        {row.line != null && (
                          <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                            #{row.line}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                        {row.answerPreview}
                      </p>
                    </li>
                  ))}
                </ul>
                {preview.truncated && (
                  <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                    {t("qa.import.truncated", { count: preview.items.length })}
                  </p>
                )}
              </div>

              {preview.errors.length > 0 && (
                <div className="border-destructive/30 rounded-xl border">
                  <p className="text-destructive px-3 pt-2 text-xs font-medium">
                    {t("qa.import.errors", { count: counts.error })}
                  </p>
                  <ul className="text-muted-foreground grid gap-1 px-3 pb-2 pt-1 text-xs">
                    {preview.errors.map((row, index) => (
                      <li key={index} className="truncate">
                        {row.line != null && <span className="tabular-nums">#{row.line} </span>}
                        {row.message}
                        {row.question && ` · ${row.question}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    name="qa-import-mode"
                    checked={mode === "merge"}
                    onChange={() => setMode("merge")}
                  />
                  {t("qa.import.modeMerge")}
                </label>
                <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    name="qa-import-mode"
                    checked={mode === "append"}
                    onChange={() => setMode("append")}
                  />
                  {t("qa.import.modeAppend")}
                </label>
                <Button className="ml-auto" size="sm" onClick={() => void confirm()} disabled={busy}>
                  {busy ? <Spinner className="size-3" /> : <CheckCircle2Icon />}
                  {t("qa.import.confirm", { count: counts.insert + counts.update })}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
