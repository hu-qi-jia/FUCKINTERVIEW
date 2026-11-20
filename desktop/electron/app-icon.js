"use strict";

/**
 * 「应用图标」：设置里可以给任务栏和托盘换一个不那么显眼的图标，
 * 投屏时不容易暴露本应用。
 *
 * 预设图是 build/icons/ 下的 PNG（安装包里被 extraResources 拷到
 * resources/icons/），当前选择和自定义图存在 userData 下；开发版、
 * 构建产物、安装版各有各的 userData，互不干扰。
 *
 * 渲染进程只能指定预设 id，或者把文件选择框交给主进程去开，
 * 拿不到任意路径，也没有直接写盘的能力。
 */

const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");

const { applyTaskbarIcon } = require("./shortcut-icon");

/** 设置页里能选的预设；"default" 就是应用自己的图标。 */
const PRESETS = ["chrome", "wechat"];
const DEFAULT = "default";
const CUSTOM = "custom";
const VALID = new Set([DEFAULT, ...PRESETS, CUSTOM]);

/** 托盘图标尺寸；Windows 上 32px 覆盖 100%–200% 缩放都够用。 */
const TRAY_SIZE = 32;
/** 自定义图最大边长，再大就缩下来，免得 userData 里躺一张 4K 图。 */
const MAX_EDGE = 256;

/**
 * 设置页预览缩略图的边长。
 *
 * 早先 describe() 把**原图整张**转 base64 塞进 React state：默认图标是
 * 512×512，光它就约 220KB，而界面上只画 36px 的方块。更要命的是点一次图标
 * 就把三张图全部重新读盘、解码、编码一遍——这就是设置页点图标卡顿的来源。
 * 缩到 64px 足够任何 DPI 下画 36px 的方块，体积小两个数量级。
 */
const THUMB_EDGE = 64;

const ASSET_DIR = app.isPackaged
  ? process.resourcesPath
  : path.join(__dirname, "..", "build");

function presetDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icons")
    : path.join(ASSET_DIR, "icons");
}

/** 应用自带的两张图：窗体用 icon.png，托盘用 tray.png。 */
function builtinPath(kind) {
  return path.join(ASSET_DIR, kind === "tray" ? "tray.png" : "icon.png");
}

function stateFile() {
  return path.join(app.getPath("userData"), "app-icon.json");
}

function customFile() {
  return path.join(app.getPath("userData"), "custom-icon.png");
}

function loadImage(file) {
  try {
    const image = nativeImage.createFromPath(file);
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const preset = String(parsed?.preset || "");
    return { preset: VALID.has(preset) ? preset : DEFAULT };
  } catch {
    return { preset: DEFAULT };
  }
}

function saveState(next) {
  try {
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  } catch (error) {
    console.error("[app-icon] 保存图标设置失败", error);
  }
}

let state = null;

function getState() {
  if (!state) state = loadState();
  return state;
}

// 原图按 preset 缓存：apply()、applyTaskbar()、describe() 都要用，
// 每次都去读盘解码太浪费。写入自定义图时把 custom 那条清掉。
const imageCache = new Map();
// 缩略图只在自定义图变化时重建；预设图是随包发布的，从不变。
let thumbCache = null;

function invalidateImages() {
  imageCache.delete(CUSTOM);
  thumbCache = null;
}

/** 预设 id（或 custom）对应的原图。 */
function sourceImage(preset) {
  if (imageCache.has(preset)) return imageCache.get(preset);
  let image = null;
  if (preset === CUSTOM) image = loadImage(customFile());
  else if (preset === DEFAULT) image = loadImage(builtinPath("icon"));
  else image = loadImage(path.join(presetDir(), `${preset}.png`));
  imageCache.set(preset, image);
  return image;
}

function thumbDataUrl(image) {
  if (!image) return null;
  const { width, height } = image.getSize();
  const longest = Math.max(width, height);
  const scaled =
    longest > THUMB_EDGE
      ? image.resize(
          width >= height
            ? { width: THUMB_EDGE, quality: "good" }
            : { height: THUMB_EDGE, quality: "good" }
        )
      : image;
  return scaled.toDataURL();
}

function thumbnails() {
  if (thumbCache) return thumbCache;
  const customImage = loadImage(customFile());
  thumbCache = {
    presets: [DEFAULT, ...PRESETS].map((id) => ({
      id,
      dataUrl: thumbDataUrl(sourceImage(id)),
    })),
    custom: thumbDataUrl(customImage),
    hasCustom: Boolean(customImage),
  };
  return thumbCache;
}

