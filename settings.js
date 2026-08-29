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

// 左侧目录切换
document.querySelectorAll('.nav-item').forEach((n) => {
  n.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.toggle('active', x === n));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + n.dataset.panel));
  });
});

api.getSettings().then((s) => { current = s; render(); });
