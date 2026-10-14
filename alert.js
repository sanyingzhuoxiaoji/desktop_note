const api = window.alertApi;
const $ = (sel) => document.querySelector(sel);

api.onAlertData(({ src, text }) => {
  const pic = $('#pic');
  if (src) {
    pic.src = src;
    pic.hidden = false;
  } else {
    pic.hidden = true;
    pic.src = '';
  }
  $('#text').textContent = text || '（图片待办）';
});

$('#open-btn').addEventListener('click', () => api.alertAction('open'));
$('#ok-btn').addEventListener('click', () => api.alertAction('dismiss'));
