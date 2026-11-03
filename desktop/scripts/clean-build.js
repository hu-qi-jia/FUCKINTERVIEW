"use strict";

/**
 * 清理构建产物。默认清掉 dist、resources/backend 和 .tmp；也可以只传名字：
 *   node scripts/clean-build.js dist
 *
 * 只允许清理 desktop/ 下的已知路径，避免误删。
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const KNOWN = {
  dist: "dist",
  backend: path.join("resources", "backend"),
  tmp: ".tmp",
};

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(KNOWN);

for (const name of names) {
  const relative = KNOWN[name] || name;
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    throw new Error(`拒绝清理 desktop/ 之外的路径：${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
}
