// Native-only navigation and viewport behavior. Business actions keep using the
// existing page controls, including their draft and account protections.
export function installMobileUX() {
  const mount = () => {
    if (document.getElementById('mobile-tabs')) return;
    const app = document.getElementById('app-view');
    if (!app) return;
    const paths = {
      dashboard: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
      calendar: 'M5 5h14v16H5zM8 3v4m8-4v4M5 10h14',
      todo: 'm3 7 2 2 4-4m3 2h9M3 15l2 2 4-4m3 2h9',
      memos: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',
      all: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
      settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
    };
    const icon = name => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg;
    };
    const pages = [...document.querySelectorAll('.daynest-nav .nav-link[data-view]')].map(node => ({
      node, view: node.dataset.view,
      title: [...node.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent).join('').trim() || node.textContent.trim(),
      group: node.closest('.nav-group')?.querySelector('.nav-group-label')?.textContent.trim() || '其他',
      keywords: node.dataset.searchKeywords || '',
    }));
    const nav = document.createElement('nav'); nav.id = 'mobile-tabs'; nav.className = 'mobile-tabs'; nav.setAttribute('aria-label', '主要功能'); nav.hidden = true;
    for (const [view, title] of [['dashboard','今天'],['calendar','日历'],['todo','待办'],['memos','记录'],['all','全部']]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.mobileView = view;
      const label = document.createElement('span'); label.textContent = title; button.append(icon(view), label); nav.append(button);
    }
    const all = nav.querySelector('[data-mobile-view=all]');
    const dialog = document.createElement('dialog'); dialog.id = 'mobile-functions'; dialog.className = 'mobile-functions'; dialog.setAttribute('aria-labelledby','mobile-functions-title');
    dialog.innerHTML = '<header><h2 id="mobile-functions-title">全部功能</h2><button type="button" id="mobile-functions-close" aria-label="关闭全部功能">×</button></header><label class="mobile-functions-search">搜索功能<input id="mobile-functions-query" type="search" placeholder="例如：运动、账本、阅读" autocomplete="off"></label><p id="mobile-functions-count" role="status" aria-live="polite"></p><div id="mobile-functions-list"></div><footer><button type="button" data-mobile-action="settings">设置与数据</button><button type="button" data-mobile-action="connection">连接设置</button><button type="button" data-mobile-action="theme">切换主题</button><button type="button" data-mobile-action="logout">退出账号</button></footer>';
    document.body.append(nav, dialog);
    all.setAttribute('aria-haspopup','dialog'); all.setAttribute('aria-controls',dialog.id); all.setAttribute('aria-expanded','false');
    const query = dialog.querySelector('input'), list = dialog.querySelector('#mobile-functions-list');
    let source = null, scheduled = false;
    const authenticated = () => !app.classList.contains('hidden');
    function renderFunctions() {
      const filter = query.value.trim().toLocaleLowerCase(); list.replaceChildren();
      let count = 0;
      for (const group of new Set(pages.map(page => page.group))) {
        const matches = pages.filter(page => page.group === group && (page.title+' '+page.group+' '+page.keywords).toLocaleLowerCase().includes(filter));
        if (!matches.length) continue;
        const section = document.createElement('section'), heading = document.createElement('h3'), grid = document.createElement('div');
        heading.textContent = group; grid.className = 'mobile-functions-grid'; section.append(heading,grid);
        for (const page of matches) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.mobileTarget = page.view; button.textContent = page.title;
          if (page.node.classList.contains('active')) button.setAttribute('aria-current','page');
          grid.append(button); count++;
        }
        list.append(section);
      }
      dialog.querySelector('#mobile-functions-count').textContent = count ? `${count} 个功能` : '没有匹配的功能，试试其他名称。';
    }
    function closeFunctions(restoreFocus = true) {
      dialog.close(); all.setAttribute('aria-expanded','false');
      if (restoreFocus && source?.isConnected) source.focus({preventScroll:true});
    }
    function openFunctions(button) {
      if (!authenticated()) return;
      source = button; query.value = ''; renderFunctions(); window.DaynestUI?.setMenu?.(false,false);
      if (!dialog.open) dialog.showModal();
      all.setAttribute('aria-expanded','true'); dialog.scrollTop = 0;
      // Focusing search on opening would summon the keyboard and hide the list.
      dialog.querySelector('#mobile-functions-close').focus({preventScroll:true});
    }
    function go(view) {
      if (!authenticated()) return;
      const page = pages.find(page => page.view === view);
      if (!page) return;
      if (dialog.open) closeFunctions(false);
      page.node.click();
    }
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-mobile-view]'); if (!button) return;
      if (button.dataset.mobileView === 'all') openFunctions(button); else go(button.dataset.mobileView);
    });
    const menu = document.getElementById('mobile-menu');
    menu?.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); openFunctions(menu); },true);
    if (menu) { menu.setAttribute('aria-controls',dialog.id); menu.setAttribute('aria-haspopup','dialog'); menu.setAttribute('aria-label','打开全部功能'); }
    document.getElementById('diagnostics-open')?.replaceChildren(icon('settings'));
    dialog.querySelector('#mobile-functions-close').addEventListener('click',()=>closeFunctions());
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeFunctions();});
    dialog.addEventListener('close',()=>{all.setAttribute('aria-expanded','false');});
    query.addEventListener('input',renderFunctions);
    dialog.addEventListener('click',event=>{
      const target = event.target.closest('[data-mobile-target]'); if (target) { go(target.dataset.mobileTarget); return; }
      const action = event.target.closest('[data-mobile-action]')?.dataset.mobileAction;
      const control = {settings:'diagnostics-open',connection:'mobile-server-bar',theme:'theme-toggle',logout:'logout'}[action];
      if (control) { closeFunctions(false); document.getElementById(control)?.click(); }
    });
    function sync() {
      scheduled = false;
      const visible = authenticated(), view = document.querySelector('.panel.active')?.id.replace(/^panel-/,'') || 'dashboard';
      nav.hidden = !visible; document.body.classList.toggle('mobile-has-tabs',visible); document.body.dataset.mobileView = visible ? view : '';
      for (const button of nav.querySelectorAll('[data-mobile-view]')) {
        const selected = button.dataset.mobileView === view;
        button.classList.toggle('active',selected || (button === all && !['dashboard','calendar','todo','memos'].includes(view)));
        if (selected) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
      }
      document.body.classList.toggle('mobile-memo-editor',visible && view === 'memos' && !!document.querySelector('.memo-workspace.show-editor'));
      if (!visible && dialog.open) closeFunctions(false);
      if (!visible) for (const id of ['mobile-memo-actions','mobile-share-connection']) { const overlay = document.getElementById(id); if (overlay?.open) overlay.close(); }
    }
    const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } };
    const observer = new MutationObserver(schedule);
    for (const node of [app,...document.querySelectorAll('.panel'),document.querySelector('.memo-workspace')].filter(Boolean)) observer.observe(node,{attributes:true,attributeFilter:['class']});
    document.addEventListener('daynest:account-ready',schedule); window.addEventListener('hashchange',schedule);

    const textField = node => node?.matches?.('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=color]):not([type=file])');
    let baseline = window.innerHeight, viewportWidth = window.innerWidth;
    function viewport() {
      const height = window.visualViewport?.height || window.innerHeight;
      if (Math.abs(window.innerWidth - viewportWidth) > 80) { baseline = height; viewportWidth = window.innerWidth; }
      if (!textField(document.activeElement)) baseline = Math.max(baseline,height);
      const keyboard = !!textField(document.activeElement) && baseline-height > 120;
      document.documentElement.style.setProperty('--mobile-viewport-height',height+'px');
      document.body.classList.toggle('mobile-keyboard-open',keyboard);
    }
    window.visualViewport?.addEventListener('resize',viewport); window.addEventListener('resize',viewport);
    document.addEventListener('focusin',event=>{viewport();if(textField(event.target))setTimeout(()=>{if(document.activeElement===event.target)event.target.scrollIntoView({block:'nearest',behavior:'instant'});},250);});
    document.addEventListener('focusout',()=>setTimeout(viewport,100));

    const memoHead = document.querySelector('.memo-editor-head'), memoSave = document.getElementById('memo-save');
    if (memoHead && memoSave) {
      const tools = document.createElement('button'); tools.type = 'button'; tools.id = 'mobile-memo-tools'; tools.textContent = '更多'; tools.setAttribute('aria-haspopup','dialog');
      const actions = document.createElement('dialog'); actions.id = 'mobile-memo-actions'; actions.className = 'mobile-functions'; actions.setAttribute('aria-labelledby','mobile-memo-actions-title');
      actions.innerHTML = '<header><h2 id="mobile-memo-actions-title">记录操作</h2><button type="button" aria-label="关闭记录操作">×</button></header><div class="mobile-functions-grid"></div>';
      actions.querySelector('header>button').addEventListener('click',()=>actions.close());
      const originals = [['memo-preview-toggle','切换阅读预览'],['memo-pin','切换置顶'],['memo-to-action','关联待办'],['memo-download','导出 Markdown'],['memo-duplicate','复制一份'],['memo-archive','切换归档'],['memo-trash','移到回收站'],['memo-restore','恢复记录'],['memo-delete-permanent','永久删除']];
      tools.addEventListener('click',()=>{
        const grid = actions.querySelector('.mobile-functions-grid'); grid.replaceChildren();
        for (const [id,label] of originals) {
          const original = document.getElementById(id);
          if (!original || original.disabled || original.closest('[hidden],.hidden')) continue;
          const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
          if (id === 'memo-pin') button.textContent = original.classList.contains('active') ? '取消置顶' : '置顶记录';
          if (id === 'memo-archive') button.textContent = original.classList.contains('active') ? '取消归档' : '归档记录';
          if (id === 'memo-preview-toggle') button.textContent = original.classList.contains('active') ? '返回编辑' : '阅读预览';
          button.addEventListener('click',()=>{actions.close();original.click();}); grid.append(button);
        }
        actions.showModal();
      });
      memoSave.classList.add('mobile-memo-save'); memoHead.append(tools,memoSave); document.body.append(actions);
    }

    window.DaynestMobileUX = {back() {
      if (!window.matchMedia('(max-width:700px)').matches || document.body.dataset.mobileView !== 'memos') return false;
      const workspace = document.querySelector('.memo-workspace');
      if (workspace?.classList.contains('show-folders')) { workspace.classList.remove('show-folders'); return true; }
      if (workspace?.classList.contains('show-editor')) { document.activeElement?.blur(); document.getElementById('memo-mobile-list')?.click(); return true; }
      return false;
    }};
    sync(); viewport();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
}
