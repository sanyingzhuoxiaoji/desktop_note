const api = window.stickyApi;

// ---------- 状态 ----------
let state = {
  version: 1,
  title: '待办',
  themeColor: '#FFF9B1', // 皮肤底色，配套文字/点缀色由 HSL 推导
  bgImage: null,         // 背景图 dataURL（null = 纯色模式）
  collapsed: true,
  items: [] // {id, text, images[], status, createdAt, finishedAt, droppedAt, note}
};

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const body = document.body;
const skinBtn = $('#skin-btn');
const skinPop = $('#skin-pop');
const titleLabel = $('#note-title');
const titleInput = $('#note-title-input');
const renameBtn = $('#rename-btn');
const composer = $('#composer');
const todoList = $('#todo-list');
const doneList = $('#done-list');
const droppedList = $('#dropped-list');
const doneToggle = $('#done-toggle');
const doneBody = $('#done-body');
const doneCount = $('#done-count');
const labelDone = $('#label-done');
const labelDropped = $('#label-dropped');
const emptyArchive = $('#empty-archive');
const noteBody = $('#note-body');
const grip = $('#resize-grip');
const pinBtn = $('#pin-btn');

// ---------- 工具 ----------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtStart(iso) {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtFull(iso) {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function readText(el) {
  return el.innerText.replace(/\n+$/, '');
}
function findItem(id) {
  return state.items.find((x) => x.id === id);
}

// ---------- 持久化（防抖保存 + 关闭前同步落盘） ----------
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveData(serialize()), 300);
}
function serialize() {
  return { ...state };
}
function flushSave() {
  clearTimeout(saveTimer);
  api.flushData(serialize());
}

// ---------- 数据操作 ----------
function createItem(text = '', index = state.items.length, images = []) {
  const item = {
    id: uid(),
    text,
    images,
    status: 'todo',
    createdAt: new Date().toISOString(),
    finishedAt: null,
    droppedAt: null,
    note: ''
  };
  state.items.splice(index, 0, item);
  return item;
}

