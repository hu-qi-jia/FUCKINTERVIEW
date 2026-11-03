"use strict";

/**
 * 桌面端入口：Electron 外壳托管本地 Python 服务，
 * 窗口里加载的就是浏览器版同一套前端（http://127.0.0.1:<port>/client/）。
 *
 * 和浏览器版的区别：
 *  - 无边框窗口，标题栏由前端自己画（见 web/client 的 DesktopTitleBar）；
 *  - 点右上角关闭是收进托盘，托盘菜单里才是真的退出；
 *  - 系统音频不再弹共享选择器，主进程直接给屏幕 + 环回音频（Windows）；
 *  - 麦克风等权限由主进程统一放行，不再弹浏览器授权框。
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  desktopCapturer,
  ipcMain,
  nativeImage,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { startBackend, stopAll, ROOT } = require("./backend");
const { createUrlPolicy, normalizeOrigin, safeExternalUrl } = require("./url-policy");

const IS_DEV = process.argv.includes("--dev");
const BUILD_DIR = path.join(__dirname, "..", "build");
const ICON_PATH = path.join(BUILD_DIR, "icon.png");
const TRAY_ICON_PATH = path.join(BUILD_DIR, "tray.png");
const PRELOAD_PATH = path.join(__dirname, "preload.js");

// 开发端和安装版彻底分开：不同的 userData（日志、单实例锁）和默认端口。
// 否则开着安装版时 `npm start` 会把窗口交给安装版实例。
//
// desktop/dist/win-unpacked 里的是「构建产物」，不是安装版：它也是 packaged，
// 但绝不能和安装版共用 userData，否则历史构建一运行就会读写安装版的数据、
// 抢单实例锁。按路径识别后单独放 interview-desktop-build。
const BUILD_TREE_RUN = path
  .normalize(process.execPath)
  .toLowerCase()
  .includes(`${path.sep}dist${path.sep}win-unpacked${path.sep}`);
if (!app.isPackaged || BUILD_TREE_RUN) {
  const userDataDir = path.join(
    app.getPath("appData"),
    BUILD_TREE_RUN ? "interview-desktop-build" : "interview-desktop-dev"
  );
  app.setPath("userData", userDataDir);
  // Chromium 的 localStorage / IndexedDB 走 sessionData，不跟着 userData 自动换；
  // 不显式隔开的话，历史构建会读到安装版记住的页面和麦克风。
  app.setPath("sessionData", path.join(userDataDir, "session"));
}
const DEV_CHANNEL = !app.isPackaged || BUILD_TREE_RUN;
const APP_TITLE = DEV_CHANNEL ? "FUCKINTERVIEW（开发版）" : "FUCKINTERVIEW";
const DEV_PORT = 7870;
const BUILD_PORT = 7871;

/**
 * 安装版从旧名字“面试语音助手”改名为 FUCKINTERVIEW 后，userData 会从
 * %APPDATA%\面试语音助手 变成 %APPDATA%\FUCKINTERVIEW。首次启动时把旧目录里
 * 的业务数据、本地偏好和防截屏设置复制过来，旧目录原样保留。
 * 开发版和构建产物有自己的 userData，不参与这段迁移。
 */
