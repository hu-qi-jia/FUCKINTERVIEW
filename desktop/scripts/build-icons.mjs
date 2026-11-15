/**
 * 生成设置页「应用图标」的预设图，输出到 desktop/build/icons/*.png。
 *
 * 图标样式来自各品牌公开的 SVG（见 build/icons-src/，来源标注在那里），
 * 合成规则：品牌图标贴在圆角底板上（Chrome 本身是全出血圆形，不加底板）。
 *
 * 用法（依赖 desktop 的 devDependency @resvg/resvg-js）：
 *
 *     node scripts/build-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = join(HERE, "..", "build");
const SRC_DIR = join(BUILD_DIR, "icons-src");
const OUT_DIR = join(BUILD_DIR, "icons");

const SIZE = 256;
const TILE_RADIUS = 56; // 256 下的圆角，约等于 iOS 图标的 22%

const readSource = (name) => readFileSync(join(SRC_DIR, name), "utf8");

/** simple-icons 一类的图标只有一个 <path>，取它的 d 自己填色。 */
const glyphsOf = (svg) =>
  [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1]);

/** 品牌轮廓贴在纯色圆角底板上。inset 是轮廓四周留白的比例。 */
function tiledIcon({ source, background, glyph = "#ffffff", inset = 0.15 }) {
  const side = SIZE * (1 - inset * 2);
  const offset = SIZE * inset;
  const paths = glyphsOf(readSource(source))
    .map((d) => `<path fill="${glyph}" d="${d}"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" rx="${TILE_RADIUS}" fill="${background}"/>` +
    `<svg x="${offset.toFixed(1)}" y="${offset.toFixed(1)}" width="${side.toFixed(1)}" ` +
    `height="${side.toFixed(1)}" viewBox="0 0 24 24">${paths}</svg>` +
    `</svg>`
  );
}

/** Chrome 的官方图标是全出血三色圆，直接整图搬过来。 */
function chromeIcon() {
  const svg = readSource("chrome.svg");
  const inner = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
  // 原图 viewBox="-10 -10 276 276"，收窄一点让圆形几乎顶满画布。
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 268 268">` +
    inner +
    `</svg>`
  );
}

const ICONS = {
  // 全彩 Chrome
  "chrome.png": chromeIcon(),
  // 微信：品牌绿底 + 白色双气泡
  "wechat.png": tiledIcon({
    source: "wechat.svg",
    background: "#07c160",
    inset: 0.12,
  }),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, svg] of Object.entries(ICONS)) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`  ${name}  ${(png.length / 1024).toFixed(1)}KB`);
}
