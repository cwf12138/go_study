(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const app = $('app-view'), sidebar = $('app-sidebar'), menu = $('mobile-menu');
  const toast = $('toast'), message = $('toast-message'), dismiss = $('toast-dismiss');
  if (!app || !sidebar || !menu || !toast || !message || !dismiss) return;
  let timer = null, paused = false, current = null, queued = null, menuOpen = false;
  const mobile = window.matchMedia('(max-width: 900px)');
  const workspace = document.querySelector('.workspace');
  const backdrop = $('navigation-backdrop');
  document.querySelector('.skip-to-content')?.addEventListener('click', event => { event.preventDefault(); $('main-content').focus(); $('main-content').scrollIntoView({ block: 'start' }); });
  function hideNotice() {
    window.clearTimeout(timer); timer = null; current = null;
    toast.classList.remove('visible'); toast.hidden = true;
    if (queued) { const next = queued; queued = null; notify(next.message, next.type); }
  }
  function schedule() {
    window.clearTimeout(timer);
    if (current && current.type !== 'error' && !paused) timer = window.setTimeout(hideNotice, 6000);
  }
  function notify(text, type = 'success') {
    text = String(text || '').trim(); if (!text) return;
    type = type === 'error' || type === true ? 'error' : 'success';
    // A background success must not silently replace an unresolved error.
    if (current?.type === 'error' && type !== 'error') { queued = { message: text, type }; return; }
    current = { message: text, type }; paused = false;
    message.setAttribute('role', type === 'error' ? 'alert' : 'status');
    message.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    message.textContent = text;
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    const host = document.activeElement?.closest('dialog[open]') || dialogs.at(-1) || document.body;
    host.append(toast); toast.hidden = false; toast.className = 'toast product-toast visible' + (type === 'error' ? ' error' : '');
    schedule();
  }
  dismiss.addEventListener('click', hideNotice);
  toast.addEventListener('mouseenter', () => { paused = true; window.clearTimeout(timer); });
  toast.addEventListener('mouseleave', () => { paused = toast.contains(document.activeElement); schedule(); });
  toast.addEventListener('focusin', () => { paused = true; window.clearTimeout(timer); });
  toast.addEventListener('focusout', event => { paused = toast.contains(event.relatedTarget); schedule(); });
  document.addEventListener('close', event => { if (toast.parentElement === event.target) document.body.append(toast); }, true);
  function setMenu(open, restore = true) {
    menuOpen = !!open && mobile.matches && !app.classList.contains('hidden');
    sidebar.classList.toggle('open', menuOpen); backdrop.hidden = !menuOpen;
    menu.setAttribute('aria-expanded', String(menuOpen)); menu.setAttribute('aria-label', menuOpen ? '关闭菜单' : '打开菜单');
    sidebar.inert = mobile.matches && !menuOpen;
    workspace.inert = menuOpen;
    document.body.classList.toggle('navigation-open', menuOpen);
    if (menuOpen) sidebar.querySelector('[aria-current="page"]')?.focus();
    else if (restore && sidebar.contains(document.activeElement)) menu.focus();
  }
  backdrop.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', event => {
    if (!menuOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); setMenu(false); }
    if (event.key !== 'Tab') return;
    const controls = [...sidebar.querySelectorAll('a[href],button:not(:disabled)')].filter(node => !node.hidden && (typeof node.getClientRects !== 'function' || node.getClientRects().length > 0));
    if (!controls.length) return;
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  mobile.addEventListener('change', () => setMenu(false));
  new MutationObserver(() => { if (app.classList.contains('hidden')) setMenu(false, false); }).observe(app, { attributes: true, attributeFilter: ['class'] });

  // Only explicit unsaved forms are guarded. No draft text is stored on disk.
  const drafts = new Map();
  const guards = new Map();
  const values = form => JSON.stringify([...form.elements].filter(n => n.name || n.id).filter(n => !['submit','button','hidden'].includes(n.type)).map(n => [n.id || n.name, n.type === 'checkbox' || n.type === 'radio' ? n.checked : n.value]));
  function guardedForm(target) { const form = target?.closest?.('form[data-draft-guard]'); return form && !form.closest('.hidden') ? form : null; }
  document.addEventListener('focusin', event => { const form = guardedForm(event.target); if (form && !drafts.get(form)?.touched) drafts.set(form, { baseline: values(form), touched: false }); });
  const touch = event => { const form = guardedForm(event.target); const draft = form && drafts.get(form); if (draft) draft.touched = true; };
  document.addEventListener('input', touch); document.addEventListener('change', touch);
  document.addEventListener('reset', event => { if (event.target.matches?.('form[data-draft-guard]')) queueMicrotask(() => drafts.set(event.target, { baseline: values(event.target), touched: false })); }, true);
  const hasDrafts = () => [...drafts].some(([form, draft]) => draft.touched && values(form) !== draft.baseline) || [...guards.values()].some(check => { try { return !!check(); } catch (_) { return true; } });
  window.addEventListener('beforeunload', event => { if (hasDrafts()) { event.preventDefault(); event.returnValue = ''; } });
  $('logout')?.addEventListener('click', event => { if (hasDrafts() && !window.confirm('仍有未保存的内容、待确认的操作或进行中的任务。退出可能丢失本页内容，确定退出吗？')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  document.addEventListener('daynest:account-ready', () => { drafts.clear(); queued = null; hideNotice(); });

  // Inline native-constraint errors retain existing descriptions and never use HTML.
  let validationSequence = 0, focusScheduled = false;
  const invalidFields = new Map();
  function clearError(field) {
    const record = invalidFields.get(field); if (!record) return;
    record.node.remove();
    if (record.described == null) field.removeAttribute('aria-describedby'); else field.setAttribute('aria-describedby', record.described);
    if (record.invalid == null) field.removeAttribute('aria-invalid'); else field.setAttribute('aria-invalid', record.invalid);
    invalidFields.delete(field);
  }
  document.addEventListener('invalid', event => {
    const field = event.target; if (!field.form) return;
    event.preventDefault();
    let record = invalidFields.get(field);
    if (!record) {
      const node = document.createElement('span'); node.id = 'field-error-' + (++validationSequence); node.className = 'product-field-error';
      record = { node, described: field.getAttribute('aria-describedby'), invalid: field.getAttribute('aria-invalid') };
      invalidFields.set(field, record); field.insertAdjacentElement('afterend', node);
      field.setAttribute('aria-describedby', [record.described, node.id].filter(Boolean).join(' ')); field.setAttribute('aria-invalid', 'true');
    }
    record.node.textContent = field.validationMessage || '请检查此项输入。';
    if (!focusScheduled) {
      focusScheduled = true;
      queueMicrotask(() => { focusScheduled = false; const first = field.form.querySelector(':invalid'); if (!first) return; let parent = first.parentElement; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } first.focus(); });
    }
  }, true);
  const checkField = event => { if (invalidFields.has(event.target) && event.target.validity.valid) clearError(event.target); };
  document.addEventListener('input', checkField); document.addEventListener('change', checkField);
  document.addEventListener('reset', event => { for (const field of [...invalidFields.keys()]) if (field.form === event.target) clearError(field); }, true);
  document.addEventListener('daynest:account-ready', () => { for (const field of [...invalidFields.keys()]) clearError(field); });
  window.DaynestUI = { notify, setMenu, registerGuard(name, check) { guards.set(name, check); }, reset() { queued = null; hideNotice(); message.textContent = ''; drafts.clear(); setMenu(false, false); for (const field of [...invalidFields.keys()]) clearError(field); } };
  setMenu(false, false);
})();
