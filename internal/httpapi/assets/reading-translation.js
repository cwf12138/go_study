(() => {
  'use strict';
  const widgets = new Map();
  const cache = new Map();
  let cacheOwner;

  function setSource(name, text = '') {
    const widget = widgets.get(name);
    if (!widget || widget.source === text) return;
    widget.pending?.abort();
    widget.pending = null;
    widget.source = text;
    widget.status.textContent = '';
    widget.result.textContent = '';
    widget.button.disabled = !text.trim();
    setOpen(widget, false);
  }

  function setOpen(widget, open) {
    widget.panel.hidden = !open;
    widget.button.setAttribute('aria-expanded', String(open));
    widget.button.textContent = open ? '收起译文' : widget.label;
  }

  function show(widget, translation) {
    widget.result.textContent = translation;
    widget.status.textContent = '中文译文';
    setOpen(widget, true);
  }

  async function toggle(widget) {
    if (!widget.panel.hidden && widget.result.textContent) {
      setOpen(widget, false);
      return;
    }
    if (!widget.source || widget.pending) return;
    const http = window.DaynestHTTP;
    const source = widget.source;
    const controller = new AbortController();
    widget.pending = controller;
    widget.button.disabled = true;
    widget.button.textContent = '翻译中…';
    widget.button.setAttribute('aria-expanded', 'true');
    widget.panel.hidden = false;
    widget.result.textContent = '';
    widget.status.textContent = '正在生成中文译文…';
    try {
      const context = http.capture();
      if (!cacheOwner || !http.current(cacheOwner)) {
        cache.clear();
        cacheOwner = context;
      }
      const hit = cache.get(source);
      if (hit) {
        show(widget, hit);
        return;
      }
      const data = await http.json('/api/v1/reading/translate', {
        method: 'POST', body: {text: source}, context, signal: controller.signal, timeoutMs: 62000, maxBytes: 64 << 10,
      });
      if (widget.pending !== controller || !http.current(context)) return;
      const translation = typeof data?.translation === 'string' ? data.translation.trim() : '';
      if (!translation) throw new Error('服务未返回译文，请重试。');
      if (cache.size >= 16) cache.delete(cache.keys().next().value);
      cache.set(source, translation);
      show(widget, translation);
    } catch (error) {
      if (widget.pending !== controller) return;
      widget.status.textContent = error.status === 404 ? '请更新 Daynest 服务后重试。' :
        error.kind === 'timeout' ? '翻译超时，可以重试。' : error.message;
      widget.button.textContent = '重试翻译';
    } finally {
      if (widget.pending === controller) {
        widget.pending = null;
        widget.button.disabled = false;
      }
    }
  }

  for (const root of document.querySelectorAll('[data-reading-translation]')) {
    const button = root.querySelector('button');
    const widget = {
      button, label: button.textContent, source: '', pending: null,
      panel: root.querySelector('[data-translation-panel]'),
      status: root.querySelector('[data-translation-status]'),
      result: root.querySelector('[data-translation-result]'),
    };
    const name = root.dataset.readingTranslation;
    widgets.set(name, widget);
    button.addEventListener('click', () => toggle(widget));
    root.closest('dialog')?.addEventListener('close', () => setSource(name));
  }

  function clearAccount() {
    cache.clear();
    cacheOwner = null;
    for (const name of widgets.keys()) setSource(name);
  }
  document.addEventListener('daynest:account-ready', () => {
    if (cacheOwner && !window.DaynestHTTP.current(cacheOwner)) clearAccount();
  });
  document.addEventListener('daynest:auth-expired', clearAccount);
  window.addEventListener('storage', event => {
    if (!event.key || event.key === 'studyflow.token') clearAccount();
  });
  window.DaynestReadingTranslation = {setSource};
})();
