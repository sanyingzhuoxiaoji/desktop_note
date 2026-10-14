const { app, BrowserWindow, Menu, ipcMain, screen, Tray, Notification, powerMonitor } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// 钉死数据目录：开发与打包后共用同一份便签数据（否则打包后应用名变化会换目录，数据"消失"）
app.setPath('userData', path.join(app.getPath('appData'), 'desktop-sticky-note'));
// Windows toast 通知必需：与 package.json 的 appId 保持一致
app.setAppUserModelId('com.sanyingzhuoxiaoji.desktop-note');

const MIN_W = 280;
const MIN_H = 220;
// 默认大小与停靠位（沿用用户习惯：屏幕右缘、垂直偏下）
const DEFAULT_BOUNDS = { width: 372, height: 472 };
const DEFAULT_DOCK_Y = 472; // 距屏幕顶部的默认 y

let win = null;
let isQuitting = false; // 区分"隐藏到托盘"与"真正退出"
let pinned = false;     // 用户置顶（📌）。贴边时窗口也会被强制置顶，故不能再用 isAlwaysOnTop 判断
let userHidden = false; // 用户主动藏到托盘（✕/托盘隐藏）；桌面自愈不与它对抗
let fullscreenActive = false; // 前台有全屏应用（看视频/F11/游戏）

// ---------- 数据文件 ----------
const dataPath = () => path.join(app.getPath('userData'), 'sticky-note-data.json');
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
const settingsPath = () => path.join(app.getPath('userData'), 'app-settings.json');

const DEFAULT_SETTINGS = { fontSize: 13, fontWeight: 400, autoStart: false, reminderImage: null };
let appSettings = { ...DEFAULT_SETTINGS };

function loadAppSettings() {
  appSettings = { ...DEFAULT_SETTINGS, ...(readJSON(settingsPath()) || {}) };
}

function saveAppSettings() {
  try { writeJSON(settingsPath(), appSettings); } catch (e) { console.error(e); }
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// ---------- 窗口状态 ----------
function loadBounds() {
  const b = readJSON(statePath());
  const wa = screen.getPrimaryDisplay().workArea;
  if (!b) {
    return {
      x: Math.round(wa.x + wa.width - DEFAULT_BOUNDS.width), // 右缘贴齐
      y: Math.round(Math.min(wa.y + DEFAULT_DOCK_Y, wa.y + wa.height - DEFAULT_BOUNDS.height)),
      width: DEFAULT_BOUNDS.width,
      height: DEFAULT_BOUNDS.height
    };
  }
  const width = Math.min(Math.max(b.width || MIN_W, MIN_W), wa.width);
  const height = Math.min(Math.max(b.height || MIN_H, MIN_H), wa.height);
  let x = Number.isFinite(b.x) ? b.x : wa.x + (wa.width - width) / 2;
  let y = Number.isFinite(b.y) ? b.y : wa.y + (wa.height - height) / 3;
  // 保证窗口至少有 60px 落在可见工作区内
  x = Math.min(Math.max(x, wa.x - width + 60), wa.x + wa.width - 60);
  y = Math.min(Math.max(y, wa.y - height + 60), wa.y + wa.height - 60);
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function saveWindowState() {
  if (!win) return;
  try {
    const b = win.getBounds();
    if (dock.side) {
      // 贴边收起时保存"展开"位置，避免重启后窗口藏在屏幕外
      const wa = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).workArea;
      b.x = dockX(dock.side, true, b.width, wa);
    }
    writeJSON(statePath(), b);
  } catch (e) { console.error(e); }
}

// ---------- 创建窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    ...loadBounds(),
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,          // 无边框
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true, // 不占任务栏，常驻系统托盘
    backgroundColor: (readJSON(dataPath()) || {}).themeColor || '#FFF9B1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null); // 无菜单栏
  // 启动默认不置顶；📌 按钮可在运行时切换（screen-saver 等级，原因见 win:set-always-on-top 处注释）
  win.loadFile('index.html');
  // 调试时可取消注释：win.webContents.openDevTools({ mode: 'detach' });

  win.on('close', (e) => {
    saveWindowState();
    if (!isQuitting) {
      // 点 ✕ / Alt+F4：仅隐藏到托盘，不退出；退出只能走托盘菜单"退出应用"
      e.preventDefault();
      userHidden = true; // ✕ = 藏到托盘，非退出
      win.hide();
    }
  });
  win.on('closed', () => {
    // 窗口销毁（退出中）后所有挂起定时器立即失效，防止操作已销毁窗口
    stopDockAnim();
    clearTimeout(dockMoveTimer);
  });

  // 贴边隐藏：拖动结束判定（'move' 连续触发防抖，'moved' 拖动即时结束）
  win.on('move', () => {
    clearTimeout(dockMoveTimer);
    dockMoveTimer = setTimeout(handleMoveEnd, 180);
  });
  win.on('moved', handleMoveEnd);
}

