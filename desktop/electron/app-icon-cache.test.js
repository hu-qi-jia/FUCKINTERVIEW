"use strict";

/**
 * 图标切换的性能回归测试。
 *
 * 背景：设置页点一个图标要呆半秒到两秒。两个原因——
 *
 *   (1) 每次点击都把三四张**全尺寸** PNG 重新读盘、解码、编码成 base64
 *       （默认图标 512×512，光它就约 220KB，而界面上只画 36px 的方块）；
 *   (2) 点击的关键路径上要起 PowerShell 去改快捷方式，并且要等它跑完才回话。
 *
 * (2) 由 desktop/electron/main.js 保证不 await（applyTaskbar 在后台跑），
 * 这里守住 (1)：缩略图和原图都必须缓存，第二次点击开始不能再有读盘/编码开销。
 *
 * 这些断言盯的是**调用次数**而不是耗时——耗时在不同机器上会飘，调用次数不会。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const stats = { createFromPath: 0, toDataURL: 0, resize: 0 };
const reset = () => {
  stats.createFromPath = 0;
  stats.toDataURL = 0;
  stats.resize = 0;
};

const EMPTY_IMAGE = {
  isEmpty: () => true,
  getSize: () => ({ width: 0, height: 0 }),
  resize: () => EMPTY_IMAGE,
  toDataURL: () => "",
  toPNG: () => Buffer.alloc(0),
};

function fakeImage(size = 256) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: size, height: size }),
    resize: () => {
      stats.resize += 1;
      return fakeImage(size);
    },
    toDataURL: () => {
      stats.toDataURL += 1;
      return `data:image/png;base64,${"x".repeat(2048)}`;
    },
    toPNG: () => Buffer.from("fake-png"),
  };
}

const ctx = {
  userData: fs.mkdtempSync(path.join(os.tmpdir(), "app-icon-perf-")),
};

const electronStub = {
  app: {
    isPackaged: false,
    getPath: () => ctx.userData,
  },
  nativeImage: {
    createFromPath: (file) => {
      stats.createFromPath += 1;
      return fs.existsSync(file) ? fakeImage() : EMPTY_IMAGE;
    },
    createEmpty: () => EMPTY_IMAGE,
  },
};

const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.exports = electronStub;
electronModule.loaded = true;
require.cache[electronPath] = electronModule;

const APP_ICON_PATH = require.resolve("./app-icon");

/** app-icon.js 的缓存和状态都挂在模块上，每个用例要一份干净的。 */
function load() {
  delete require.cache[APP_ICON_PATH];
  reset();
  return require("./app-icon");
}

test("缩略图只在第一次 describe 时编码，之后命中缓存", () => {
  const appIcon = load();
  appIcon.describe();
  const first = stats.toDataURL;
  assert.ok(first > 0, "第一次要生成缩略图");
  appIcon.describe();
  appIcon.describe();
  assert.equal(stats.toDataURL, first, "第二次开始不该再编码缩略图");
});

test("切预设不重新编码，缩略图是同一串字符", () => {
  const appIcon = load();
  const before = appIcon.describe();
  reset();
  const after = appIcon.setPreset("chrome");
  assert.equal(stats.toDataURL, 0, "切预设不该重新编码缩略图");
  // dataUrl 一模一样，渲染层的 <img src> 才不会变，也就不会重新解码重绘。
  assert.deepEqual(after.presets, before.presets);
  assert.equal(after.preset, "chrome");
});

test("连点几下也不累积读盘和编码", () => {
  const appIcon = load();
  appIcon.describe();
  reset();
  for (const id of ["chrome", "wechat", "default", "chrome", "wechat", "default"]) {
    appIcon.setPreset(id);
    appIcon.describe();
  }
  assert.equal(stats.toDataURL, 0, "缩略图全程命中缓存");
  assert.equal(stats.createFromPath, 0, "原图也不该重复读盘");
});

test("窗体图标和 apply 走原图缓存", () => {
  const appIcon = load();
  appIcon.windowImage();
  reset();
  appIcon.windowImage();
  appIcon.apply({
    window: { isDestroyed: () => false, setIcon: () => {} },
  });
  assert.equal(stats.createFromPath, 0, "apply 不该再去读盘解码");
});

test("换了自定义图之后缓存要失效", () => {
  const appIcon = load();
  const before = appIcon.describe();
  assert.equal(before.custom, null, "还没上传过自定义图");

  reset();
  appIcon.setCustomImage(fakeImage(512));
  assert.ok(stats.toDataURL > 0, "新图要重新生成缩略图");

  const after = appIcon.describe();
  assert.ok(after.custom, "自定义缩略图出来了");
  assert.equal(after.preset, "custom");
});

test("一千次切换的开销要可忽略（这里只兜个大数，真正的量级看上面的调用次数）", () => {
  const appIcon = load();
  appIcon.describe(); // 预热缩略图缓存
  reset();
  const started = process.hrtime.bigint();
  for (let i = 0; i < 1000; i += 1) {
    appIcon.setPreset(i % 2 ? "chrome" : "wechat");
    appIcon.describe();
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  // 阈值故意放宽：这里守的是「缓存退化」（那会慢一到两个数量级），
  // 不是微基准。剩下的开销是每次点击同步写一次 app-icon.json，约 1ms。
  assert.ok(ms < 3000, `1000 次切换花了 ${ms.toFixed(1)}ms，缓存多半没生效`);
  assert.equal(stats.toDataURL, 0);
  console.log(`      1000 次切换 ${ms.toFixed(1)}ms（平均 ${(ms / 1000).toFixed(2)}ms/次）`);
});
