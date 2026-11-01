"use client";

import { CheckIcon, FileTextIcon, MicIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/format";
import type { ProfileSummary } from "@/lib/materials";
import { cn } from "@/lib/utils";

/**
 * 开始面试前先选档案。选中的档案会写进实时面试的连接参数，
 * AI 只按这份档案里的事实回答。
 */
export function StartInterviewDialog({
  open,
  profiles,
  error,
  selectedId,
  onSelect,
  onConfirm,
  onClose,
  onCreate,
  onRetry,
}: {
  open: boolean;
  /** null 表示还在加载。 */
  profiles: ProfileSummary[] | null;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const loading = profiles === null && !error;
  const empty = (profiles?.length ?? 0) === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("home.start.title")}
        className="border-border bg-background flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-xl border shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t("home.start.title")}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("home.start.close")}
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          {loading && (
            <div className="text-muted-foreground flex h-48 items-center justify-center gap-2 text-sm">
              <Spinner className="size-4" />
              {t("home.start.loading")}
            </div>
          )}

          {error && (
            <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-destructive text-sm">
                {t("home.start.loadFailed", { message: error })}
              </p>
              <Button size="sm" variant="outline" onClick={onRetry}>
                {t("materials.retry")}
              </Button>
            </div>
          )}

          {!loading && !error && empty && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <FileTextIcon className="text-muted-foreground size-8" />
              <div className="grid gap-1">
                <p className="text-sm font-medium">
                  {t("home.start.emptyTitle")}
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("home.start.emptyHint")}
                </p>
              </div>
              <Button size="sm" onClick={onCreate}>
                {t("home.start.create")}
              </Button>
            </div>
          )}

          {!loading && !error && !empty && (
            <ScrollArea className="max-h-[48vh]">
              <div className="grid gap-1 p-2">
                {(profiles ?? []).map((profile) => {
                  const selected = profile.id === selectedId;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => onSelect(profile.id)}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        "hover:bg-accent/60",
                        selected && "bg-accent text-accent-foreground"
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {profile.name || t("materials.untitled")}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                          {t("home.start.profileMeta", {
                            time: formatDateTime(
                              profile.updatedAt,
                              i18n.language
                            ),
                            count: profile.cardCount,
                          })}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border"
                        )}
                        aria-hidden
                      >
                        {selected && <CheckIcon className="size-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {!empty && (
          <div className="border-border flex shrink-0 items-center gap-3 border-t px-4 py-3">
            <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-relaxed">
              {t("home.start.hint")}
            </p>
            <Button
              size="sm"
              disabled={!selectedId || loading || Boolean(error)}
              onClick={onConfirm}
            >
              <MicIcon />
              {t("home.start.confirm")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
