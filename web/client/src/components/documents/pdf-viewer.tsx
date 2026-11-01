"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// 档位是「相对适应宽度」的倍数：100% 就是铺满可用宽度，50% 是它的一半。
// 这样不管 PDF 原始页面多大，百分比看到的都是屏幕上的实际比例。
const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const PAGE_PADDING = 24;

type ZoomMode = "fit" | number;

/**
 * pdf.js 按固定目录结构按需拉 CMap、标准字体、wasm 和 ICC 配置。
 * 这些文件由 scripts/copy-pdfjs-assets.js 放进 public/pdfjs。
 */
function assetUrl(path: string): string {
  return new URL(`pdfjs/${path}`, new URL(".", document.baseURI)).toString();
}

/** 「适应宽度」等价于 100%；从一个档位往上/下走一格。 */
function nextZoom(current: ZoomMode, direction: 1 | -1): ZoomMode {
  const value = current === "fit" ? 1 : current;
  const index = ZOOM_LEVELS.findIndex((step) => Math.abs(step - value) < 0.001);
  const base = index === -1 ? ZOOM_LEVELS.indexOf(1) : index;
  const next = Math.min(
    ZOOM_LEVELS.length - 1,
    Math.max(0, base + direction),
  );
  return ZOOM_LEVELS[next];
}

/** 档位换算成相对适应宽度的倍数。 */
function zoomFactor(zoom: ZoomMode): number {
  return zoom === "fit" ? 1 : zoom;
}

export interface PdfViewerProps {
  /** 原件地址（/api/documents/{id}/file）。 */
  src: string;
  className?: string;
}

/**
 * 单页 PDF 阅读器：只渲染当前页的 canvas，工具栏翻页与缩放，放大后可按住
 * 左键拖拽平移。刻意不做文字层——面试场景只需要看，不需要框选复制。
 */
