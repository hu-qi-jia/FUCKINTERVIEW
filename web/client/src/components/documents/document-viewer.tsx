"use client";

import * as React from "react";

import { Spinner } from "@/components/ui/spinner";
import { documentFileUrl, type OtherDocument } from "@/lib/documents";

// pdf.js 和 markdown 渲染器都只在这两个阅读器里用得到，按需加载，
// 不让首页和实时面试的首次加载背上这两个大块头。
const PdfViewer = React.lazy(() =>
  import("@/components/documents/pdf-viewer").then((module) => ({
    default: module.PdfViewer,
  })),
);
const MarkdownView = React.lazy(() =>
  import("@/components/documents/markdown-view").then((module) => ({
    default: module.MarkdownView,
  })),
);

/**
 * 资料预览的统一入口：按扩展名分派到 PDF 或 Markdown 阅读器。
 * 管理页预览和实时面试面板共用这一份。
 */
export function DocumentViewer({
  doc,
  className,
}: {
  doc: OtherDocument;
  className?: string;
}) {
  const src = documentFileUrl(doc.id);
  return (
    <React.Suspense
      fallback={
        <div className="text-muted-foreground flex h-full items-center justify-center">
          <Spinner className="size-5" />
        </div>
      }
    >
      {doc.ext === "pdf" ? (
        <PdfViewer key={doc.id} src={src} className={className} />
      ) : (
        <MarkdownView key={doc.id} src={src} className={className} />
      )}
    </React.Suspense>
  );
}