/** 窗体 / 任务栏用的大图。 */
function windowImage() {
  return sourceImage(getState().preset) || loadImage(builtinPath("icon")) || nativeImage.createEmpty();
}

/** 托盘用的小图；预设和自定义图统一缩到 TRAY_SIZE，保持观感一致。 */
function trayImage() {
  const preset = getState().preset;
  if (preset === DEFAULT) {
    return loadImage(builtinPath("tray")) || windowImage();
  }
  const image = sourceImage(preset);
  if (!image) return loadImage(builtinPath("tray")) || nativeImage.createEmpty();
  return image.resize({ width: TRAY_SIZE, quality: "best" });
}

/**
 * 发给设置页的预览：预设缩略图 + 当前自定义图。
 *
 * 缩略图是缓存的，所以 dataUrl 每次都是同一串字符——渲染进程那边 `<img>`
 * 的 src 不变就不会重新解码重绘。只有 preset 会变，那是我们要的。
 */
function describe() {
  const thumbs = thumbnails();
  return {
    preset: getState().preset,
    presets: thumbs.presets,
    custom: thumbs.custom,
  };
}

function setPreset(id) {
  const value = String(id || "");
  if (!VALID.has(value)) return describe();
  // 还没上传过自定义图就别切过去，避免图标变回默认却以为选中了自定义。
  if (value === CUSTOM && !thumbnails().hasCustom) return describe();
  state = { preset: value };
  saveState(state);
  return describe();
}

/** 存一张图当自定义图标并切过去；返回 null 表示失败。 */
function setCustomImage(image) {
  if (!image || image.isEmpty()) return null;
  try {
    const { width, height } = image.getSize();
    const longest = Math.max(width, height);
    const scaled =
      longest > MAX_EDGE
        ? image.resize(
            width >= height
              ? { width: MAX_EDGE, quality: "best" }
              : { height: MAX_EDGE, quality: "best" }
          )
        : image;
    const file = customFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, scaled.toPNG());
    state = { preset: CUSTOM };
    saveState(state);
    invalidateImages();
    return describe();
  } catch (error) {
    console.error("[app-icon] 保存自定义图标失败", error);
    return null;
  }
}

/** 从图片文件取图标；读不出来返回 null，调用方保持原状。 */
function setFromFilePath(filePath) {
  const target = String(filePath || "");
  if (!target || !fs.existsSync(target)) return null;
  try {
    return setCustomImage(nativeImage.createFromPath(target));
  } catch (error) {
    console.error("[app-icon] 读取图标失败", target, error);
    return null;
  }
}

/**
 * 把当前图标套到窗体上（Alt-Tab / 标题栏那个，立即生效）。
 *
 * **托盘不在这里**：换图标时托盘保持原样，重启后才变。托盘常驻在投屏视野里，
 * 改它的那一刻反而最容易暴露；而 createTray() 启动时本来就是从持久化状态读
 * 图的，不往里传它，自然就变成「重启后生效」。
 */
function apply({ window } = {}) {
  try {
    if (window && !window.isDestroyed()) window.setIcon(windowImage());
  } catch (error) {
    console.error("[app-icon] 应用窗体图标失败", error);
  }
}

/**
 * 任务栏那一路要改快捷方式，而且重启后才生效。
 * 「默认」就是把快捷方式指回 exe，也就是恢复出厂图标。
 *
 * 这活儿要起 PowerShell（冷启动 300ms 起）再走 COM，慢。放在点击的关键路径
 * 上会让界面卡住半秒到两秒，所以调用方**不要 await** 它。这里再把调用串成
 * 一列：连着点几下只会有一个 PowerShell 在跑，而且每次都取当下的状态——
 * 跑得慢的旧任务最终也落到最新那个图标上。
 */
let taskbarQueue = Promise.resolve();

function applyTaskbar() {
  taskbarQueue = taskbarQueue.then(async () => {
    const preset = getState().preset;
    const image = preset === DEFAULT ? null : sourceImage(preset);
    try {
      return await applyTaskbarIcon(image);
    } catch (error) {
      console.error("[app-icon] 应用任务栏图标失败", error);
      return 0;
    }
  });
  return taskbarQueue;
}

module.exports = {
  PRESETS,
  DEFAULT,
  CUSTOM,
  apply,
  applyTaskbar,
  describe,
  setFromFilePath,
  setCustomImage,
  setPreset,
  trayImage,
  windowImage,
};