function migrateLegacyUserData() {
  if (!app.isPackaged || BUILD_TREE_RUN) return;
  try {
    const oldRoot = path.join(app.getPath("appData"), "面试语音助手");
    const newRoot = app.getPath("userData");
    if (
      !fs.existsSync(oldRoot) ||
      path.resolve(oldRoot) === path.resolve(newRoot)
    ) {
      return;
    }

    const copyDir = (name) => {
      const source = path.join(oldRoot, name);
      const target = path.join(newRoot, name);
      if (!fs.existsSync(source) || fs.existsSync(target)) return false;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(source, target, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
      return true;
    };
    const copyFile = (name) => {
      const source = path.join(oldRoot, name);
      const target = path.join(newRoot, name);
      if (!fs.existsSync(source) || fs.existsSync(target)) return false;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      return true;
    };

    const copiedData = copyDir("data");
    const copiedPrefs = copyDir("Local Storage");
    const copiedPrivacy = copyFile("privacy.json");
    if (copiedData || copiedPrefs || copiedPrivacy) {
      console.log(`[app] migrated legacy userData: ${oldRoot} -> ${newRoot}`);
    }
  } catch (error) {
    console.error("[app] 迁移旧版 userData 失败", error);
  }
}


/** 主进程允许网页申请的权限：只放行本地界面真正会用到的。 */
const ALLOWED_PERMISSIONS = new Set([
  "media", // 麦克风 / 摄像头
  "audioCapture",
  "videoCapture",
  "display-capture", // getDisplayMedia
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
]);

const LOADING_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #0a0a0a; color: #e5e5e5;
    font: 14px/1.6 system-ui, "Microsoft YaHei", sans-serif;
    -webkit-app-region: drag;
  }
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .ring {
    width: 26px; height: 26px; border-radius: 50%;
    border: 2px solid #2a2a2a; border-top-color: #4ade80;
    animation: spin .9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  p { margin: 0; opacity: .75; }
</style></head>
<body><div class="wrap"><div class="ring"></div><p>正在启动本地服务…</p></div></body></html>`)}`;

let mainWindow = null;
let tray = null;
let backend = null;
let quitting = false; // 用户真的要退出（托盘菜单 / Ctrl+Q）
let cleanedUp = false; // 后端已经收干净，可以放行退出
// 本地服务的精确 Origin（端口是动态的），后端就绪后设置。
const urlPolicy = createUrlPolicy(LOADING_PAGE);

function isAppUrl(url) {
  return urlPolicy.isAppUrl(url);
}

function isAppOrigin(origin) {
  return urlPolicy.isAppOrigin(origin);
}

/** 站外链接只交给系统浏览器打开 http/https，其他协议一律忽略。 */
function openExternalSafely(raw) {
  const target = safeExternalUrl(raw);
  if (target) void shell.openExternal(target);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: APP_TITLE,
    icon: ICON_PATH,
    backgroundColor: "#0a0a0a",
    show: false,
    frame: false, // 标题栏由前端画
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  applyContentProtection(window);
  window.on("page-title-updated", (event) => {
    // 页面里的 <title> 会把窗口标题覆盖成正式名称；开发版/构建版要保留标记。
    event.preventDefault();
    window.setTitle(APP_TITLE);
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  // 右上角关闭 = 收进托盘；真的退出走托盘菜单。
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });

  const sendMaximized = (value) => {
    if (!window.isDestroyed()) window.webContents.send("window:maximized", value);
  };
  window.on("maximize", () => sendMaximized(true));
  window.on("unmaximize", () => sendMaximized(false));

  // 站外链接交给系统浏览器，别把桌面窗口导航走。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow" };
    openExternalSafely(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  void window.loadURL(LOADING_PAGE);
  return window;
}

function showMainWindow() {
  if (!mainWindow) {
    void boot();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApp() {
  quitting = true;
  app.quit();
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示主窗口", click: () => showMainWindow() },
      { type: "separator" },
      { label: "退出", click: () => quitApp() },
    ])
  );
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());
}

