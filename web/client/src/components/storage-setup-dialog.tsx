"use client";

import { DatabaseIcon, FolderOpenIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  fetchStorage,
  pickFolder,
  saveStoragePaths,
  type StorageInfo,
} from "@/lib/materials";
import { modelsDirFor, samePath } from "@/lib/storage-path";
import { cn } from "@/lib/utils";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 和设置页一致的单列字段：标签 + 控件，控件高 32px。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * 首次启动的数据位置引导。
 *
 * 只在桌面端首次运行出现：默认沿用 userData/data，用户可以把数据目录、
 * 模型目录换到任意可写路径；模型目录默认「跟随数据目录」。不修改直接开始
 * 也可以，之后在「设置 → 通用设置」里随时能改。
 */
export function StorageSetupDialog({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [dataDir, setDataDir] = useState("");
  const [modelDir, setModelDir] = useState("");
  const [followData, setFollowData] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchStorage()
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        setDataDir(next.dataDir);
        const custom = Boolean(next.modelDirCustom);
        setFollowData(!custom);
        setModelDir(custom ? next.modelDir ?? "" : "");
      })
      .catch((err) => {
        if (!cancelled) setError(message(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chooseDataDir = useCallback(async () => {
    try {
      const picked = await pickFolder(dataDir);
      if (picked) setDataDir(picked);
    } catch (err) {
      setError(message(err));
    }
  }, [dataDir]);

  const chooseModelDir = useCallback(async () => {
    try {
      const picked = await pickFolder(
        followData ? modelsDirFor(dataDir) : modelDir || modelsDirFor(dataDir)
      );
      if (picked) {
        setModelDir(picked);
        setFollowData(false);
      }
    } catch (err) {
      setError(message(err));
    }
  }, [dataDir, followData, modelDir]);

  const finish = useCallback(
    async (keepCurrent: boolean) => {
      if (!info) return;
      if (keepCurrent) {
        onDone();
        return;
      }
      if (!dataDir.trim()) {
        setError(t("storageSetup.needData"));
        return;
      }
      if (!followData && !modelDir.trim()) {
        setError(t("storageSetup.needModel"));
        return;
      }

      const dataChanged = !samePath(dataDir.trim(), info.dataDir);
      const modelChanged = followData
        ? Boolean(info.modelDirCustom)
        : !info.modelDirCustom ||
          !samePath(modelDir.trim(), info.modelDir ?? "");
      if (!dataChanged && !modelChanged) {
        onDone();
        return;
      }

      setBusy(true);
      setError("");
      try {
        await saveStoragePaths(
          dataChanged ? dataDir.trim() : "",
          followData ? "" : modelDir.trim(),
          true
        );
        onDone();
      } catch (err) {
        setError(t("storageSetup.failed", { message: message(err) }));
      } finally {
        setBusy(false);
      }
    },
    [dataDir, followData, info, modelDir, onDone, t]
  );

  if (!open) return null;
  const disabled = loading || busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("storageSetup.title")}
        className="border-border bg-background flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-xl border shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <DatabaseIcon className="text-muted-foreground size-4" />
          <h2 className="text-sm font-semibold">{t("storageSetup.title")}</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3">
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("storageSetup.intro")}
            </p>

            {loading && !info ? (
              <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                <Spinner /> {t("settings.loading")}
              </div>
            ) : (
              <>
                <Field label={t("storageSetup.dataLabel")}>
                  <div className="flex items-center gap-2">
                    <Input
                      value={dataDir}
                      onChange={(event) => setDataDir(event.target.value)}
                      spellCheck={false}
                      disabled={disabled}
                      className="h-8 min-w-0 flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={t("storageSetup.pick")}
                      title={t("storageSetup.pick")}
                      disabled={disabled}
                      onClick={() => void chooseDataDir()}
                    >
                      <FolderOpenIcon />
                    </Button>
                  </div>
                </Field>

                <Separator />

                <label className="flex min-h-8 items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("storageSetup.followData")}
                  </span>
                  <Switch
                    checked={followData}
                    onCheckedChange={(checked) => {
                      setFollowData(checked);
                      if (!checked && !modelDir.trim()) {
                        setModelDir(modelsDirFor(dataDir));
                      }
                    }}
                    disabled={disabled}
                  />
                </label>

                <Field label={t("storageSetup.modelLabel")}>
                  <div className="flex items-center gap-2">
                    <Input
                      value={followData ? modelsDirFor(dataDir) : modelDir}
                      onChange={(event) => setModelDir(event.target.value)}
                      spellCheck={false}
                      disabled={disabled || followData}
                      placeholder={modelsDirFor(dataDir)}
                      className="h-8 min-w-0 flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={t("storageSetup.pick")}
                      title={t("storageSetup.pick")}
                      disabled={disabled || followData}
                      onClick={() => void chooseModelDir()}
                    >
                      <FolderOpenIcon />
                    </Button>
                  </div>
                </Field>
              </>
            )}
          </div>
        </div>

        <div className="border-border flex h-14 shrink-0 items-center justify-between gap-2 border-t px-4">
          <span
            className={cn(
              "min-w-0 truncate text-xs",
              error ? "text-destructive" : "text-muted-foreground"
            )}
            title={error || undefined}
          >
            {error || (busy ? t("storageSetup.saving") : "")}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || loading}
              onClick={() => void finish(true)}
            >
              {t("storageSetup.useCurrent")}
            </Button>
            <Button
              size="sm"
              disabled={disabled || !info}
              onClick={() => void finish(false)}
            >
              {busy && <Spinner className="size-3.5" />}
              {busy ? t("storageSetup.saving") : t("storageSetup.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
