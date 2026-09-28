const api = window.stickyApi;
const $ = (sel) => document.querySelector(sel);

let current = { fontSize: 13, fontWeight: 400, autoStart: false };

const WEIGHT_NAMES = { 300: '细', 400: '常规', 500: '中等', 600: '较粗', 700: '粗' };

function render() {
  $('#font-size').value = current.fontSize;
  $('#font-weight').value = current.fontWeight;
  $('#font-size-val').textContent = current.fontSize + 'px';
  $('#font-weight-val').textContent = (WEIGHT_NAMES[current.fontWeight] || '') + ' · ' + current.fontWeight;
  $('#auto-start').checked = current.autoStart;
  const pv = $('#preview');
  pv.style.fontSize = current.fontSize + 'px';
  pv.style.fontWeight = current.fontWeight;
  renderReminderImage();
}

function commit(patch) {
  api.setSettings(patch).then((s) => {
    current = s;
    render();
    // 自启动请求与实际状态不一致 = 被安全软件拦截
    const hint = $('#boot-hint');
    if (typeof patch.autoStart === 'boolean' && patch.autoStart !== s.autoStart) {
      hint.textContent = patch.autoStart
        ? '未生效：可能被安全软件拦截，请在弹窗/安全软件中允许后重试'
        : '未关闭：可能被安全软件拦截，请检查安全软件的启动项管理';
    } else if (hint.textContent) {
      hint.textContent = '';
    }
  });
}

$('#font-size').addEventListener('input', (e) => commit({ fontSize: +e.target.value }));
$('#font-weight').addEventListener('input', (e) => commit({ fontWeight: +e.target.value }));
$('#auto-start').addEventListener('change', (e) => commit({ autoStart: e.target.checked }));

// ---------- 提醒图片（全局兜底图：上传 → 降采样 → setSettings） ----------
function processImage(file, maxSide = 1920) {
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
          const out = canvas.toDataURL('image/webp', 0.85);
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

function renderReminderImage() {
  const pv = $('#remind-img-preview');
  if (current.reminderImage) {
    pv.src = current.reminderImage;
    pv.hidden = false;
  } else {
    pv.hidden = true;
    pv.src = '';
  }
}

$('#remind-img-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const dataUrl = await processImage(f);
    if (dataUrl) commit({ reminderImage: dataUrl });
  });
  input.click();
});
$('#remind-img-clear').addEventListener('click', () => commit({ reminderImage: null }));

// 左侧目录切换
document.querySelectorAll('.nav-item').forEach((n) => {
  n.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.toggle('active', x === n));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + n.dataset.panel));
  });
});

api.getSettings().then((s) => { current = s; render(); });