function installWindowIpc() {
  const windowOf = (event) => BrowserWindow.fromWebContents(event.sender);

  ipcMain.on("window:minimize", (event) => windowOf(event)?.minimize());
  ipcMain.on("window:toggle-maximize", (event) => {
    const window = windowOf(event);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on("window:close", (event) => windowOf(event)?.close());
  ipcMain.handle(
    "window:is-maximized",
    (event) => windowOf(event)?.isMaximized() ?? false
  );
  ipcMain.handle("privacy:get-content-protection", () => contentProtection);
  ipcMain.handle("privacy:set-content-protection", (event, enabled) => {
    // 只接受主窗口自己的请求；页面导航已被 URL 策略锁在本应用内。
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return contentProtection;
    }
    contentProtection = Boolean(enabled);
    savePrivacySettings();
    applyContentProtection(mainWindow);
    return contentProtection;
  });
}

/**
 * 系统音频：浏览器版要用户手动选「整个屏幕 + 共享系统音频」，
 * 桌面端直接给第一块屏幕并附上环回音轨（Windows 上由 Electron 提供）。
 */
function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      // 只有本应用页面可以拿屏幕 + 系统环回音频，站外页面一律拒绝。
      if (!isAppOrigin(request.securityOrigin)) {
        callback({});
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (!sources.length) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: "loopback" });
      } catch (error) {
        console.error("[display-media] 取屏幕源失败", error);
        callback({});
      }
    },
    { useSystemPicker: false }
  );
}

function installPermissionHandlers() {
  // 权限只给本应用 Origin；请求页的 securityOrigin / requestingUrl 是
  // Electron 解析后的真实来源，不能再靠 webContents 当前 URL 猜。
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const securityOrigin = details?.securityOrigin;
      const requestingUrl = details?.requestingUrl;
      const origin =
        securityOrigin ||
        (requestingUrl ? normalizeOrigin(requestingUrl) : null) ||
        normalizeOrigin(webContents?.getURL() || "");
      callback(isAppOrigin(origin) && ALLOWED_PERMISSIONS.has(permission));
    }
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      const origin =
        requestingOrigin || normalizeOrigin(details?.requestingUrl || "") ||
        normalizeOrigin(webContents?.getURL() || "");
      return isAppOrigin(origin) && ALLOWED_PERMISSIONS.has(permission);
    }
  );
  // 本项目不用 HID / 串口 / USB；一律拒绝（麦克风和摄像头不走这个处理器）。
  session.defaultSession.setDevicePermissionHandler(() => false);
}

function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "文件",
        submenu: [{ label: "退出", accelerator: "Ctrl+Q", click: () => quitApp() }],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo", label: "撤销" },
          { role: "redo", label: "重做" },
          { type: "separator" },
          { role: "cut", label: "剪切" },
          { role: "copy", label: "复制" },
          { role: "paste", label: "粘贴" },
          { role: "selectAll", label: "全选" },
        ],
      },
      {
        label: "视图",
        submenu: [
          { role: "reload", label: "刷新" },
          { role: "toggleDevTools", label: "开发者工具" },
          { type: "separator" },
          { role: "resetZoom", label: "实际大小" },
          { role: "zoomIn", label: "放大" },
          { role: "zoomOut", label: "缩小" },
          { type: "separator" },
          { role: "togglefullscreen", label: "全屏" },
        ],
      },
    ])
  );
}

function backendLogPath() {
  try {
    const dir = app.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "backend.log");
  } catch {
    return null;
  }
}

/**
 * 防截屏/防录屏：Windows 上用 SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
 * 把窗口从系统级画面采集里排除；macOS 用 NSWindowSharingNone。
 * 设置按开发版/构建版/安装版各自的 userData 分别保存。
 */
let contentProtection = false;

function privacyPath() {
  return path.join(app.getPath("userData"), "privacy.json");
}

function loadPrivacySettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(privacyPath(), "utf8"));
    contentProtection = Boolean(parsed?.contentProtection);
  } catch {
    contentProtection = false;
  }
}

function savePrivacySettings() {
  try {
    const file = privacyPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ contentProtection }, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("[privacy] 保存防截屏设置失败", error);
  }
}

function applyContentProtection(window) {
  if (!window || window.isDestroyed()) return;
  try {
    window.setContentProtection(contentProtection);
    console.log(`[privacy] contentProtection=${contentProtection}`);
  } catch (error) {
    console.error("[privacy] 应用防截屏设置失败", error);
  }
}

