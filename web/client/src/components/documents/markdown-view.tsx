"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface MarkdownViewProps {
  /** 原文地址（/api/documents/{id}/file）。 */
  src: string;
  className?: string;
}

type State =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error"; kind: "decode" | "other" };

/**
 * Markdown 阅读区：按 UTF-8 解码后渲染 GFM（表格、任务列表等），
 * 不渲染裸 HTML。排版用工具类手写，项目没有引入 typography 插件。
 */
export function MarkdownView({ src, className }: MarkdownViewProps) {
  const { t } = useTranslation();
  const [state, setState] = React.useState<State>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(String(response.status));
        const buffer = await response.arrayBuffer();
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
          if (!cancelled) setState({ status: "error", kind: "decode" });
          return;
        }
        if (!cancelled) setState({ status: "ready", text });
      } catch {
        if (!cancelled) setState({ status: "error", kind: "other" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (state.status === "loading") {
    return (
      <div
        className={cn(
          "text-muted-foreground flex h-full items-center justify-center",
          className,
        )}
      >
        <Spinner className="size-5" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className={cn(
          "text-muted-foreground flex h-full items-center justify-center px-4 text-center text-xs",
          className,
        )}
      >
        {state.kind === "decode"
          ? t("documents.viewer.decodeFailed")
          : t("documents.viewer.error")}
      </div>
    );
  }

  if (!state.text.trim()) {
    return (
      <div
        className={cn(
          "text-muted-foreground flex h-full items-center justify-center text-xs",
          className,
        )}
      >
        {t("documents.viewer.empty")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "scroll-stable h-full min-h-0 overflow-auto",
        className,
      )}
    >
      <article className="mx-auto w-full max-w-[72ch] px-4 py-5 text-sm leading-[1.75]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mt-6 mb-3 text-xl font-semibold first:mt-0">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mt-5 mb-2 text-lg font-semibold">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="mt-4 mb-2 text-base font-semibold">{children}</h3>
            ),
            h4: ({ children }) => (
              <h4 className="mt-3 mb-1.5 text-sm font-semibold">{children}</h4>
            ),
            p: ({ children }) => <p className="my-2.5">{children}</p>,
            ul: ({ children }) => (
              <ul className="my-2.5 list-disc space-y-1 pl-5">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="my-2.5 list-decimal space-y-1 pl-5">{children}</ol>
            ),
            li: ({ children }) => <li className="my-1">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="text-muted-foreground border-border my-3 border-l-2 pl-3">
                {children}
              </blockquote>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {children}
              </a>
            ),
            code: ({ className, children }) => (
              <code
                className={cn(
                  "bg-muted rounded px-1 py-0.5 text-[0.85em]",
                  className,
                )}
              >
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre className="bg-muted/60 my-3 overflow-x-auto rounded-lg p-3 text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">
                {children}
              </pre>
            ),
            table: ({ children }) => (
              <div className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border-border border-b px-2 py-1 text-left font-semibold">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border-border border-b px-2 py-1">{children}</td>
            ),
            img: ({ src: imageSrc, alt }) => (
              // 只支持外链图片：md 里的相对路径无法解析。
              <img
                src={imageSrc}
                alt={alt ?? ""}
                className="my-3 max-w-full rounded-md"
              />
            ),
            hr: () => <hr className="border-border my-6" />,
            strong: ({ children }) => (
              <strong className="font-semibold">{children}</strong>
            ),
          }}
        >
          {state.text}
        </ReactMarkdown>
      </article>
    </div>
  );
}
