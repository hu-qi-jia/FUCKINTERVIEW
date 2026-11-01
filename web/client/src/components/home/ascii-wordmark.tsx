"use client";

import { cn } from "@/lib/utils";

/** 5 行高的方块字，每个字母同宽，拼起来才有齐整的字标。 */
const FONT: Record<string, string[]> = {
  F: ["#####", "#    ", "#### ", "#    ", "#    "],
  U: ["#   #", "#   #", "#   #", "#   #", "#####"],
  C: ["#####", "#    ", "#    ", "#    ", "#####"],
  K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"],
  I: ["#####", "  #  ", "  #  ", "  #  ", "#####"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  E: ["#####", "#    ", "#### ", "#    ", "#####"],
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  V: ["#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "# # #", "## ##", "#   #"],
};
const ROWS = 5;

/** 一个单词的字符画；字母之间留一列空隙。 */
function word(word: string): string[] {
  return Array.from({ length: ROWS }, (_, row) =>
    word
      .split("")
      .map((letter) => FONT[letter]?.[row] ?? "".padEnd(ROWS))
      .join(" ")
  );
}

/**
 * 首页主视觉：用 ASCII 方块字拼出的字标。
 * 一道亮光会缓缓扫过（纯 CSS，`prefers-reduced-motion` 下停住）。
 */
export function AsciiWordmark({ className }: { className?: string }) {
  const lines = [...word("FUCK"), "", ...word("INTERVIEW")];

  return (
    <pre
      aria-hidden
      className={cn(
        "ascii-sweep font-mono text-[clamp(10px,1.3vw,18px)] leading-[1.05] whitespace-pre select-none",
        className
      )}
    >
      {lines.join("\n")}
    </pre>
  );
}
