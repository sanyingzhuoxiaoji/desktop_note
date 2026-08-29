window.viewerApi.onImg(({ src }) => {
  document.getElementById('viewer-img').src = src;
});

// 点击图片或按 Esc 关闭查看窗口（标题栏的原生操作不受影响）
document.addEventListener('click', () => window.viewerApi.close());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.viewerApi.close();
});