// ---------- 渲染 ----------
function mkBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function renderItem(item) {
  const el = document.createElement('div');
  el.className = 'item ' + item.status;
  el.dataset.id = item.id;

  // 复选框（已放弃项隐藏，保持对齐）
  const check = document.createElement('label');
  check.className = 'check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = item.status === 'done';
  if (item.status === 'dropped') check.style.visibility = 'hidden';
  cb.addEventListener('change', () => {
    const it = findItem(item.id);
    if (!it) return;
    if (cb.checked) {
      it.status = 'done';
      it.finishedAt = new Date().toISOString();
    } else {
      it.status = 'todo';
      it.finishedAt = null;
    }
    renderAll();
    scheduleSave();
  });
  check.appendChild(cb);
  el.appendChild(check);

  // 主体
  const main = document.createElement('div');
  main.className = 'item-main';

  const textEl = document.createElement('div');
  textEl.className = 'item-text';
  textEl.contentEditable = 'plaintext-only';
  textEl.dataset.placeholder = '输入内容…';
  textEl.textContent = item.text;
  textEl.addEventListener('input', () => {
    const it = findItem(item.id);
    if (it) { it.text = readText(textEl); scheduleSave(); }
  });
  // 输入法合成状态跟踪（keydown 的 isComposing 在部分 IME 时序下不可靠，自行计数）
  let composing = 0;
  textEl.addEventListener('compositionstart', () => { composing++; });
  textEl.addEventListener('compositionend', () => { composing = Math.max(0, composing - 1); });
  textEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // 任何 Enter（含输入法提交的那次）都不允许浏览器插入换行
    if (composing > 0 || e.keyCode === 229) return; // 输入法提交用的 Enter：到此为止
    if (e.ctrlKey || e.metaKey) {
      insertNewline(textEl);
      const it = findItem(item.id);
      if (it) { it.text = readText(textEl); scheduleSave(); }
      return;
    }
    const it = findItem(item.id);
    if (!it) return;
    it.text = readText(textEl);
    if (!it.text && it.images.length === 0) return; // 空项不再分裂新项
    let idx = state.items.findIndex((x) => x.id === item.id);
    if (it.status !== 'todo') idx = state.items.length; // 已完成/已放弃项上回车 → 新项排到最后
    const created = createItem('', idx + 1);
    renderAll();
    scheduleSave();
    focusItem(created.id);
  });
  textEl.addEventListener('paste', (e) => onItemPaste(e, item.id));
  main.appendChild(textEl);

  // 图片缩略图（悬停出现 ✕ 可删除单张）
  if (item.images.length) {
    const imgs = document.createElement('div');
    imgs.className = 'item-images';
    item.images.forEach((src, idx) => {
      const wrap = document.createElement('span');
      wrap.className = 'img-wrap';
      const im = document.createElement('img');
      im.src = src;
      im.draggable = false;
      im.title = '点击放大';
      im.addEventListener('click', () => api.viewImage({ src, w: im.naturalWidth || 800, h: im.naturalHeight || 600 }));
      const del = document.createElement('button');
      del.className = 'img-del';
      del.title = '删除这张图片';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const it = findItem(item.id);
        if (!it) return;
        it.images.splice(idx, 1);
        // 纯图片条目删掉最后一张图后整条移除，避免留下空行
        if (!it.text && it.images.length === 0) {
          state.items = state.items.filter((x) => x.id !== it.id);
        }
        renderAll();
        scheduleSave();
      });
      wrap.appendChild(im);
      wrap.appendChild(del);
      imgs.appendChild(wrap);
    });
    main.appendChild(imgs);
  }

  // 时间戳（格式例：开始:03-08 完成:03-24 14:07）
  if (item.status === 'done' && item.finishedAt) {
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = `开始:${fmtStart(item.createdAt)} 完成:${fmtFull(item.finishedAt)}`;
    main.appendChild(meta);
  } else if (item.status === 'dropped' && item.droppedAt) {
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = `开始:${fmtStart(item.createdAt)} 放弃:${fmtFull(item.droppedAt)}`;
    main.appendChild(meta);
  }

  // 备注（已完成/已放弃项）
  if (item.status !== 'todo') {
    const noteInput = document.createElement('input');
    noteInput.className = 'item-note-input';
    noteInput.placeholder = '添加备注…';
    noteInput.value = item.note || '';
    if (item.note) noteInput.classList.add('has-value');
    noteInput.addEventListener('input', () => {
      const it = findItem(item.id);
      if (!it) return;
      it.note = noteInput.value;
      noteInput.classList.toggle('has-value', !!noteInput.value);
      scheduleSave();
    });
    main.appendChild(noteInput);
  }
  el.appendChild(main);

  // 悬停操作
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  if (item.status === 'todo') {
    actions.appendChild(mkBtn('✕', '放弃', () => {
      const it = findItem(item.id);
      if (!it) return;
      it.status = 'dropped';
      it.droppedAt = new Date().toISOString();
      it.finishedAt = null;
      renderAll();
      scheduleSave();
    }));
  } else {
    actions.appendChild(mkBtn('✎', '备注', () => {
      const input = el.querySelector('.item-note-input');
      el.classList.toggle('note-open');
      if (el.classList.contains('note-open')) input.focus();
    }));
    actions.appendChild(mkBtn('🗑', '删除', () => {
      state.items = state.items.filter((x) => x.id !== item.id);
      renderAll();
      scheduleSave();
    }));
  }
  el.appendChild(actions);
  return el;
}

