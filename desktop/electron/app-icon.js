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

/** 设置页里能选的预设；"default" 就是应用自己的图标。 */
const PRESETS = ["chrome", "wechat"];
const DEFAULT = "default";
const CUSTOM = "custom";
const VALID = new Set([DEFAULT, ...PRESETS, CUSTOM]);

/** 托盘图标尺寸；Windows 上 32px 覆盖 100%–200% 缩放都够用。 */
const TRAY_SIZE = 32;
/** 自定义图最大边长，再大就缩下来，免得 userData 里躺一张 4K 图。 */
const MAX_EDGE = 256;

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

/** 预设 id（或 custom）对应的原图。 */
function sourceImage(preset) {
  if (preset === CUSTOM) return loadImage(customFile());
  if (preset === DEFAULT) return loadImage(builtinPath("icon"));
  return loadImage(path.join(presetDir(), `${preset}.png`));
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

/** 发给设置页的预览：预设缩略图 + 当前自定义图。 */
function describe() {
  const presets = [DEFAULT, ...PRESETS].map((id) => {
    const image =
      id === DEFAULT
        ? loadImage(builtinPath("icon"))
        : loadImage(path.join(presetDir(), `${id}.png`));
    return { id, dataUrl: image ? image.toDataURL() : null };
  });
  return {
    preset: getState().preset,
    presets,
    custom: (() => {
      const image = loadImage(customFile());
      return image ? image.toDataURL() : null;
    })(),
  };
}

function setPreset(id) {
  const value = String(id || "");
  if (!VALID.has(value)) return describe();
  // 还没上传过自定义图就别切过去，避免图标变回默认却以为选中了自定义。
  if (value === CUSTOM && !loadImage(customFile())) return describe();
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

/** 把当前图标套到窗体和托盘上；两者可能有一个还没建好。 */
function apply({ window, tray } = {}) {
  try {
    if (window && !window.isDestroyed()) window.setIcon(windowImage());
  } catch (error) {
    console.error("[app-icon] 应用窗体图标失败", error);
  }
  try {
    if (tray) tray.setImage(trayImage());
  } catch (error) {
    console.error("[app-icon] 应用托盘图标失败", error);
  }
}

module.exports = {
  PRESETS,
  DEFAULT,
  CUSTOM,
  apply,
  describe,
  setFromFilePath,
  setCustomImage,
  setPreset,
  trayImage,
  windowImage,
};
