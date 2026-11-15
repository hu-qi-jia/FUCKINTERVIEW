"use strict";

/**
 * app-icon.js 的单元测试（`npm test` 会跑 electron/*.test.js）。
 *
 * 这里把 electron 换成假的：要验证的是「预设白名单、状态落盘、给界面的描述数据」
 * 这些纯逻辑；把图标真正画到任务栏和托盘上是主进程运行时做的事，
 * 得靠人眼看桌面确认。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const EMPTY_IMAGE = {
  isEmpty: () => true,
  getSize: () => ({ width: 0, height: 0 }),
  resize: () => EMPTY_IMAGE,
  toDataURL: () => "",
  toPNG: () => Buffer.alloc(0),
};

const ctx = {
  userData: fs.mkdtempSync(path.join(os.tmpdir(), "app-icon-test-")),
};

function fakeImage(size = 256) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: size, height: size }),
    resize: () => fakeImage(size),
    toDataURL: () => `data:image/png;base64,${size}`,
    toPNG: () => Buffer.from("fake-png"),
  };
}

const electronStub = {
  app: {
    isPackaged: false,
    getPath: () => ctx.userData,
  },
  nativeImage: {
    // 只有真实存在的文件才算有图，这样能模拟「还没上传自定义图」。
    createFromPath: (file) => (fs.existsSync(file) ? fakeImage() : EMPTY_IMAGE),
    createEmpty: () => EMPTY_IMAGE,
  },
};

const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.exports = electronStub;
electronModule.loaded = true;
require.cache[electronPath] = electronModule;

const APP_ICON_PATH = require.resolve("./app-icon");

/** app-icon.js 会把状态记在模块里，换场景要重新 require。 */
function load() {
  delete require.cache[APP_ICON_PATH];
  return require("./app-icon");
}

function writeState(value) {
  fs.writeFileSync(
    path.join(ctx.userData, "app-icon.json"),
    JSON.stringify(value, null, 2),
    "utf8"
  );
}

test("默认状态：选中应用自己的图标，预设缩略图齐活", () => {
  const appIcon = load();
  const info = appIcon.describe();
  assert.equal(info.preset, "default");
  assert.deepEqual(
    info.presets.map((item) => item.id),
    ["default", "chrome", "wechat"]
  );
  assert.ok(info.presets.every((item) => item.dataUrl));
  assert.equal(info.custom, null);
});

test("切预设会落盘，重开后还是那个预设", () => {
  const appIcon = load();
  assert.equal(appIcon.setPreset("chrome").preset, "chrome");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(ctx.userData, "app-icon.json"), "utf8")),
    { preset: "chrome" }
  );
  assert.equal(load().describe().preset, "chrome");
});

test("不在预设白名单里的 id 被忽略", () => {
  const appIcon = load();
  appIcon.setPreset("chrome");
  assert.equal(appIcon.setPreset("explorer").preset, "chrome");
  assert.equal(appIcon.setPreset("").preset, "chrome");
});

test("没有自定义图时切不到「自定义」", () => {
  const appIcon = load();
  appIcon.setPreset("wechat");
  assert.equal(appIcon.setPreset("custom").preset, "wechat");
});

test("存下自定义图后自动切到「自定义」", () => {
  const appIcon = load();
  const info = appIcon.setCustomImage(fakeImage(512));
  assert.equal(info.preset, "custom");
  assert.ok(info.custom.startsWith("data:image/png;base64,"));
  // 512 的图会被压到 256 边长以内再落盘。
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(ctx.userData, "app-icon.json"), "utf8"))
      .preset,
    "custom"
  );
});

test("状态文件里是不认识的值就退回默认", () => {
  writeState({ preset: "vim" });
  assert.equal(load().describe().preset, "default");
  writeState("not an object");
  assert.equal(load().describe().preset, "default");
});

test("窗体图标和托盘图标都取得到", () => {
  const appIcon = load();
  appIcon.setPreset("wechat");
  assert.equal(appIcon.windowImage().isEmpty(), false);
  assert.equal(appIcon.trayImage().isEmpty(), false);
});
