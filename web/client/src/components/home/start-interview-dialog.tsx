"use client";

import type { PipecatClient } from "@pipecat-ai/client-js";
import { CheckIcon, FileTextIcon, MicIcon, XIcon } from "lucide-react";
import { useEffect, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { InterviewAudioCheck } from "@/components/home/interview-audio-check";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/format";
import type { ProfileSummary } from "@/lib/materials";
import { cn } from "@/lib/utils";

/**
 * 开始面试前的两步：上面一个弹窗选面试档案，下面一个弹窗配音频，
 * 「开始面试」压在整个组合的最底部。内容放得下时不出滚动条，
 * 太长就整块滚动，两个弹窗都不会被单独截断。
 */
export function StartInterviewDialog({
  open,
  profiles,
  error,
  selectedId,
  audioClient,
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
  /** 设备选择复用的客户端（侧栏那一路），null 时显示加载中。 */
  audioClient?: PipecatClient | null;
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
  const showContent = !loading && !error && !empty;
  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="flex w-full max-w-md flex-col gap-3">
          {/* 弹窗一：选面试档案 */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("home.start.title")}
            className="border-border bg-background flex flex-col overflow-hidden rounded-xl border shadow-2xl"
            onMouseDown={stop}
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

            <div className="grid gap-1 p-2">
              {loading && (
                <div className="text-muted-foreground flex h-40 items-center justify-center gap-2 text-sm">
                  <Spinner className="size-4" />
                  {t("home.start.loading")}
                </div>
              )}

              {error && (
                <div className="flex h-40 flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-destructive text-sm">
                    {t("home.start.loadFailed", { message: error })}
                  </p>
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    {t("materials.retry")}
                  </Button>
                </div>
              )}

              {!loading && !error && empty && (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
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

              {showContent &&
                (profiles ?? []).map((profile) => {
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

            {showContent && (
              <div className="border-border shrink-0 border-t px-4 py-3">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("home.start.hint")}
                </p>
              </div>
            )}
          </div>

          {/* 弹窗二：音频 + 最底部的开始按钮 */}
          {showContent && (
            <div
              role="group"
              aria-label={t("home.start.audioTitle")}
              className="border-border bg-background overflow-hidden rounded-xl border shadow-2xl"
              onMouseDown={stop}
            >
              <InterviewAudioCheck client={audioClient} />
              <div className="border-border flex items-center justify-end border-t px-4 py-3">
                <Button size="sm" disabled={!selectedId} onClick={onConfirm}>
                  <MicIcon />
                  {t("home.start.confirm")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