function renderAll() {
  todoList.textContent = '';
  doneList.textContent = '';
  droppedList.textContent = '';
  let doneN = 0;
  let dropN = 0;
  for (const it of state.items) {
    const el = renderItem(it);
    if (it.status === 'todo') todoList.appendChild(el);
    else if (it.status === 'done') { doneList.appendChild(el); doneN++; }
    else { droppedList.appendChild(el); dropN++; }
  }
  doneCount.textContent = String(doneN + dropN);
  labelDone.hidden = doneN === 0;
  labelDropped.hidden = dropN === 0;
  emptyArchive.hidden = doneN + dropN > 0;
}

function focusItem(id) {
  const el = todoList.querySelector(`.item[data-id="${CSS.escape(id)}"] .item-text`);
  if (el) el.focus();
}

// ---------- 快捷键：Enter 新增 / Ctrl+Enter 换行 ----------
function insertNewline(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tn = document.createTextNode('\n');
  range.insertNode(tn);
  const after = document.createRange();
  after.setStartAfter(tn);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
}

// 中文输入法：合成提交用的 Enter 只确认文字，不新增、不换行；
// 确认完再按 Enter 才新增一条（与微信/Slack 输入框一致）
let composing = 0;
composer.addEventListener('compositionstart', () => { composing++; });
composer.addEventListener('compositionend', () => { composing = Math.max(0, composing - 1); });

composer.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault(); // 任何 Enter（含输入法提交的那次）都不允许浏览器插入换行
  if (composing > 0 || e.keyCode === 229) return; // 输入法提交用的 Enter：到此为止
  if (e.ctrlKey || e.metaKey) {
    insertNewline(composer);
    return;
  }
  const text = readText(composer);
  if (!text) return;
  createItem(text);
  composer.textContent = '';
  renderAll();
  scheduleSave();
});

// ---------- 图片：降采样后以 dataURL 存入数据文件 ----------
const BG_MAX_SIDE = 1920; // 背景图降采样上限

// 待办图片：直接读原图 dataURL，不缩放、不重编码（保持原图清晰度）
function readAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result) || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function processImage(file, maxSide = BG_MAX_SIDE) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          if (scale >= 1 && raw.length < 300 * 1024) return resolve(raw);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL('image/webp', 0.85); // webp 保留透明通道
          resolve(out && out !== 'data:,' ? out : raw);
        } catch { resolve(raw); }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function imagesFromClipboard(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return [];
  const files = [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

// 已完成/未完成项内粘贴图片 → 追加到该项
function onItemPaste(e, id) {
  const files = imagesFromClipboard(e);
  if (!files.length) return; // 纯文本走默认粘贴
  e.preventDefault();
  (async () => {
    const it = findItem(id);
    if (!it) return;
    for (const f of files) it.images.push(await readAsDataURL(f));
    renderAll();
    scheduleSave();
  })();
}

// 图片放大预览改为独立查看窗口（main.js 的 img:view IPC）

// ---------- 图片粘贴 / 拖拽 ----------
composer.addEventListener('paste', (e) => {
  const files = imagesFromClipboard(e);
  if (!files.length) return;
  e.preventDefault();
  (async () => {
    let last = null;
    for (const f of files) {
      const dataUrl = await readAsDataURL(f);
      last = createItem('', state.items.length, [dataUrl]);
    }
    renderAll();
    scheduleSave();
    if (last) focusItem(last.id);
  })();
});

noteBody.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  noteBody.classList.add('drag-over');
});
noteBody.addEventListener('dragleave', (e) => {
  if (!noteBody.contains(e.relatedTarget)) noteBody.classList.remove('drag-over');
});
noteBody.addEventListener('drop', (e) => {
  e.preventDefault();
  noteBody.classList.remove('drag-over');
  const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  (async () => {
    const itemEl = e.target.closest('.item');
    if (itemEl && findItem(itemEl.dataset.id)) {
      const it = findItem(itemEl.dataset.id);
      for (const f of files) it.images.push(await readAsDataURL(f));
    } else {
      for (const f of files) {
        createItem('', state.items.length, [await readAsDataURL(f)]);
      }
    }
    renderAll();
    scheduleSave();
  })();
});

