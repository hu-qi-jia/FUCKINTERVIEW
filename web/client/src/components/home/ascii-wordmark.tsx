"use client";

import { cn } from "@/lib/utils";

/**
 * 4 行高的细线字库（figlet「small」风格）：用 `_ | / \` 勾边，比实心方块字轻。
 * 每个字形自己补齐到等宽，拼起来才对齐。
 */
const FONT: Record<string, string[]> = {
  F: [" ___ ", "| __|", "| _| ", "|_|  "],
  U: [" _   _ ", "| | | |", "| |_| |", " \\___/ "],
  C: ["  ___ ", " / __|", "| (__ ", " \\___|"],
  K: [" _  __", "| |/ /", "| ' < ", "|_|\\_\\"],
  I: [" ___ ", "|_ _|", " | | ", "|___|"],
  N: [" _  _ ", "| \\| |", "| .` |", "|_|\\_|"],
  T: [" _____ ", "|_   _|", "  | |  ", "  |_|  "],
  E: [" ___ ", "| __|", "| _| ", "|___|"],
  R: [" ___ ", "| _ \\", "|   /", "|_|_\\"],
  V: ["__   __", "\\ \\ / /", " \\ V / ", "  \\_/  "],
  W: ["__      __", "\\ \\    / /", " \\ \\/\\/ / ", "  \\_/\\_/  "],
};
const ROWS = 4;
const NAME = "FUCKINTERVIEW";

/** 一行里的第 row 行；字库缺字就留白，不会把排版挤歪。 */
function lineAt(row: number): string {
  return NAME.split("")
    .map((letter) => FONT[letter]?.[row] ?? "")
    .join("");
}

/**
 * 首页主视觉：用 ASCII 细线字拼出的字标，单行排开。
 * 字号跟着所在栏宽的 `cqw` 走，多宽的窗口都是一行放得下；
 * 一道高光缓缓扫过（纯 CSS，`prefers-reduced-motion` 下停住）。
 */
export function AsciiWordmark({ className }: { className?: string }) {
  const lines = Array.from({ length: ROWS }, (_, row) => lineAt(row));

  return (
    <pre
      aria-hidden
      className={cn(
        "ascii-sweep font-mono text-[clamp(7px,2.2cqw,15px)] leading-[1.05] whitespace-pre select-none",
        className
      )}
    >
      {lines.join("\n")}
    </pre>
  );
}
