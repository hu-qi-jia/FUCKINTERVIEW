"use client";

import wordmark from "@/assets/wordmark.svg";
import { cn } from "@/lib/utils";

/**
 * 首页主视觉：设计稿导出的 SVG 字标（`src/assets/wordmark.svg`，610×64）。
 *
 * 宽度占所在那一栏的 75%，高度按 610:64 自动算，所以窗口怎么拉都等比例缩放。
 * 不直接把图贴上去，而是拿它当遮罩、底下填当前主题的前景色：
 * 深色主题下是白色，浅色主题下是近黑色，两个主题都不用另出一版图。
 * 换图只要用同名 svg 覆盖 `src/assets/wordmark.svg`，这里改一下比例即可。
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-foreground block aspect-[610/64] w-[75%] select-none",
        className
      )}
      style={{
        maskImage: `url("${wordmark}")`,
        WebkitMaskImage: `url("${wordmark}")`,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}