// 屏蔽窗口级拖放默认行为（防止误拖动非图片文件时导航）
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- 折叠区 ----------
function applyCollapse() {
  doneBody.classList.toggle('open', !state.collapsed);
  doneToggle.classList.toggle('open', !state.collapsed);
}
doneToggle.addEventListener('click', () => {
  state.collapsed = !state.collapsed;
  applyCollapse();
  scheduleSave();
});

// ---------- 皮肤（底色 + HSL 自动推导配套文字/点缀色） ----------
const PRESETS = ['#FFF9B1', '#D2F5D3', '#C8F0E0', '#CDE7FA', '#E5DDF8', '#FBD9E8', '#FFE3C2', '#E9E9E5'];

function hexToHsl(hex) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function hslCss(h, s, l) {
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}
function applySkin(hex) {
  const { h, s, l } = hexToHsl(hex);
  const dark = l < 0.55; // 深色底自动反白文字
  body.style.setProperty('--note-bg-color', hex);
  body.style.setProperty('--note-text', hslCss(h, s, dark ? 0.88 : 0.28));
  body.style.setProperty('--note-subtext', hslCss(h, s * 0.55, dark ? 0.70 : 0.45));
  body.style.setProperty('--accent', hslCss(h, Math.min(1, s * 0.9 + 0.15), dark ? 0.62 : 0.42));
  skinPop.querySelectorAll('.swatch[data-color]').forEach((sw) => {
    sw.classList.toggle('active', sw.dataset.color.toLowerCase() === hex.toLowerCase());
  });
}

function buildSkinPop() {
  for (const c of PRESETS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.title = c;
    b.style.background = c; // CSSOM 赋值不受 CSP style-src 限制
    b.dataset.color = c;
    b.addEventListener('click', () => {
      state.themeColor = c;
      applySkin(c);
      scheduleSave();
    });
    skinPop.appendChild(b);
  }
  // 🎨 自定义色：藏在色格里的取色器，拖动实时预览、确定后落盘
  const custom = document.createElement('button');
  custom.className = 'swatch custom';
  custom.title = '自定义颜色';
  custom.textContent = '🎨';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = state.themeColor;
  custom.appendChild(picker);
  custom.addEventListener('click', () => picker.click());
  picker.addEventListener('input', () => {
    state.themeColor = picker.value;
    applySkin(picker.value);
  });
  picker.addEventListener('change', () => scheduleSave());
  skinPop.appendChild(custom);

  // 底部操作行：上传图片背景 / 清除背景
  const foot = document.createElement('div');
  foot.className = 'skin-foot';
  const bgBtn = document.createElement('button');
  bgBtn.className = 'skin-action';
  bgBtn.textContent = '🖼 图片背景';
  const bgInput = document.createElement('input');
  bgInput.type = 'file';
  bgInput.accept = 'image/*';
  bgBtn.title = '上传图片作为便签背景';
  bgBtn.addEventListener('click', () => bgInput.click());
  bgInput.addEventListener('change', async () => {
    const f = bgInput.files && bgInput.files[0];
    if (!f) return;
    const dataUrl = await processImage(f, BG_MAX_SIDE);
    if (dataUrl) {
      state.bgImage = dataUrl;
      applyBackground();
      scheduleSave();
    }
    bgInput.value = '';
  });
  const clearBtn = document.createElement('button');
  clearBtn.className = 'skin-action clear-bg';
  clearBtn.textContent = '清除背景';
  clearBtn.addEventListener('click', () => {
    state.bgImage = null;
    applyBackground();
    scheduleSave();
  });
  foot.appendChild(bgBtn);
  foot.appendChild(clearBtn);
  skinPop.appendChild(foot);
}

