(() => {
  'use strict';
  const C = window.DaynestNavigation, $ = id => document.getElementById(id);
  const nav = document.querySelector('.daynest-nav'), dialog = $('navigation-settings');
  if (!C || !nav || !dialog) return;
  const groups = [...nav.querySelectorAll('.nav-group')].map((node, index) => ({ node, index, title: node.querySelector('.nav-group-label').textContent.trim(), pages: [...node.querySelectorAll('.nav-link[data-view]')] }));
  const pages = groups.flatMap(group => group.pages.map(button => ({ button, id: button.dataset.view, group: group.title, title: [...button.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim() || button.textContent.trim() })));
  const ids = pages.map(page => page.id), expanded = new Set();
  let owner = '', accountToken = '', saved = C.defaults(ids), draft = null, conflict = false;
  const key = () => 'daynest.navigation.' + owner;
  const active = () => !!owner && accountToken === (localStorage.getItem('studyflow.token') || '') && !$('app-view').classList.contains('hidden');
  const dirty = () => !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const status = text => { $('navigation-settings-status').textContent = text; };
  function renderNavigation() {
    nav.classList.toggle('nav-compact', saved.compact);
    for (const group of groups) {
      const extras = group.pages.filter(button => !saved.primary.includes(button.dataset.view));
      group.node.dataset.navCollapsed = String(!expanded.has(group.index));
      for (const button of group.pages) button.dataset.navOptional = String(!saved.primary.includes(button.dataset.view));
      group.more.hidden = !saved.compact || !extras.length;
      group.more.setAttribute('aria-expanded', String(expanded.has(group.index)));
      group.more.textContent = expanded.has(group.index) ? '收起扩展入口 ↑' : `其他 ${extras.filter(button => !button.classList.contains('active')).length} 项 ↓`;
      if (saved.compact && extras.length && extras.every(button => button.classList.contains('active'))) group.more.hidden = true;
    }
  }
  for (const group of groups) {
    const more = document.createElement('button'); more.type = 'button'; more.className = 'nav-more'; more.hidden = true;
    group.node.id ||= 'navigation-group-' + group.index;
    more.setAttribute('aria-controls', group.node.id);
    more.addEventListener('click', () => { if (expanded.has(group.index)) expanded.delete(group.index); else expanded.add(group.index); renderNavigation(); });
    group.node.append(more); group.more = more;
  }
  function editor() {
    $('navigation-compact').checked = draft.compact;
    const list = $('navigation-options'); list.replaceChildren();
    for (const group of groups) {
      const section = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = group.title; section.append(legend);
      for (const page of pages.filter(page => page.group === group.title)) {
        const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
        input.type = 'checkbox'; input.checked = draft.primary.includes(page.id); input.disabled = page.id === 'dashboard'; input.dataset.navigationPage = page.id;
        text.textContent = page.title; label.append(input, text); section.append(label);
      }
      list.append(section);
    }
    $('navigation-count').textContent = `${draft.primary.length} 个常用入口 · 其余功能可随时展开`;
  }
  function load() {
    let result;
    try { result = C.read(localStorage.getItem(key()), ids); }
    catch (_) { result = { value: C.defaults(ids), recovered: true }; }
    saved = result.value; renderNavigation(); return result.recovered;
  }
  function reset() { owner = ''; accountToken = ''; draft = null; conflict = false; expanded.clear(); dialog.close(); saved = C.defaults(ids); renderNavigation(); $('navigation-options').replaceChildren(); status(''); }
  function close() { if (dirty() && !window.confirm('导航选择尚未保存，确定放弃修改吗？')) return; draft = null; dialog.close(); }
  $('navigation-manage').addEventListener('click', () => {
    if (!active()) return;
    const recovered = load(); draft = structuredClone(saved); conflict = false; editor(); window.DaynestUI?.setMenu?.(false, false); dialog.showModal();
    status(recovered ? '本机偏好不可用，已使用推荐布局；保存后可覆盖损坏的偏好。' : '只整理入口，不关闭功能、不删除记录。偏好仅保存在当前浏览器。');
  });
  $('navigation-options').addEventListener('change', event => {
    const id = event.target.dataset.navigationPage; if (!draft || !ids.includes(id) || id === 'dashboard') return;
    const selected = new Set(draft.primary); if (event.target.checked) selected.add(id); else selected.delete(id);
    draft = C.normalize({ ...draft, primary: [...selected] }, ids);
    $('navigation-count').textContent = `${draft.primary.length} 个常用入口 · 其余功能可随时展开`;
  });
  $('navigation-compact').addEventListener('change', () => { if (draft) draft.compact = $('navigation-compact').checked; });
  $('navigation-recommended').addEventListener('click', () => { draft = C.defaults(ids); editor(); status('已选用推荐布局，点击保存后生效。'); });
  $('navigation-save').addEventListener('click', () => {
    if (!active() || !draft) return;
    if (conflict && !window.confirm('其他标签页已调整导航，确定用当前选择覆盖吗？')) return;
    try { const value = C.normalize(draft, ids); localStorage.setItem(key(), JSON.stringify(value)); saved = value; draft = null; conflict = false; expanded.clear(); renderNavigation(); dialog.close(); window.DaynestUI?.notify('导航已整理，其他功能仍可通过展开或 Ctrl K 打开。'); }
    catch (_) { status('浏览器未能保存偏好；你的选择仍保留在此窗口，请检查本机存储后重试。'); }
  });
  $('navigation-close').addEventListener('click', close); dialog.addEventListener('cancel', event => { if (dirty() && !window.confirm('导航选择尚未保存，确定放弃修改吗？')) event.preventDefault(); else draft = null; });
  dialog.addEventListener('close', () => ($('app-sidebar').inert ? $('mobile-menu') : $('navigation-manage')).focus());
  document.addEventListener('daynest:account-ready', event => {
    reset(); const id = event.detail?.userID; if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(id)) return;
    owner = id; accountToken = localStorage.getItem('studyflow.token') || ''; load();
  });
  $('logout').addEventListener('click', reset);
  window.addEventListener('storage', event => {
    if (event.key === 'studyflow.token' || event.key === null) { reset(); return; }
    if (!active() || event.key !== key()) return;
    if (dialog.open && dirty()) { conflict = true; status('其他标签页更新了导航，当前选择已保留；保存时会再次请你确认。'); return; }
    load(); if (dialog.open) { draft = structuredClone(saved); editor(); }
  });
  new MutationObserver(() => { if ($('app-view').classList.contains('hidden')) reset(); }).observe($('app-view'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(renderNavigation).observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
  window.DaynestUI?.registerGuard?.('navigation', () => dialog.open && dirty());
  renderNavigation();
})();
