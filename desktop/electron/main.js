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
  nativeTheme,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { startBackend, stopAll, ROOT } = require("./backend");
const appIcon = require("./app-icon");
const { createUrlPolicy, normalizeOrigin, safeExternalUrl } = require("./url-policy");

const IS_DEV = process.argv.includes("--dev");
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

/**
 * 启动页：本地服务还没起来时先给一屏。
 *
 * 跟着亮暗设置走——渲染进程把主题写进 userData 的 appearance.json
 * （改主题和每次启动都写一份），没写过就退回系统主题。
 * 中间是当前应用图标，慢慢淡进去；服务就绪后整屏淡出再换成正式界面。
 */
let appearanceTheme = "system";

function appearancePath() {
  return path.join(app.getPath("userData"), "appearance.json");
}

function loadAppearance() {
  try {
    const parsed = JSON.parse(fs.readFileSync(appearancePath(), "utf8"));
    appearanceTheme =
      parsed?.theme === "light" || parsed?.theme === "dark"
        ? parsed.theme
        : "system";
  } catch {
    appearanceTheme = "system";
  }
}

function saveAppearance() {
  try {
    const file = appearancePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ theme: appearanceTheme }, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("[appearance] 保存主题设置失败", error);
  }
}

function splashPrefersDark() {
  if (appearanceTheme === "dark") return true;
  if (appearanceTheme === "light") return false;
  return nativeTheme.shouldUseDarkColors;
}

/** 启动页上那枚图标：按当前（含自定义）图标缩到 128，别把原图塞进 HTML。 */
function splashIconDataUrl() {
  try {
    const image = appIcon.windowImage();
    const { width, height } = image.getSize();
    const longest = Math.max(width, height);
    const scaled =
      longest > 128
        ? image.resize(
            width >= height
              ? { width: 128, quality: "good" }
              : { height: 128, quality: "good" }
          )
        : image;
    return scaled.toDataURL();
  } catch {
    return null;
  }
}

function buildLoadingPage() {
  const dark = splashPrefersDark();
  const bg = dark ? "oklch(0.145 0 0)" : "oklch(1 0 0)";
  const ink = dark ? "oklch(0.985 0 0)" : "oklch(0.145 0 0)";
  const dim = dark ? "oklch(0.708 0 0)" : "oklch(0.556 0 0)";
  const icon = splashIconDataUrl();
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: ${bg}; color: ${dim};
    font: 14px/1.6 system-ui, "Microsoft YaHei", sans-serif;
    transition: opacity .26s ease;
    -webkit-app-region: drag;
  }
  body.fade-out { opacity: 0; }
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .mark {
    width: 92px; height: 92px; border-radius: 22px;
    animation: rise 1s cubic-bezier(.22, 1, .36, 1) both;
  }
  p {
    margin: 0; color: ${ink}; opacity: .78;
    animation: rise 1.1s cubic-bezier(.22, 1, .36, 1) both;
  }
  .ring {
    width: 20px; height: 20px; border-radius: 50%;
    border: 2px solid ${dim}; border-top-color: transparent;
    animation: spin .9s linear infinite, show 1s .45s ease both;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { transform: none; } }
  @keyframes show { from { opacity: 0; } to { opacity: .45; } }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head>
<body><div class="wrap">
  ${icon ? `<img class="mark" src="${icon}" alt="" />` : ""}
  <p>正在启动本地服务…</p>
  <div class="ring"></div>
</div></body></html>`)}`;
}

// 启动页在进程起来时拼一次：它同时也是 URL 策略放行的那张页。
// 这里要是抛了，应用连窗口都开不出来，所以兜一张纯色页。
loadAppearance();
let loadingPage;
try {
  loadingPage = buildLoadingPage();
} catch (error) {
  console.error("[app] 启动页生成失败", error);
  loadingPage = `data:text/html;charset=utf-8,${encodeURIComponent(
    "<!doctype html><meta charset='utf-8'><body style='margin:0;height:100%;background:#0a0a0a'></body>"
  )}`;
}

let mainWindow = null;
let floatWindow = null;
let tray = null;
let backend = null;
let quitting = false; // 用户真的要退出（托盘菜单 / Ctrl+Q）
let cleanedUp = false; // 后端已经收干净，可以放行退出
// 本地服务的精确 Origin（端口是动态的），后端就绪后设置。
const urlPolicy = createUrlPolicy(loadingPage);

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
    icon: appIcon.windowImage(),
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
      // 悬浮窗开着的时候主窗口是隐藏的；隐藏的页面会被 Chromium 限流，
      // 回答广播和两条连接就都跟不上了，所以这里关掉限流。
      backgroundThrottling: false,
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

  void window.loadURL(loadingPage);
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

/** 悬浮窗被自己关掉时用来把主窗口叫回来；主窗口没了就什么都不做。 */
function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showMainWindow();
}

/**
 * 悬浮窗：面试中弹出的置顶小窗，只显示回答（见 web/client 的 FloatWindow）。
 *
 * 无边框 + 透明：圆角由页面画，所以窗口本身不带背景色，四周留一圈透明边
 * 让圆角看得见。卡片以外什么都不铺，连阴影都不要——透明窗口上那圈
 * 半透明的晕看着就像蒙了层纱。打开时把主窗口藏起来——面试照跑
 * （页面只是不可见，两条连接一动不动），回主窗口时再叫回来。
 */
