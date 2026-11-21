"use strict";

/**
 * 任务栏图标的伪装：把快捷方式的图标换掉，重启后任务栏就会跟着变。
 *
 * Windows 的任务栏按钮不读 `win.setIcon()`（那只改 WM_GETICON），而是读
 * 该应用对应的快捷方式的 IconLocation——所以必须改 .lnk，而且按钮只在
 * 重建（也就是应用重启）时才去读。
 *
 * 还有一个坑：同一个 .ico 路径会被 Windows 图标缓存住。我实测过——文件
 * 内容换了但路径没换，任务栏仍然显示旧图；换一个新文件名立刻生效。
 * 所以每次换图标都写一个新名字的 .ico，再把旧的删掉。
 *
 * 唯一一个例外是「默认」：IconLocation 指回 exe 本身，就是原始图标。
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

/** 每个 .ico 里塞几种尺寸，任务栏小图标才不糊。 */
const ICO_SIZES = [16, 24, 32, 48, 64, 256];

function icoDir() {
  return path.join(app.getPath("userData"), "app-icons");
}

/**
 * 把 nativeImage 打成 .ico。现代 Windows 支持直接塞 PNG 数据，
 * 不用自己解码位图，所以这里就是把几个尺寸的 PNG 拼进 ICO 容器。
 */
function writeIco(image, target) {
  const pngs = ICO_SIZES.map((size) =>
    image.resize({ width: size, height: size, quality: "best" }).toPNG()
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + 16 * pngs.length;
  const entries = [];
  pngs.forEach((png, index) => {
    const size = ICO_SIZES[index];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // 调色板颜色数
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  });

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.concat([header, ...entries, ...pngs]));
}

/**
 * 更新快捷方式的图标。
 *
 * **四处一起改**：任务栏固定、桌面、开始菜单（用户 + 公共）。
 * 任务栏按钮显示的是「启动本实例的那个快捷方式」的 IconLocation——
 * 从桌面快捷方式启动的，改任务栏那条是没用的，所以几处都要落到同一个图标。
 *
 * 路径通过环境变量传给 PowerShell：命令行参数会被代码页打乱（中文用户名
 * 尤其明显），环境变量是 Unicode 的，不会走样。脚本正文只用 ASCII。
 */
function updateShortcuts(iconLocation) {
  const script = `
$sh = New-Object -ComObject WScript.Shell
$exe = $env:FI_EXE
$icon = $env:FI_ICON
$roots = @(
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar')
)
$count = 0
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem -Path $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $lnk = $sh.CreateShortcut($_.FullName)
    if ($lnk.TargetPath -eq $exe) {
      $lnk.IconLocation = $icon
      $lnk.Save()
      $count = $count + 1
    }
  }
}
# 改完必须叫 shell 重新读一遍关联/图标，否则任务栏按钮仍旧是旧图。
$sig = '[DllImport("shell32.dll")] public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);'
$sh32 = Add-Type -MemberDefinition $sig -Name Shell32 -Namespace Win32 -PassThru
$sh32::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output $count
`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        env: { ...process.env, FI_EXE: process.execPath, FI_ICON: iconLocation },
        windowsHide: true,
        timeout: 30_000,
      },
      (error, stdout) => {
        if (error) {
          console.error("[app-icon] 更新快捷方式图标失败", error.message);
          resolve(0);
          return;
        }
        const count = Number.parseInt(String(stdout).trim(), 10) || 0;
        // 数量记一笔：0 说明压根没固定到任务栏（或固定的那个不是这个 exe），
        // 这时候任务栏按钮走的是窗体图标，改 .lnk 改不到它。
        console.log(`[app-icon] 任务栏快捷方式改到 ${count} 个`);
        resolve(count);
      }
    );
  });
}

/**
 * 叫 Windows 把图标缓存重读一遍。
 *
 * 光改快捷方式不够：任务栏按钮的图标是缓存住的，.lnk 换了它也不动，
 * 只有缓存失效才会重新取。`ie4uinit -show` 就是干这个的；
 * 上面的 SHChangeNotify 已经兜了一层，这里再补一记官方入口。
 */
function refreshShellIcons() {
  return new Promise((resolve) => {
    execFile(
      "ie4uinit.exe",
      ["-show"],
      { windowsHide: true, timeout: 15_000 },
      () => resolve()
    );
  });
}

/** 只保留最新那个 .ico：老的既占地方，也会让图标缓存有更多可命中的旧条目。 */
function pruneOldIcons(keepFile) {
  try {
    for (const name of fs.readdirSync(icoDir())) {
      if (name === path.basename(keepFile)) continue;
      fs.rmSync(path.join(icoDir(), name), { force: true });
    }
  } catch {
    // 清不掉不影响功能，只是多几个文件。
  }
}

/**
 * 换任务栏图标：写一个新路径的 .ico，改快捷方式，清掉旧的。
 * 返回本次改到的快捷方式数量；`image` 传 null 表示恢复默认（指回 exe）。
 */
async function applyTaskbarIcon(image) {
  const exeIcon = `${process.execPath},0`;
  if (!image || image.isEmpty()) {
    const restored = await updateShortcuts(exeIcon);
    await refreshShellIcons();
    return restored;
  }
  const file = path.join(icoDir(), `app-${Date.now().toString(36)}.ico`);
  writeIco(image, file);
  const updated = await updateShortcuts(`${file},0`);
  pruneOldIcons(file);
  await refreshShellIcons();
  return updated;
}

module.exports = { applyTaskbarIcon, writeIco };