// ---------- IPC ----------
ipcMain.handle('data:load', () => readJSON(dataPath()));

ipcMain.handle('data:save', (_e, data) => {
  try { writeJSON(dataPath(), data); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err) }; }
});

ipcMain.on('data:save-sync', (e, data) => {
  try { writeJSON(dataPath(), data); e.returnValue = { ok: true }; }
  catch (err) { e.returnValue = { ok: false, error: String(err) }; }
});

ipcMain.on('win:close', () => win && win.close());

// ---------- 设置窗口（左目录 + 右内容；单例） ----------
let settingsWin = null;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 420,
    title: '设置',
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
}

ipcMain.on('win:open-settings', () => openSettings());

// 读写自启动项必须用同一组选项：getLoginItemSettings 会比对 args，
// 写入带了 args 而读取用默认空参数时，会误报"未启用"
function loginItemOpts() {
  return { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] };
}
function actualAutoStart() {
  return app.getLoginItemSettings(loginItemOpts()).openAtLogin;
}

// 旧版用 Electron 默认条目名写的自启动项，与新版并存会让开机拉起两个实例
// （单实例锁虽能兜底，但"关了自启动开机仍启动"的困惑必须清掉）
const LEGACY_RUN_NAME = 'electron.app.桌面便签';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
function removeLegacyAutoStartEntry() {
  execFile('reg.exe', ['query', RUN_KEY, '/v', LEGACY_RUN_NAME], (err, stdout) => {
    if (err || !stdout) return;
    // 仅当旧条目也指向本应用自己的安装目录时才删，避免误伤同名异物的其他软件
    const mine = path.dirname(process.execPath);
    const appDir = app.isPackaged ? mine : app.getAppPath();
    if (stdout.includes(mine) || stdout.includes(appDir)) {
      execFile('reg.exe', ['delete', RUN_KEY, '/v', LEGACY_RUN_NAME, '/f'], () => {});
    }
  });
}

ipcMain.handle('settings:get', () => ({ ...appSettings, autoStart: actualAutoStart() }));

ipcMain.handle('settings:set', (_e, patch) => {
  if (patch && typeof patch === 'object') {
    if (Number.isFinite(patch.fontSize)) appSettings.fontSize = Math.min(20, Math.max(11, Math.round(patch.fontSize)));
    if (Number.isFinite(patch.fontWeight)) appSettings.fontWeight = Math.min(700, Math.max(300, Math.round(patch.fontWeight)));
    if (typeof patch.reminderImage === 'string' || patch.reminderImage === null) appSettings.reminderImage = patch.reminderImage;
    if (typeof patch.autoStart === 'boolean') {
      appSettings.autoStart = patch.autoStart;
      app.setLoginItemSettings({
        openAtLogin: patch.autoStart,
        ...loginItemOpts() // 开发模式下注册带应用路径，登录时能直接打开本应用
      });
      removeLegacyAutoStartEntry(); // 开/关都清理旧版残留条目，避免"关了自启动开机仍启动"
    }
    saveAppSettings();
  }
  // 字体等外观设置即时生效：推送给便签窗口
  if (win && !win.isDestroyed()) win.webContents.send('settings-changed', { ...appSettings });
  return { ...appSettings, autoStart: actualAutoStart() };
});
ipcMain.on('win:set-always-on-top', (_e, flag) => {
  if (!win) return;
  pinned = !!flag;
  if (pinned && dock.side) {
    // 📌 的语义是"不再自动收起"：置顶时解除贴边，滑出到展开位置（保持置顶）
    const side = dock.side;
    const b = win.getBounds();
    const wa = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).workArea;
    stopDockAnim();
    dock = { side: null, hidden: false, width: 0 };
    sendDockState();
    slideDockTo(dockX(side, true, b.width, wa));
  }
  applyTopmost();
  if (viewerWin && !viewerWin.isDestroyed()) viewerWin.setAlwaysOnTop(pinned, 'screen-saver');
});