export function PdfViewer({ src, className }: PdfViewerProps) {
  const { t } = useTranslation();
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorKind, setErrorKind] = React.useState<"password" | "other">(
    "other",
  );
  const [pageCount, setPageCount] = React.useState(0);
  const [pageNumber, setPageNumber] = React.useState(1);
  const [pageInput, setPageInput] = React.useState("1");
  const [zoom, setZoom] = React.useState<ZoomMode>("fit");
  const [box, setBox] = React.useState({ width: 0, height: 0 });

  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const anchorRef = React.useRef<{
    x: number;
    y: number;
    ratio: number;
  } | null>(null);
  const dragRef = React.useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  // -- 载入文档 --------------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setPdf(null);
    setPageCount(0);
    setPageNumber(1);
    setPageInput("1");

    const task = pdfjs.getDocument({
      url: src,
      cMapUrl: assetUrl("cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: assetUrl("standard_fonts/"),
      wasmUrl: assetUrl("wasm/"),
      iccUrl: assetUrl("iccs/"),
    });
    task.promise
      .then((document) => {
        if (cancelled) return;
        setPdf(document);
        setPageCount(document.numPages);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorKind(
          (error as { name?: string } | null)?.name === "PasswordException"
            ? "password"
            : "other",
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [src]);

  // -- 容器尺寸：适应宽度跟着面板大小走 --------------------------------------
  React.useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // -- 渲染当前页 ------------------------------------------------------------
  React.useEffect(() => {
    const document = pdf;
    const canvas = canvasRef.current;
    if (!document || !canvas || box.width <= 0) return;

    let cancelled = false;
    let task: RenderTask | undefined;

    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const fit = Math.max((box.width - PAGE_PADDING * 2) / base.width, 0.1);
        const scale = fit * zoomFactor(zoom);

        const viewport = page.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const anchor = anchorRef.current;
        if (anchor && viewportRef.current) {
          anchorRef.current = null;
          const element = viewportRef.current;
          element.scrollLeft =
            (element.scrollLeft + anchor.x) * anchor.ratio - anchor.x;
          element.scrollTop =
            (element.scrollTop + anchor.y) * anchor.ratio - anchor.y;
        }

        task = page.render({
          canvas,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        await task.promise;
      } catch (error) {
        if (cancelled) return;
        if ((error as { name?: string } | null)?.name === "RenderingCancelledException")
          return;
        setStatus("error");
        setErrorKind("other");
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, zoom, box.width, box.height]);

  // -- 缩放：Ctrl + 滚轮，以光标为中心 --------------------------------------
  React.useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const next = nextZoom(zoom, direction);
      const current = zoomFactor(zoom);
      const rect = element.getBoundingClientRect();
      anchorRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        ratio: zoomFactor(next) / current,
      };
      setZoom(next);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoom]);

  const goToPage = React.useCallback(
    (value: number) => {
      const next = Math.min(Math.max(value, 1), Math.max(pageCount, 1));
      setPageNumber(next);
      setPageInput(String(next));
      viewportRef.current?.scrollTo({ top: 0, left: 0 });
    },
    [pageCount],
  );

  const commitPage = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    goToPage(Number.isFinite(parsed) ? parsed : pageNumber);
  };

  const stepZoom = (direction: 1 | -1) => {
    const element = viewportRef.current;
    const next = nextZoom(zoom, direction);
    if (element) {
      anchorRef.current = {
        x: element.clientWidth / 2,
        y: element.clientHeight / 2,
        ratio: zoomFactor(next) / zoomFactor(zoom),
      };
    }
    setZoom(next);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = viewportRef.current;
    if (!element || event.button !== 0 || zoomFactor(zoom) <= 1) return;
    if (
      element.scrollWidth <= element.clientWidth &&
      element.scrollHeight <= element.clientHeight
    ) {
      return;
    }
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    };
    element.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = viewportRef.current;
    const drag = dragRef.current;
    if (!element || !drag) return;
    element.scrollLeft = drag.left - (event.clientX - drag.x);
    element.scrollTop = drag.top - (event.clientY - drag.y);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    viewportRef.current?.releasePointerCapture(event.pointerId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      goToPage(pageNumber - 1);
    } else if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      goToPage(pageNumber + 1);
    }
  };

  const zoomLabel =
    zoomFactor(zoom) === 1
      ? t("documents.viewer.fitWidth")
      : `${Math.round(zoomFactor(zoom) * 100)}%`;
  const zoomedIn = zoomFactor(zoom) > 1;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {status !== "error" && (
        <div className="flex shrink-0 items-center gap-1 border-b px-1.5 py-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("documents.viewer.previousPage")}
            disabled={status !== "ready" || pageNumber <= 1}
            onClick={() => goToPage(pageNumber - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <div className="flex items-center gap-1 text-xs">
            <Input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={(event) => commitPage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitPage(event.currentTarget.value);
              }}
              disabled={status !== "ready"}
              inputMode="numeric"
              aria-label={t("documents.viewer.pageInput")}
              className="h-6 w-10 px-1 text-center text-xs"
            />
            <span className="text-muted-foreground whitespace-nowrap">
              / {pageCount || "–"}
            </span>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("documents.viewer.nextPage")}
            disabled={status !== "ready" || pageNumber >= pageCount}
            onClick={() => goToPage(pageNumber + 1)}
          >
            <ChevronRightIcon />
          </Button>

          <div className="ml-auto flex items-center gap-0.5">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("documents.viewer.zoomOut")}
              disabled={
                status !== "ready" ||
                zoomFactor(zoom) <= ZOOM_LEVELS[0]
              }
              onClick={() => stepZoom(-1)}
            >
              <MinusIcon />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 min-w-14 px-1 text-xs font-normal"
              onClick={() => setZoom("fit")}
              title={t("documents.viewer.fitWidth")}
            >
              {zoomLabel}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("documents.viewer.zoomIn")}
              disabled={
                status !== "ready" ||
                zoomFactor(zoom) >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
              }
              onClick={() => stepZoom(1)}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
      )}

      <div
        ref={viewportRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label={t("documents.viewer.canvas")}
        className={cn(
          "scroll-stable relative min-h-0 flex-1 overflow-auto outline-none",
          zoomedIn && "cursor-grab active:cursor-grabbing",
        )}
      >
        {status === "error" ? (
          <div className="text-muted-foreground flex h-full min-h-24 items-center justify-center px-4 text-center text-xs">
            {errorKind === "password"
              ? t("documents.viewer.password")
              : t("documents.viewer.error")}
          </div>
        ) : (
          <div className="flex min-h-full w-max min-w-full items-center justify-center p-3">
            <canvas
              ref={canvasRef}
              className="ring-foreground/10 rounded-sm shadow-sm ring-1"
            />
          </div>
        )}
        {status === "loading" && (
          <div className="bg-background/60 absolute inset-0 flex items-center justify-center">
            <Spinner className="size-5" />
          </div>
        )}
      </div>
    </div>
  );
}
