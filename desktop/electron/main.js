"use strict";

/**
 * 桌面端入口：Electron 外壳托管本地 Python 服务，
 * 窗口里加载的就是浏览器版同一套前端（http://127.0.0.1:<port>/client/）。
 *
 * 和浏览器版的区别只有两处：
 *  - 系统音频不再弹共享选择器，直接由主进程给屏幕 + 环回音频（Windows 支持）；
 *  - 麦克风等权限由主进程统一放行，不再弹浏览器授权框。
 */

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  desktopCapturer,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { startBackend, stopBackend, ROOT, HOST } = require("./backend");

const IS_DEV = process.argv.includes("--dev");
const APP_TITLE = "面试语音助手";

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
let backend = null;
let quitting = false;

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
    backgroundColor: "#0a0a0a",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
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
        submenu: [{ role: "quit", label: "退出" }],
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

async function boot() {
  const log = openLog();
  const onLog = (line) => {
    console.log(line);
    log?.write(`${new Date().toISOString()} ${line}\n`);
  };

  mainWindow = createWindow();

  try {
    backend = await startBackend({ onLog });
  } catch (error) {
    log?.end();
    const logPath = backendLogPath();
    dialog.showErrorBox(
      "本地服务没能启动",
      [
        String(error?.message ?? error),
        logPath ? `\n完整日志：${logPath}` : "",
        `\n项目目录：${ROOT}`,
        "确认已执行 npm --prefix web/client run build，并且 .venv 里有依赖。",
      ].join("\n")
    );
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    installPermissionHandlers();
    installDisplayMediaHandler();
    installMenu();
    void boot();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void boot();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (quitting || !backend) return;
    quitting = true;
    event.preventDefault();
    stopBackend(backend.child).finally(() => {
      backend = null;
      app.quit();
    });
  });
}
