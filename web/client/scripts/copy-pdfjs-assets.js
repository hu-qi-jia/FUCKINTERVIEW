/**
 * 把 pdf.js 的运行时资源（CMap、标准字体、wasm、ICC）复制到 public/pdfjs。
 *
 * pdf.js 按固定目录结构按需拉取这些文件，Vite 打包时不会自动带上；放在
 * public 下由 Vite 原样复制，dev 和 build 都能直接访问。
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "pdfjs-dist");
const target = join(root, "public", "pdfjs");

for (const name of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = join(source, name);
  if (!existsSync(from)) continue;
  rmSync(join(target, name), { recursive: true, force: true });
  cpSync(from, join(target, name), { recursive: true });
}