// 右下角拖拽缩放：主进程用屏幕绝对坐标计算，避免窗口移动导致的反馈抖动
let resizeCtx = null;
ipcMain.on('win:resize-start', () => {
  resizeCtx = { bounds: win.getBounds(), cursor: screen.getCursorScreenPoint() };
});
ipcMain.on('win:resize-move', () => {
  if (!resizeCtx || !win || win.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const width = Math.max(MIN_W, resizeCtx.bounds.width + p.x - resizeCtx.cursor.x);
  const height = Math.max(MIN_H, resizeCtx.bounds.height + p.y - resizeCtx.cursor.y);
  win.setBounds({ x: resizeCtx.bounds.x, y: resizeCtx.bounds.y, width, height });
});
ipcMain.on('win:resize-end', () => { resizeCtx = null; });

// ---------- 层级裁决：置顶语义统一从这里走（screen-saver 等级，原因见下方置顶 IPC 注释） ----------
function applyTopmost() {
  if (!win || win.isDestroyed()) return;
  const top = pinned || !!dock.side; // 贴边期间（含悬停展开态）强制置顶，边条才不会被盖住
  win.setAlwaysOnTop(top, 'screen-saver');
  if (!top) win.moveTop(); // 取消置顶后回到普通层顶部，避免沉底（Windows 怪癖）
}

// ---------- 桌面/全屏自愈：常驻 PowerShell 子进程轮询前台窗口 ----------
// Electron 没有查询前台窗口的 API；反复 spawn PowerShell 太重，这里常驻一个
// 600ms 一拍的进程流式输出前台窗口信息。
const FS_SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd']); // 桌面/任务栏不算全屏应用
let fsWatcher = null;

function startFullscreenWatcher() {
  const ps = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public class FW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
}
"@
while ($true) {
  $h = [FW]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $r = New-Object RECT
    [void][FW]::GetWindowRect($h, [ref]$r)
    $ex = [FW]::GetWindowLong($h, -20)
    $sb = New-Object System.Text.StringBuilder 256
    [void][FW]::GetClassName($h, $sb, 256)
    Write-Output "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom),$(($ex -band 8) -ne 0),$($sb.ToString())"
  }
  Start-Sleep -Milliseconds 600
}`;
  const b64 = Buffer.from(ps, 'utf16le').toString('base64');
  fsWatcher = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', b64], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true
  });
  fsWatcher.stdout.setEncoding('utf8');
  let buf = '';
  fsWatcher.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) handleForegroundLine(line);
    }
  });
}

function handleForegroundLine(line) {
  if (!win || win.isDestroyed()) return;
  const parts = line.split(',');
  if (parts.length < 6) return;
  const L = +parts[0], T = +parts[1], R = +parts[2], B = +parts[3];
  const cls = parts.slice(5).join(',');
  const b = win.getBounds();
  const monitor = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).bounds;
  // 前台窗口完整覆盖整块屏幕（非 workArea）→ 全屏应用；桌面/任务栏类名排除，
  // 否则点一下桌面（Progman 全屏覆盖）会被误判成全屏
  const fs = L <= monitor.x && T <= monitor.y
    && R >= monitor.x + monitor.width && B >= monitor.y + monitor.height
    && !FS_SHELL_CLASSES.has(cls);
  if (fs !== fullscreenActive) fullscreenActive = fs;
  applyOverlayRule();
}

function applyOverlayRule() {
  if (!win || win.isDestroyed()) return;
  if (fullscreenActive) {
    if (win.isVisible()) win.hide(); // 全屏让位（含📌置顶的），退出全屏由下一拍自愈拉回
    return;
  }
  if ((pinned || dock.side) && !userHidden && !win.isVisible()) {
    win.showInactive(); // Win+D/全屏结束后自愈；不抢焦点
  }
}

// ---------- 贴边自动隐藏（仅未置顶时；拖到屏幕左/右边缘收起为一条边，悬停滑出） ----------
const STRIP_W = 8;  // 收起后露出的边条宽度
const SNAP_PX = 12; // 距屏幕边缘多少像素内判定为贴边
let dock = { side: null, hidden: false, width: 0 }; // side: 'left' | 'right' | null
let dockAnim = null;

function sendDockState() {
  if (win && !win.isDestroyed()) win.webContents.send('win:dock-state', { side: dock.side, hidden: dock.hidden });
}

// side 边贴边时窗口的 x 坐标：shown=true 展开（贴齐边缘），false 收起（只露边条）
function dockX(side, shown, width, wa) {
  return shown
    ? (side === 'left' ? wa.x : wa.x + wa.width - width)
    : (side === 'left' ? wa.x - width + STRIP_W : wa.x + wa.width - STRIP_W);
}

function stopDockAnim() {
  if (dockAnim) { clearInterval(dockAnim); dockAnim = null; }
}

function slideDockTo(targetX) {
  if (!win) return;
  stopDockAnim();
  const b = win.getBounds();
  const startX = b.x, y = b.y, width = b.width, height = b.height;
  let i = 0;
  const steps = 12;
  dockAnim = setInterval(() => {
    i++;
    if (!win || win.isDestroyed()) { stopDockAnim(); return; } // 退出中窗口已销毁，立即停止
    const t = Math.min(1, i / steps);
    const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
    win.setBounds({ x: Math.round(startX + (targetX - startX) * ease), y, width, height });
    if (i >= steps) stopDockAnim();
  }, 16);
}

function handleMoveEnd() {
  if (!win || win.isDestroyed() || dockAnim || win.isMinimized()) return;
  const b = win.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).workArea;
  const side = b.x <= wa.x + SNAP_PX ? 'left'
    : (b.x + b.width >= wa.x + wa.width - SNAP_PX ? 'right' : null);

  if (pinned) { // 置顶状态不贴边隐藏
    if (dock.side) { dock = { side: null, hidden: false, width: 0 }; sendDockState(); }
    return;
  }
  if (side) {
    // 已贴此侧（无论收起/展开）直接跳过：滑出动画自身的 move 会补触发本函数，
    // 不跳过会把悬停展开的窗口重新收起
    if (dock.side === side) return;
    dock = { side, hidden: true, width: b.width };
    sendDockState();
    applyTopmost(); // 贴边期间强制置顶，边条不被任何窗口盖住
    slideDockTo(dockX(side, false, b.width, wa));
  } else if (dock.side) {
    const restoreW = dock.width;
    dock = { side: null, hidden: false, width: 0 };
    sendDockState();
    // 恢复贴边前的宽度（防止在边缘误触原生拉伸把窗口拉大），即"拖离边缘，恢复原样"
    if (restoreW && b.width !== restoreW) {
      win.setBounds({ x: b.x, y: b.y, width: restoreW, height: b.height });
    }
    applyTopmost(); // 未置顶则退出强制置顶，回到普通层级
  }
}

let dockMoveTimer = null; // 拖动结束判定（在 createWindow 内注册监听，win 此时才存在）

ipcMain.on('win:dock-hover', () => {
  if (!win || win.isDestroyed() || !dock.side || !dock.hidden || pinned) return;
  const b = win.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).workArea;
  dock.hidden = false;
  sendDockState();
  slideDockTo(dockX(dock.side, true, b.width, wa));
});
ipcMain.on('win:dock-leave', () => {
  if (!win || win.isDestroyed() || !dock.side || dock.hidden || pinned) return;
  const b = win.getBounds();
  // 指针仍在窗口内 = 拖拽区切换造成的"假离开"（drag 区域不产生鼠标事件，
  // 页面会误报 mouseleave），忽略之，否则会在展开/收起间无限横跳
  const p = screen.getCursorScreenPoint();
  if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return;
  const wa = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).workArea;
  dock.hidden = true;
  sendDockState();
  slideDockTo(dockX(dock.side, false, b.width, wa));
});

// ---------- 图片查看窗口（独立窗口、居中、可缩放） ----------
let viewerWin = null;

ipcMain.on('img:view', (_e, payload) => {
  const { src, w = 800, h = 600 } = payload || {};
  if (viewerWin && !viewerWin.isDestroyed()) {
    // 已打开：直接换图并前置
    viewerWin.webContents.send('viewer:img', { src });
    if (viewerWin.isMinimized()) viewerWin.restore();
    viewerWin.focus();
    return;
  }

  // 新开：尺寸按图片比例适配（不超过所在屏幕工作区的 80%），居中于便签所在屏幕
  const b = win ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
  const wa = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).workArea;
  const maxW = Math.round(wa.width * 0.8);
  const maxH = Math.round(wa.height * 0.8);
  const scale = Math.min(1, maxW / w, maxH / h);
  const width = Math.max(320, Math.round(w * scale));
  const height = Math.max(240, Math.round(h * scale));

  viewerWin = new BrowserWindow({
    width,
    height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    minWidth: 320,
    minHeight: 240,
    title: '图片预览',
    backgroundColor: '#202124',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  viewerWin.loadFile('viewer.html');
  viewerWin.on('closed', () => { viewerWin = null; });

  // 便签置顶时查看器同步置顶（用 screen-saver 等级，原因同上）
  if (win && pinned) viewerWin.setAlwaysOnTop(true, 'screen-saver');

  viewerWin.webContents.on('did-finish-load', () => {
    if (viewerWin && !viewerWin.isDestroyed()) viewerWin.webContents.send('viewer:img', { src });
  });
});

// ---------- 系统托盘 ----------
let tray = null;

function createTray() {
  tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
  tray.setToolTip('桌面便签');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '退出应用',
      click: () => { isQuitting = true; app.quit(); }
    }
  ]));
  // 左键单击：显示/隐藏便签窗口
  tray.on('click', () => {
    if (!win || win.isDestroyed() || isQuitting) return;
    if (win.isVisible() && !win.isMinimized()) {
      userHidden = true; // 主动藏到托盘，桌面/全屏自愈不与它对抗
      win.hide();
    } else {
      userHidden = false;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// ---------- 待办提醒（主进程调度：窗口隐藏到托盘时渲染端 timer 会被节流，主进程不受影响） ----------
// 锁屏/息屏/睡眠期间到点的提醒不能直接消费：Windows 会吞掉锁屏时的 toast，
// 而 reminded 标志一旦写入就永远不会再弹。改为 defer：留在调度表里，解锁/唤醒后补弹。
const remindTimers = new Map(); // item.id → setTimeout 句柄
const remindAtMap = new Map();  // item.id → remindAt(ISO)；锁屏 defer 的条目留在这里等 sweep
let sessionLocked = false;

function fireReminder(id) {
  clearTimeout(remindTimers.get(id));
  remindTimers.delete(id);
  if (sessionLocked) return; // 会话不可见：不弹、不写 reminded，条目留在 remindAtMap 等 sweep
  remindAtMap.delete(id);
  if (!win || win.isDestroyed()) return;
  const data = readJSON(dataPath());
  const it = data && Array.isArray(data.items) ? data.items.find((x) => x.id === id) : null;
  // 二次校验（数据文件为权威）：可能已被删除/完成/重复触发
  if (!it || it.status !== 'todo' || it.reminded) return;
  it.reminded = true;
  try { writeJSON(dataPath(), data); } catch { /* 写失败不阻断通知 */ }

  const firstLine = String(it.text || '').split('\n')[0].trim();
  const n = new Notification({
    title: '待办提醒',
    body: (firstLine || '（图片待办）').slice(0, 40) + '（便签）',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    silent: false
  });
  n.on('click', () => {
    if (win && !win.isDestroyed()) {
      userHidden = false;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  n.show();
  // 自定义图片弹窗：条目图优先，全局兜底图次之，都无则无图
  const src = (Array.isArray(it.images) && it.images[0]) || appSettings.reminderImage || null;
  openReminderPopup({ src, text: firstLine, id });
  // 同步渲染端内存状态，防止其后续防抖保存把 reminded 覆盖回 false
  win.webContents.send('reminder:fired', { id });
}

// ---------- 提醒图片弹窗（右下角、置顶、不抢焦点；单例） ----------
let reminderWin = null;

function openReminderPopup(payload) {
  const W = 320;
  const H = payload.src ? 300 : 130;
  const wa = screen.getPrimaryDisplay().workArea;
  if (reminderWin && !reminderWin.isDestroyed()) {
    // 已开着：换内容并居中
    reminderWin.setSize(W, H);
    reminderWin.setPosition(Math.round(wa.x + (wa.width - W) / 2), Math.round(wa.y + (wa.height - H) / 2));
    reminderWin.webContents.send('alert:data', payload);
    reminderWin.showInactive();
    return;
  }
  reminderWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(wa.x + (wa.width - W) / 2),
    y: Math.round(wa.y + (wa.height - H) / 2),
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,   // 不抢焦点：用户打字不被打断
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#26241e',
    webPreferences: {
      preload: path.join(__dirname, 'alert-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  reminderWin.setAlwaysOnTop(true, 'screen-saver');
  reminderWin.loadFile('alert.html');
  reminderWin.on('closed', () => { reminderWin = null; });
  reminderWin.webContents.on('did-finish-load', () => {
    if (reminderWin && !reminderWin.isDestroyed()) {
      reminderWin.webContents.send('alert:data', payload);
      reminderWin.showInactive();
    }
  });
}

ipcMain.on('alert:action', (_e, { action }) => {
  if (reminderWin && !reminderWin.isDestroyed()) reminderWin.close();
  if (action === 'open' && win && !win.isDestroyed()) {
    userHidden = false;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

function scheduleReminder(id, remindAt) {
  const old = remindTimers.get(id);
  if (old) clearTimeout(old);
  remindTimers.delete(id);
  if (!remindAt) { remindAtMap.delete(id); return; } // null = 清除提醒
  remindAtMap.set(id, remindAt);
  const delay = new Date(remindAt).getTime() - Date.now();
  // 过期（含启动补发场景）走下一个 tick 立即触发
  remindTimers.set(id, setTimeout(() => fireReminder(id), Math.max(0, delay)));
}

// 兜底扫描：睡眠导致的定时器漂移/丢失、锁屏 defer 的条目，都由这里补上
function sweepReminders() {
  const now = Date.now();
  for (const [id, remindAt] of [...remindAtMap]) {
    if (new Date(remindAt).getTime() <= now) fireReminder(id);
  }
}

ipcMain.handle('reminder:set', (_e, { id, remindAt }) => {
  if (!id) return { ok: false };
  scheduleReminder(id, remindAt);
  return { ok: true };
});

function scheduleAllReminders() {
  const data = readJSON(dataPath());
  if (!data || !Array.isArray(data.items)) return;
  for (const it of data.items) {
    if (it.status === 'todo' && it.remindAt && !it.reminded) {
      scheduleReminder(it.id, it.remindAt); // 过期的 delay≤0 → 立即触发 = 启动补发
    }
  }
}

// 渲染端 init 完成后同步 reminded 状态：启动即补发的场景下，
// reminder:fired 推送可能早于渲染端 loadData 完成而被丢弃，其内存里的
// false 会在下次防抖保存时覆盖主进程写入的 true（导致下次重启重复弹）
ipcMain.on('renderer:ready', () => {
  if (!win || win.isDestroyed()) return;
  const data = readJSON(dataPath());
  if (!data || !Array.isArray(data.items)) return;
  const ids = data.items.filter((x) => x.status === 'todo' && x.reminded).map((x) => x.id);
  if (ids.length) win.webContents.send('reminder:sync', ids);
});

// ---------- 生命周期 ----------
// 单实例锁：托盘应用开两个会出现双托盘图标与数据写入竞态
// （开发版与安装版共用同一数据目录，因此也共用这把锁——一方运行时另一方无法启动）
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || isQuitting) return;
    userHidden = false;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    loadAppSettings();
    createWindow();
    createTray();
    scheduleAllReminders(); // 启动扫描：未提醒的照常调度，已过期的立即补发
    startFullscreenWatcher(); // 全屏检测 + Win+D 自愈轮询
    removeLegacyAutoStartEntry(); // 清理旧版残留的自启动条目（双条目会让开机拉起两个实例）

    // 锁屏/睡眠感知：到点时会话不可见则 defer，解锁/唤醒后 sweep 补弹
    // （直接弹会被 Windows 吞掉，而 reminded 标志已消费，导致用户永远看不到这条提醒）
    powerMonitor.on('lock-screen', () => { sessionLocked = true; });
    powerMonitor.on('unlock-screen', () => { sessionLocked = false; sweepReminders(); });
    powerMonitor.on('suspend', () => { sessionLocked = true; });
    powerMonitor.on('resume', () => {
      sessionLocked = false;
      scheduleAllReminders(); // 重建睡眠期间丢失/漂移的定时器
      sweepReminders();
    });
    setInterval(sweepReminders, 30_000); // 兜底：定时器漂移、defer 条目，最迟 30 秒补上

    // 启动时恢复的位置若贴着左右边缘 → 重新接上贴边状态并收成一条边
    // （关闭时保存的是展开位置防丢，这里折回去；否则摊平在边缘且悬停/收起逻辑都不生效）
    setTimeout(() => handleMoveEnd(), 100);
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (fsWatcher) { fsWatcher.kill(); fsWatcher = null; } // 防僵尸 powershell 子进程
});
app.on('window-all-closed', () => app.quit());
