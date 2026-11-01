"use client";

import {
  ArrowLeftIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DocumentViewer } from "@/components/documents/document-viewer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { WindowControls } from "@/components/window-controls";
import {
  deleteDocument,
  DOCUMENT_ACCEPT,
  listDocuments,
  MAX_DOCUMENT_BYTES,
  renameDocument,
  uploadDocument,
  type OtherDocument,
} from "@/lib/documents";
import { formatBytes, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface UploadItem {
  key: string;
  file: File;
  status: "uploading" | "failed";
  error?: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 其他资料：上传逐字稿或作品集（md / pdf），只在面试页展示用。
 *
 * 列表 → 点条目进入预览，和面试档案的「列表 → 详情」保持一致；
 * 文件不进 prompt，所以这里没有任何整合或生成动作。
 */
export function DocumentsPage({
  headerExtras,
  leadingExtras,
  dataVersion = 0,
}: {
  headerExtras?: React.ReactNode;
  /** 窄屏顶栏左侧的页面入口（桌面端由侧栏承担）。 */
  leadingExtras?: React.ReactNode;
  dataVersion?: number;
}) {
  const { t, i18n } = useTranslation();
  const [documents, setDocuments] = useState<OtherDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const moreRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const dragDepth = useRef(0);

  const detail = documents.find((item) => item.id === detailId) ?? null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const next = await listDocuments();
      setDocuments(next);
      setDetailId((current) =>
        current && next.some((item) => item.id === current) ? current : null,
      );
    } catch (error) {
      setListError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 只在挂载和数据目录变化时重新拉取；其余变化由交互触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const validationError = (file: File): string | null => {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".md") && !name.endsWith(".pdf")) {
      return t("documents.invalidType");
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return t("documents.tooLarge");
    }
    return null;
  };

  const runUpload = async (key: string, file: File) => {
    try {
      const created = await uploadDocument(file);
      setDocuments((previous) => [created, ...previous]);
      setUploads((previous) => previous.filter((item) => item.key !== key));
    } catch (error) {
      setUploads((previous) =>
        previous.map((item) =>
          item.key === key
            ? { ...item, status: "failed", error: errorText(error) }
            : item,
        ),
      );
    }
  };

  const enqueue = (files: File[]) => {
    for (const file of files) {
      const key = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const invalid = validationError(file);
      if (invalid) {
        setUploads((previous) => [
          ...previous,
          { key, file, status: "failed", error: invalid },
        ]);
        continue;
      }
      setUploads((previous) => [
        ...previous,
        { key, file, status: "uploading" },
      ]);
      void runUpload(key, file);
    }
  };

  const retryUpload = (item: UploadItem) => {
    setUploads((previous) =>
      previous.map((entry) =>
        entry.key === item.key
          ? { key: entry.key, file: entry.file, status: "uploading" }
          : entry,
      ),
    );
    void runUpload(item.key, item.file);
  };

  const removeUpload = (key: string) => {
    setUploads((previous) => previous.filter((item) => item.key !== key));
  };

  const commitRename = async (doc: OtherDocument) => {
    const title = editValue.trim();
    setEditingId(null);
    if (!title || title === doc.title) return;
    try {
      const updated = await renameDocument(doc.id, title);
      setDocuments((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      setListError(errorText(error));
    }
  };

  const removeDocument = async (id: string) => {
    try {
      await deleteDocument(id);
      setPendingDelete(null);
      setDocuments((previous) => previous.filter((item) => item.id !== id));
      setDetailId((current) => (current === id ? null : current));
    } catch (error) {
      setPendingDelete(null);
      setListError(errorText(error));
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) enqueue(files);
  };

  const header = (
    <header className="app-drag app-page-header flex h-12 shrink-0 items-center gap-2 border-b px-3">
      {leadingExtras}
      <h1 className="hidden min-w-0 truncate text-sm font-semibold md:block">
        {t("nav.documents")}
      </h1>
      <div className="app-no-drag ml-auto flex min-w-0 items-center gap-1.5">
        {headerExtras}
      </div>
      <WindowControls />
    </header>
  );

  if (detail) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex shrink-0 items-center gap-2 px-4 pt-4 pb-3">
          <Button size="sm" variant="ghost" onClick={() => setDetailId(null)}>
            <ArrowLeftIcon />
            {t("documents.back")}
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
            {detail.title}
          </h2>
          <span className="text-muted-foreground shrink-0 text-xs">
            {formatBytes(detail.size)}
          </span>
        </div>
        <div className="min-h-0 flex-1 border-t">
          <DocumentViewer doc={detail} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 pt-4">
          <span className="text-muted-foreground text-xs">
            {t("documents.count", { count: documents.length })}
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <UploadIcon />
              {t("documents.upload")}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={DOCUMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 0) enqueue(files);
                event.target.value = "";
              }}
            />
          </div>
        </div>

        {listError && (
          <div className="text-destructive shrink-0 px-4 py-1.5 text-xs">
            {listError}
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-4">
            {uploads.length > 0 && (
              <ul className="mb-2 grid gap-2">
                {uploads.map((item) => (
                  <li
                    key={item.key}
                    className="bg-muted/40 flex items-center gap-3 rounded-xl px-3 py-2"
                  >
                    <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {item.file.name}
                    </span>
                    {item.status === "uploading" ? (
                      <Spinner className="size-4" />
                    ) : (
                      <>
                        <span className="text-destructive max-w-[50%] truncate text-xs">
                          {item.error}
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => retryUpload(item)}
                        >
                          {t("documents.retry")}
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t("documents.remove")}
                          onClick={() => removeUpload(item.key)}
                        >
                          <XIcon />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {loading && documents.length === 0 ? (
              <div className="text-muted-foreground flex h-48 items-center justify-center gap-2 text-sm">
                <Spinner />
                {t("documents.loading")}
              </div>
            ) : listError && documents.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-destructive text-sm">
                  {t("documents.loadFailed", { message: listError })}
                </p>
                <Button size="sm" variant="outline" onClick={() => void refresh()}>
                  {t("documents.retry")}
                </Button>
              </div>
            ) : documents.length === 0 ? (
              <div
                className={cn(
                  "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors",
                  dragOver && "border-ring bg-muted/40",
                )}
              >
                <UploadIcon className="text-muted-foreground size-6" />
                <p className="text-sm font-medium">
                  {t("documents.empty.title")}
                </p>
                <p className="text-muted-foreground max-w-sm text-xs">
                  {t("documents.empty.hint")}
                </p>
                <Button size="sm" onClick={() => inputRef.current?.click()}>
                  {t("documents.upload")}
                </Button>
              </div>
            ) : (
              <ul className="grid gap-2">
                {documents.map((doc) => (
                  <li key={doc.id}>
                    <div className="bg-card ring-foreground/10 hover:bg-muted/40 flex w-full items-center gap-3 rounded-xl p-3 ring-1 transition-colors">
                      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                        <FileTextIcon className="size-4" />
                      </span>
                      {editingId === doc.id ? (
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                          onBlur={() => void commitRename(doc)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void commitRename(doc);
                            } else if (event.key === "Escape") {
                              setEditingId(null);
                            }
                          }}
                          aria-label={t("documents.rename")}
                          className="h-8"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDetailId(doc.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate text-sm font-medium">
                            {doc.title}
                          </div>
                          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                            <span className="uppercase">{doc.ext}</span>
                            <span>{formatBytes(doc.size)}</span>
                            <span>
                              {t("documents.uploadedAt", {
                                time: formatDateTime(
                                  doc.createdAt,
                                  i18n.language,
                                ),
                              })}
                            </span>
                          </div>
                        </button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              ref={(element: HTMLButtonElement | null) => {
                                if (element) moreRefs.current.set(doc.id, element);
                                else moreRefs.current.delete(doc.id);
                              }}
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t("documents.actions")}
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditValue(doc.title);
                              setEditingId(doc.id);
                            }}
                          >
                            {t("documents.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete(doc.id)}
                          >
                            {t("documents.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>

        {dragOver && (
          <div className="border-ring bg-background/80 pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed text-sm">
            {t("documents.dropHint")}
          </div>
        )}
      </div>

      <Popover
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <PopoverContent
          anchor={() =>
            pendingDelete ? (moreRefs.current.get(pendingDelete) ?? null) : null
          }
          align="end"
          sideOffset={6}
          className="w-64"
        >
          <p className="text-xs leading-relaxed">
            {t("documents.deleteConfirm", {
              name:
                documents.find((item) => item.id === pendingDelete)?.title ?? "",
            })}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setPendingDelete(null)}
            >
              {t("documents.cancel")}
            </Button>
            <Button
              size="xs"
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void removeDocument(pendingDelete);
              }}
            >
              {t("documents.confirmDelete")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