// ---------- 背景图：写入既有 CSS 变量（--note-bg-image 等均为预留扩展点） ----------
function applyBackground() {
  if (state.bgImage) {
    body.style.setProperty('--note-bg-image', `url("${state.bgImage}")`);
    body.style.setProperty('--note-bg-size', 'cover');
    body.style.setProperty('--note-bg-repeat', 'no-repeat');
  } else {
    body.style.setProperty('--note-bg-image', 'none');
  }
  skinPop.classList.toggle('has-bg', !!state.bgImage);
}

skinBtn.addEventListener('click', () => {
  skinPop.hidden = !skinPop.hidden;
});
document.addEventListener('mousedown', (e) => {
  if (skinPop.hidden) return;
  if (skinPop.contains(e.target) || skinBtn.contains(e.target)) return;
  skinPop.hidden = true;
});

// ---------- 标题重命名（✎ 进入编辑；Enter/失焦保存，Esc 取消） ----------
let renaming = false;
function startRename() {
  renaming = true;
  titleLabel.hidden = true;
  titleInput.hidden = false;
  titleInput.value = state.title;
  titleInput.focus();
  titleInput.select();
}
function endRename(commit) {
  if (!renaming) return;
  renaming = false;
  if (commit) {
    state.title = titleInput.value.trim() || '待办';
    scheduleSave();
  }
  titleLabel.textContent = state.title;
  titleInput.hidden = true;
  titleLabel.hidden = false;
}
renameBtn.addEventListener('click', startRename);
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    endRename(true);
  } else if (e.key === 'Escape') {
    endRename(false);
  }
});
titleInput.addEventListener('blur', () => endRename(true));

pinBtn.addEventListener('click', () => {
  const next = !pinBtn.classList.contains('active');
  pinBtn.classList.toggle('active', next);
  api.setAlwaysOnTop(next);
});

$('#close-btn').addEventListener('click', () => api.closeWindow());

// ---------- 右下角缩放 ----------
let resizing = false;
let rafPending = false;
grip.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizing = true;
  api.resizeStart();
});
window.addEventListener('mousemove', () => {
  if (!resizing || rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (resizing) api.resizeMove();
  });
});
window.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  api.resizeEnd();
});

// ---------- 贴边隐藏联动：悬停边条/窗口聚焦 → 滑出；离开窗口 → 滑回 ----------
document.addEventListener('mouseenter', () => api.dockHover());
// 从任务栏/Alt+Tab 唤回时若处于收起态，聚焦即滑出（否则只剩一条边）
window.addEventListener('focus', () => api.dockHover());
let lastKeyAt = 0; // 最近一次按键时刻：打字中鼠标离开不收起
window.addEventListener('keydown', () => { lastKeyAt = Date.now(); }, true);
document.addEventListener('mouseleave', () => {
  if (Date.now() - lastKeyAt < 2000) return; // 2 秒内还在打字，不收起
  api.dockLeave();
});
window.addEventListener('blur', () => api.dockLeave()); // 切去别的应用即收起
// 收起时头部临时取消拖拽区（drag 区域不产生鼠标事件，会导致边条上半段无法响应悬停）
api.onDockState(({ hidden }) => body.classList.toggle('docked-hidden', !!hidden));

// ---------- Esc 关闭皮肤色板 ----------
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !skinPop.hidden) skinPop.hidden = true;
});

// ---------- 初始化 ----------
async function init() {
  const saved = await api.loadData();
  if (saved && Array.isArray(saved.items)) {
    state = { ...state, ...saved };
  }
  if (!state.themeColor) {
    // 旧数据迁移：theme: 'yellow'|'green' → themeColor
    state.themeColor = state.theme === 'green' ? '#D2F5D3' : '#FFF9B1';
    delete state.theme;
  }
  titleLabel.textContent = state.title;
  buildSkinPop();
  applySkin(state.themeColor);
  applyBackground();
  applyCollapse();
  renderAll();
}
init();

window.addEventListener('beforeunload', flushSave);