function createFloatWindow() {
  if (floatWindow && !floatWindow.isDestroyed()) {
    if (floatWindow.isMinimized()) floatWindow.restore();
    floatWindow.show();
    floatWindow.focus();
    return floatWindow;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const width = 460;
  const height = 680;
  const window = new BrowserWindow({
    width,
    height,
    // 默认贴右上角：它是给人「瞟一眼」的，别挡着屏幕中间。
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    minWidth: 320,
    minHeight: 260,
    title: APP_TITLE,
    icon: appIcon.windowImage(),
    show: false,
    frame: false,
    transparent: true,
    // 整窗不留阴影：系统阴影是方的、会从圆角外圈出来，页面那边也不画。
    hasShadow: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  floatWindow = window;
  window.once("ready-to-show", () => window.show());
  applyContentProtection(window);
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_TITLE);
  });
  window.on("closed", () => {
    if (floatWindow === window) floatWindow = null;
    // 自己被关掉（Alt+F4 / 任务栏）时主窗口还藏着，得叫回来，
    // 不然屏幕上什么都没有，只剩托盘。
    if (!quitting) restoreMainWindow();
  });

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

  void window.loadURL(new URL("/client/?window=float", backend.url).href);
  return window;
}

function closeFloatWindow() {
  const window = floatWindow;
  floatWindow = null;
  if (window && !window.isDestroyed()) window.close();
}

function quitApp() {
  quitting = true;
  app.quit();
}

function createTray() {
  if (tray) return;
  // 兜底：托盘图标缺失时退回应用图标，避免托盘里出现一个空白占位。
  tray = new Tray(appIcon.trayImage());
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

/** 只接受主窗口自己的桌面能力请求；页面导航已被 URL 策略锁在本应用内。 */
function isMainSender(event) {
  return Boolean(mainWindow && event.sender === mainWindow.webContents);
}

/** 悬浮窗自己的请求（返回主窗口 / 结束面试）走这条验。 */
function isFloatSender(event) {
  return Boolean(floatWindow && event.sender === floatWindow.webContents);
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
  ipcMain.handle("privacy:get-content-protection", () => contentProtection);  ipcMain.handle("privacy:set-content-protection", (event, enabled) => {
    if (!isMainSender(event)) return contentProtection;
    contentProtection = Boolean(enabled);
    savePrivacySettings();
    applyAllContentProtection();
    return contentProtection;
  });

  // ---- 外观：主题写盘，下次启动的启动页照它配色 ----
  ipcMain.on("appearance:set-theme", (event, theme) => {
    if (!isMainSender(event)) return;
    appearanceTheme =
      theme === "light" || theme === "dark" ? theme : "system";
    saveAppearance();
  });

  // ---- 悬浮窗 ----
  // 打开：主窗口藏起来，回答在小窗里继续出。
  ipcMain.on("float:open", (event) => {
    if (!isMainSender(event)) return;
    createFloatWindow();
    mainWindow?.hide();
  });
  // 回主窗口：面试照常进行，只是把主窗口叫回来。
  ipcMain.on("float:back", (event) => {
    if (!isFloatSender(event)) return;
    restoreMainWindow();
    closeFloatWindow();
  });
  // 结束面试：把动作转回主窗口走正常收尾（记会话、回首页），再收摊。
  ipcMain.on("float:end", (event) => {
    if (!isFloatSender(event)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("float:command", "end");
    }
    restoreMainWindow();
    closeFloatWindow();
  });

  // ---- 应用图标：预设切换 + 上传图片 ----
  // 点一下只做「写盘 + 换窗体图标 + 立刻回话」，设置页的选中态当场就变。
  // 任务栏那一路要起 PowerShell 改快捷方式，**不等它**——放在关键路径上会让
  // 界面卡住半秒到两秒，而它本来就是重启后才生效的，晚一点落地没有任何代价。
  // 托盘更是一动不动：重启后才换（见 app-icon.apply 的注释）。
  ipcMain.handle("app-icon:get", () => appIcon.describe());
  ipcMain.handle("app-icon:set", (event, preset) => {
    if (!isMainSender(event)) return appIcon.describe();
    const info = appIcon.setPreset(preset);
    appIcon.apply({ window: mainWindow });
    void appIcon.applyTaskbar();
    return info;
  });
  ipcMain.handle("app-icon:pick-image", async (event) => {
    if (!isMainSender(event)) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "选择图片作为应用图标",
      properties: ["openFile"],
      filters: [
        { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "ico", "bmp"] },
      ],
    });
    if (canceled || !filePaths.length) return null;
    const info = appIcon.setFromFilePath(filePaths[0]);
    if (info) {
      appIcon.apply({ window: mainWindow });
      void appIcon.applyTaskbar();
    }
    return info;
  });
  // 任务栏图标要按钮重建才认，所以给个「立即重启」的口子。
  ipcMain.handle("app-icon:relaunch", (event) => {
    if (!isMainSender(event)) return false;
    app.relaunch();
    quitApp();
    return true;
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

/** 主窗口和悬浮窗都跟着设置走；新窗口自己开出来时也会单独套一次。 */
function applyAllContentProtection() {
  applyContentProtection(mainWindow);
  applyContentProtection(floatWindow);
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

/**
 * 服务就绪后把启动页淡出，再换成正式界面——硬切一刀最难看。
 * 正式界面自己还有一段淡入（index.css 的 #root），两段接得上。
 */
async function enterApp(window) {
  await window.webContents
    .executeJavaScript(
      "document.body && document.body.classList.add('fade-out')"
    )
    .catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 260));
  if (window.isDestroyed()) return;
  await window.loadURL(backend.url);
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
    await enterApp(mainWindow);
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
