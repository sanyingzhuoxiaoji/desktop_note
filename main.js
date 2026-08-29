const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const MIN_W = 280;
const MIN_H = 220;
const DEFAULT_BOUNDS = { width: 360, height: 460 };

let win = null;

// ---------- 数据文件 ----------
const dataPath = () => path.join(app.getPath('userData'), 'sticky-note-data.json');
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

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
      x: Math.round(wa.x + (wa.width - DEFAULT_BOUNDS.width) / 2),
      y: Math.round(wa.y + (wa.height - DEFAULT_BOUNDS.height) / 3),
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
    backgroundColor: (readJSON(dataPath()) || {}).themeColor || '#FFF9B1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null); // 无菜单栏
  // 启动默认置顶，须用 screen-saver 等级（原因见 win:set-always-on-top 处注释）
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');
  // 调试时可取消注释：win.webContents.openDevTools({ mode: 'detach' });

  win.on('close', saveWindowState);

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
ipcMain.on('win:set-always-on-top', (_e, flag) => {
  if (!win) return;
  // 必须用 screen-saver 等级：默认 floating 等级会触发 Electron 的
  // "置顶后把窗口插到任务栏后面"逻辑（MoveBehindTaskBarIfNeeded），
  // 在任务栏被第三方软件干扰的系统上会把窗口挤出置顶层。
  win.setAlwaysOnTop(!!flag, 'screen-saver');
  win.moveTop(); // 取消置顶后回到普通层顶部，避免沉底
});

// 右下角拖拽缩放：主进程用屏幕绝对坐标计算，避免窗口移动导致的反馈抖动
let resizeCtx = null;
ipcMain.on('win:resize-start', () => {
  resizeCtx = { bounds: win.getBounds(), cursor: screen.getCursorScreenPoint() };
});
ipcMain.on('win:resize-move', () => {
  if (!resizeCtx) return;
  const p = screen.getCursorScreenPoint();
  const width = Math.max(MIN_W, resizeCtx.bounds.width + p.x - resizeCtx.cursor.x);
  const height = Math.max(MIN_H, resizeCtx.bounds.height + p.y - resizeCtx.cursor.y);
  win.setBounds({ x: resizeCtx.bounds.x, y: resizeCtx.bounds.y, width, height });
});
ipcMain.on('win:resize-end', () => { resizeCtx = null; });

// ---------- 贴边自动隐藏（仅未置顶时；拖到屏幕左/右边缘收起为一条边，悬停滑出） ----------
const STRIP_W = 8;  // 收起后露出的边条宽度
const SNAP_PX = 12; // 距屏幕边缘多少像素内判定为贴边
let dock = { side: null, hidden: false, width: 0 }; // side: 'left' | 'right' | null
let dockAnim = null;

function sendDockState() {
  if (win) win.webContents.send('win:dock-state', { side: dock.side, hidden: dock.hidden });
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
    const t = Math.min(1, i / steps);
    const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
    win.setBounds({ x: Math.round(startX + (targetX - startX) * ease), y, width, height });
    if (i >= steps) stopDockAnim();
  }, 16);
}

function handleMoveEnd() {
  if (!win || dockAnim || win.isMinimized()) return;
  const b = win.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).workArea;
  const side = b.x <= wa.x + SNAP_PX ? 'left'
    : (b.x + b.width >= wa.x + wa.width - SNAP_PX ? 'right' : null);

  if (win.isAlwaysOnTop()) { // 置顶状态下不贴边隐藏
    if (dock.side) { dock = { side: null, hidden: false, width: 0 }; sendDockState(); }
    return;
  }
  if (side) {
    // 已贴此侧（无论收起/展开）直接跳过：滑出动画自身的 move 会补触发本函数，
    // 不跳过会把悬停展开的窗口重新收起
    if (dock.side === side) return;
    dock = { side, hidden: true, width: b.width };
    sendDockState();
    slideDockTo(dockX(side, false, b.width, wa));
  } else if (dock.side) {
    const restoreW = dock.width;
    dock = { side: null, hidden: false, width: 0 };
    sendDockState();
    // 恢复贴边前的宽度（防止在边缘误触原生拉伸把窗口拉大），即"拖离边缘，恢复原样"
    if (restoreW && b.width !== restoreW) {
      win.setBounds({ x: b.x, y: b.y, width: restoreW, height: b.height });
    }
  }
}

let dockMoveTimer = null; // 拖动结束判定（在 createWindow 内注册监听，win 此时才存在）

ipcMain.on('win:dock-hover', () => {
  if (!win || !dock.side || !dock.hidden || win.isAlwaysOnTop()) return;
  const b = win.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x + (b.width >> 1), y: b.y + (b.height >> 1) }).workArea;
  dock.hidden = false;
  sendDockState();
  slideDockTo(dockX(dock.side, true, b.width, wa));
});
ipcMain.on('win:dock-leave', () => {
  if (!win || !dock.side || dock.hidden || win.isAlwaysOnTop()) return;
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

// ---------- 生命周期 ----------
app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
