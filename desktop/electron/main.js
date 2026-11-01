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

const { startBackend, stopAll, ROOT, HOST } = require("./backend");

const IS_DEV = process.argv.includes("--dev");
const APP_TITLE = "面试语音助手";
const BUILD_DIR = path.join(__dirname, "..", "build");
const ICON_PATH = path.join(BUILD_DIR, "icon.png");
const TRAY_ICON_PATH = path.join(BUILD_DIR, "tray.png");
const PRELOAD_PATH = path.join(__dirname, "preload.js");

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

function isAppUrl(url) {
  return url.startsWith(`http://${HOST}:`) || url.startsWith("data:");
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
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
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
}

/**
 * 系统音频：浏览器版要用户手动选「整个屏幕 + 共享系统音频」，
 * 桌面端直接给第一块屏幕并附上环回音轨（Windows 上由 Electron 提供）。
 */
function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
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
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    }
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => ALLOWED_PERMISSIONS.has(permission)
  );
  // 不使用摄像头，但模拟面试页会初始化设备；直接拒掉定位、通知之类的杂项。
  session.defaultSession.setDevicePermissionHandler((details) =>
    ["microphone", "camera"].includes(details.deviceType)
  );
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

function openLog() {
  const logPath = backendLogPath();
  if (!logPath) return null;
  try {
    return fs.createWriteStream(logPath, { flags: "w" });
  } catch {
    return null;
  }
}

/** 安装包里的后端与数据目录；开发模式下返回空对象，走项目本身的 .venv。 */
function packagedBackendOptions() {
  if (!app.isPackaged) return {};
  const base = path.join(process.resourcesPath, "backend");
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    python: path.join(
      base,
      "python",
      process.platform === "win32" ? "python.exe" : "python3"
    ),
    script: path.join(base, "server.py"),
    // 配置、档案、问答库、历史都相对工作目录，安装目录是只读的，所以放 userData。
    cwd: dataDir,
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
    backend = await startBackend({ onLog, ...packagedBackendOptions() });
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(backend.url);
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  // 后端日志跟着窗口关闭一起收尾。
  mainWindow?.once("closed", () => log?.end());
}

app.setAppUserModelId("com.fuckinterview.desktop");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.whenReady().then(() => {
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
