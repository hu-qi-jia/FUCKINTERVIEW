"use client";

import wordmark from "@/assets/wordmark.svg";
import { cn } from "@/lib/utils";

/**
 * 首页主视觉：设计稿导出的 SVG 字标（`src/assets/wordmark.svg`，610×64）。
 *
 * 宽度铺满所在那一栏，高度按 610:64 自动算，所以窗口怎么拉都等比例缩放。
 * 不直接把图贴上去，而是拿它当遮罩、底下铺品牌绿的渐变：这样深色和浅色
 * 主题都不用另出一版图，原来那道从左扫到右的高光也还在。
 * 换图只要用同名 svg 覆盖 `src/assets/wordmark.svg`，这里改一下比例即可。
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "wordmark-sweep block aspect-[610/64] w-[86%] select-none",
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