function openLog() {
  const logPath = backendLogPath();
  if (!logPath) return null;
  try {
    return fs.createWriteStream(logPath, { flags: "w" });
  } catch {
    return null;
  }
}

/** 安装包里的后端与数据目录；开发模式下返回空对象，走项目本身的 .venv 和 config/。 */
function packagedBackendOptions() {
  if (!app.isPackaged) return {};
  const base = path.join(process.resourcesPath, "backend");
  // 开发环境用仓库里的 config/；安装版必须写 userData，安装目录是只读的。
  // 两者用独立目录，互不覆盖。
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    python: path.join(
      base,
      "python",
      process.platform === "win32" ? "python.exe" : "python3"
    ),
    script: path.join(base, "server.py"),
    // 配置、档案、问答库、历史、模型缓存都放 userData（Python 通过这个变量定位）。
    cwd: dataDir,
    env: { INTERVIEW_DATA_DIR: dataDir },
  };
}

/** 前端没构建过就别拉后端了，直接给一句人话。 */
function missingFrontend() {
  const dist = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "web", "client", "dist", "index.html")
    : path.join(ROOT, "web", "client", "dist", "index.html");
  if (fs.existsSync(dist)) return false;
  dialog.showErrorBox(
    "前端还没构建",
    "找不到 web/client/dist/index.html。\n\n先在项目根目录执行：\nnpm --prefix web/client run build\n然后再启动桌面端。"
  );
  return true;
}

async function boot() {
  if (missingFrontend()) {
    app.quit();
    return;
  }

  const log = openLog();
  const onLog = (line) => {
    console.log(line);
    log?.write(`${new Date().toISOString()} ${line}\n`);
  };

  mainWindow = createWindow();

  try {
    const packaged = packagedBackendOptions();
    backend = await startBackend({
      onLog,
      // 开发端 7870、构建产物 7871，安装版仍从 7860 起找空闲端口。
      port: !app.isPackaged ? DEV_PORT : BUILD_TREE_RUN ? BUILD_PORT : undefined,
      ...packaged,
      env: {
        ...(packaged.env || {}),
        INTERVIEW_CHANNEL: DEV_CHANNEL ? "dev" : "production",
      },
    });
  } catch (error) {
    log?.end();
    const logPath = backendLogPath();
    dialog.showErrorBox(
      "本地服务没能启动",
      [
        String(error?.message ?? error),
        logPath ? `\n完整日志：${logPath}` : "",
        `\n项目目录：${ROOT}`,
        "确认 .venv 里的 Python 依赖齐全（pip install -r requirements.txt）。",
      ].join("\n")
    );
    quitting = true;
    app.quit();
    return;
  }

  console.log(`[electron] 后端已就绪：${backend.url}`);
  urlPolicy.setAppOrigin(backend.url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(backend.url);
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  // 后端日志跟着窗口关闭一起收尾。
  mainWindow?.once("closed", () => log?.end());
}

app.setAppUserModelId(
  DEV_CHANNEL ? "com.fuckinterview.desktop.dev" : "com.fuckinterview.desktop"
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.whenReady().then(() => {
    migrateLegacyUserData();
    loadPrivacySettings();
    installPermissionHandlers();
    installDisplayMediaHandler();
    installWindowIpc();
    installMenu();
    createTray();
    void boot();

    app.on("activate", () => showMainWindow());
  });

  app.on("window-all-closed", () => {
    // 关窗只是收进托盘；真正退出由托盘菜单或 Ctrl+Q 触发。
    if (quitting) app.quit();
  });

  app.on("before-quit", (event) => {
    quitting = true;
    if (cleanedUp) return;
    event.preventDefault();
    // 就算后端还没走到「就绪」，也要把已经拉起的进程收掉。
    stopAll().finally(() => {
      cleanedUp = true;
      backend = null;
      app.quit();
    });
  });
}
