"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { DocumentViewer } from "@/components/documents/document-viewer";
import {
  ConsolePanel,
  ConsolePanelContent,
  ConsolePanelHeader,
  ConsolePanelTitle,
} from "@/components/pipecat/console/panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { listDocuments, type OtherDocument } from "@/lib/documents";
import { cn } from "@/lib/utils";

export interface ConsoleDocumentsPanelProps {
  /** Compact rendering for a collapsed pane: header strip only. */
  collapsed?: boolean;
  className?: string;
}

/**
 * 实时面试底部条：左边是资料列表，右边渲染选中的 md / pdf。
 *
 * 文件在本地，不依赖连接状态；默认选中最新上传的一份，不记忆上次选择，
 * 切换资料时查看器整体重挂载，缩放和页码自然回到初始值。
 */
export function ConsoleDocumentsPanel({
  collapsed = false,
  className,
}: ConsoleDocumentsPanelProps) {
  const { t } = useTranslation();
  const [documents, setDocuments] = React.useState<OtherDocument[]>([]);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setStatus("loading");
    try {
      const next = await listDocuments();
      setDocuments(next);
      setSelectedId(next[0]?.id ?? null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selected =
    documents.find((item) => item.id === selectedId) ?? documents[0] ?? null;

  return (
    <ConsolePanel
      className={className}
      data-slot="console-documents-panel"
      data-state={collapsed ? "collapsed" : "expanded"}
    >
      {/* 展开时不显示标题条，把高度留给文档；折叠成一条时才需要它当抓手。 */}
      {collapsed && (
        <ConsolePanelHeader>
          <ConsolePanelTitle>{t("documents.title")}</ConsolePanelTitle>
        </ConsolePanelHeader>
      )}
      {!collapsed && (
        <ConsolePanelContent
          scroll={false}
          className="flex flex-row overflow-hidden p-0"
        >
          {documents.length > 0 && (
            <nav
              aria-label={t("documents.panel.list")}
              className="w-[140px] shrink-0 overflow-y-auto border-r p-1 @xs/panel:w-[180px] @md/panel:w-[200px]"
            >
              <ul className="flex flex-col gap-0.5">
                {documents.map((doc) => {
                  const active = doc.id === selected?.id;
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(doc.id)}
                        title={doc.title}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "hover:bg-muted w-full truncate rounded-md px-2 py-1.5 text-left text-xs",
                          active &&
                            "bg-accent text-accent-foreground font-medium",
                        )}
                      >
                        {doc.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}

          <div className="min-h-0 min-w-0 flex-1">
            {status === "loading" ? (
              <div className="text-muted-foreground flex h-full items-center justify-center">
                <Spinner className="size-5" />
              </div>
            ) : status === "error" ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                <p className="text-muted-foreground text-xs">
                  {t("documents.panel.loadFailed")}
                </p>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void load()}
                >
                  {t("documents.retry")}
                </Button>
              </div>
            ) : selected ? (
              <DocumentViewer doc={selected} className="h-full" />
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-xs">
                {t("documents.panel.empty")}
              </div>
            )}
          </div>
        </ConsolePanelContent>
      )}
    </ConsolePanel>
  );
}
