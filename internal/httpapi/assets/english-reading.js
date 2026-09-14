(() => {
  'use strict';
  const select = document.querySelector('#english-reading-size');
  const dialog = document.querySelector('#english-reader-dialog');
  const status = document.querySelector('#english-type-status');
  if (!select || !dialog || !status) return;
  const key = 'studyflow.english.reading-size';
  const allowed = ['18', '22', '26'];
  function apply(value, persist) {
    const size = allowed.includes(value) ? value : '22';
    select.value = size;
    dialog.style.setProperty('--english-reading-size', size + 'px');
    status.textContent = '正文 ' + size + 'px';
    if (persist) {
      try { localStorage.setItem(key, size); }
      catch { status.textContent += ' · 当前浏览器无法保存偏好'; }
    }
  }
  let saved = '22';
  try { saved = localStorage.getItem(key) || '22'; } catch { /* Reading works without storage. */ }
  apply(saved, false);
  select.addEventListener('change', () => apply(select.value, true));
})();
