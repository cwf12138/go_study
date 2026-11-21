const mobileTabs = [
  ['dashboard', '今天'], ['calendar', '日历'], ['todo', '待办'], ['moods', '心情'], ['all', '全部'],
];

const mobileGroups = [
  ['日常', [
    ['dashboard', '今天', '◫', '查看今天的安排'],
    ['calendar', '智能日历', '▦', '查看日程和今日签'],
    ['todo', '待办清单', '✓', '管理每天要做的事'],
    ['meals', '今天吃什么', '♨', '按口味和预算选一餐'],
    ['fitness', '运动日常', '↗', '训练计划与锻炼打卡'],
    ['care', '生活保养站', '✳', '定期保养与到期提醒'],
  ]],
  ['记录', [
    ['moods', '心情日历', '☺', '记心情日记和月度回顾'],
    ['memos', '备忘录', '▤', '记笔记和查草稿'],
    ['ledger', '生活账本', '¥', '查看收支和账单'],
    ['subscriptions', '订阅管家', '↻', '费用与续费日期'],
    ['inventory', '物品管家', '▣', '查物品、位置和保修'],
    ['timeline', '生活足迹', '↟', '按时间查看日常记录'],
    ['explore', '回忆收藏', '◇', '时光邮局、人生地图与私人博物馆'],
  ]],
  ['学习', [
    ['goals', '学习目标', '◎', '管理目标和截止日期'],
    ['tasks', '学习任务', '☷', '按关联目标推进任务'],
    ['planner', '智能学习规划', '▥', '排程和时间块'],
    ['vocabulary', '单词学习', 'Aa', '安装词书和背单词'],
    ['english', '英语精读', 'En', '读外刊和回看收藏'],
    ['literature', '阅读书房', '▰', '世界名著和古诗文'],
    ['insights', '学习洞察与复盘', '▧', '分析节奏并做每周复盘'],
  ]],
  ['工具', [
    ['toolkit', '随身工具', '⊞', '计算器、时钟和转换工具'],
    ['focus', '专注会话', '◷', '倒计时和背景声音'],
  ]],
];

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
      moods: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0M9 10h.01M15 10h.01M8.5 14a4 4 0 0 0 7 0',
      all: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
      settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
      search: 'M16 10a6 6 0 1 1-12 0 6 6 0 1 1 12 0m-1.5 4.5L21 21',
    };
    const icon = name => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg;
    };
    const routes = new Map();
    for (const node of document.querySelectorAll('.nav-link[data-view]')) {
      if (!routes.has(node.dataset.view)) routes.set(node.dataset.view, node);
    }
    const groups = mobileGroups.map(([title, entries]) => ({ title, pages: entries.flatMap(([view, label, glyph, description]) => {
      const node = routes.get(view);
      if (!node) return [];
      return [{ view, label, glyph, description, searchText: `${label} ${description} ${title} ${view}`.toLocaleLowerCase() }];
    }) }));
    document.body.classList.add('mobile-product');
    const narrow = window.matchMedia('(max-width:920px)');
    const byID = id => document.getElementById(id);
    const topbar = app.querySelector('.topbar');
    const pageAction = document.createElement('button');
    pageAction.id = 'mobile-page-action'; pageAction.type = 'button';
    topbar?.querySelector('.user-actions:not(.topbar-glance)')?.append(pageAction);
    const todoSheets = installTodoSheets(narrow);
    const mood = installMobileMood(narrow);
    installPlannerDayPicker(narrow);
    installMobileFilters(narrow, ['#panel-goals .goals-toolbar']);
    installMobileFilters(narrow, ['#panel-tasks .task-filter-grid', '#panel-tasks .task-filter-foot']);
    const englishLibrary = byID('english-library');
    const actions = {
      dashboard: ['随手记', '随手记'], calendar: ['新建日程', '+', 'calendar-create'], todo: ['添加待办', '+'],
      moods: ['记录今天的心情', '记今天'], memos: ['新建备忘录', '+', 'memo-new'], ledger: ['记一笔', '+', 'ledger-new'],
      subscriptions: ['添加订阅', '+', 'sub-new'], inventory: ['添加物品', '+', 'inventory-new'], care: ['添加保养事项', '+', 'care-new'],
      fitness: ['补记运动', '补记', 'fit-log-open'], meals: ['填写用餐需求', '选一餐', 'food-prompt', 'focus'],
      goals: ['填写学习目标', '新目标', 'goal-title', 'focus'], tasks: ['新建学习任务', '+', 'task-create-shortcut'],
      planner: ['添加时间块', '排时间', 'planner-block-form', 'focus'], vocabulary: ['选择或安装词书', '词书', 'vocab-open-catalog'],
      english: ['打开我的阅读', '我的阅读', 'english-library-toggle'], literature: ['搜索世界名著', '找书', 'ebook-search', 'books'],
      insights: ['填写本周复盘', '复盘', 'weekly-reflection-form', 'focus'], timeline: ['查看本月足迹', '本月', 'trail-today'],
      explore: ['查看收藏记录', '收藏', 'explore-list-title', 'focus'], focus: ['查看每日专注进度', '进度', 'focus-progress-caption', 'focus'],
      toolkit: ['查看工具栏', '工具', 'toolkit-tab-calc', 'tools'],
    };
    const dashboard = byID('panel-dashboard');
    const dashboardGrid = dashboard?.querySelector('.today-grid');
    const focusPanel = byID('panel-focus');
    const restoreLayout = new Map();
    function moveForPhone(node, parent, before = null) {
      if (!node || !parent) return;
      if (!restoreLayout.has(node)) {
        const marker = document.createComment('standard layout');
        node.before(marker); restoreLayout.set(node, marker);
      }
      parent.insertBefore(node, before);
    }
    function arrangePages() {
      if (narrow.matches) {
        for (const selector of ['.today-capture', '.today-todos', '.today-agenda']) {
          moveForPhone(dashboardGrid?.querySelector(selector), dashboardGrid, dashboardGrid?.firstElementChild);
        }
        moveForPhone(dashboard?.querySelector('.shopping-home'), dashboard, dashboardGrid?.nextElementSibling);
        moveForPhone(focusPanel?.querySelector('.workspace-extra'), focusPanel);
      } else {
        for (const [node, marker] of restoreLayout) marker.after(node);
      }
    }
    narrow.addEventListener('change', arrangePages);
    arrangePages();
    const capture = document.createElement('dialog');
    capture.id = 'mobile-capture'; capture.className = 'mobile-product-sheet'; capture.setAttribute('aria-labelledby', 'mobile-capture-title');
    capture.innerHTML = `<header><h2 id="mobile-capture-title">随手记</h2><button type="button" aria-label="关闭随手记">×</button></header>
      <div class="mobile-capture-options"><button type="button" data-capture="todo">添加待办 <span>›</span></button>
      <button type="button" data-capture="calendar">新建日程 <span>›</span></button><button type="button" data-capture="memos">新建备忘录 <span>›</span></button>
      <button type="button" data-capture="moods">记录心情 <span>›</span></button></div>`;
    capture.querySelector('header button').addEventListener('click', () => capture.close());
    document.body.append(capture);
    function launchAction(view) {
      if (view === 'dashboard') { if (!capture.open) capture.showModal(); return; }
      if (view === 'todo') { todoSheets?.open(); return; }
      if (view === 'moods') { mood?.today(); return; }
      if (view === 'english' && !englishLibrary?.classList.contains('hidden')) { byID('english-library-close')?.click(); return; }
      const action = actions[view], target = byID(action?.[2]);
      if (!target || target.disabled) return;
      if (!action[3]) { target.click(); return; }
      if (action[3] === 'books') document.querySelector('[data-literature-mode="books"]')?.click();
      const focusTarget = action[3] === 'tools' ? target.closest('.toolkit-tabs')?.querySelector('[aria-selected="true"]') || target : target;
      if (focusTarget.tabIndex < 0 && !focusTarget.hasAttribute('tabindex')) focusTarget.tabIndex = -1;
      focusTarget.scrollIntoView({ block: 'start', inline: 'nearest' });
      focusTarget.focus({ preventScroll: true });
    }
    pageAction.addEventListener('click', () => launchAction(document.body.dataset.mobileView));
    capture.addEventListener('click', event => {
      const view = event.target.closest('[data-capture]')?.dataset.capture;
      if (!view) return;
      capture.close();
      if (go(view)) requestAnimationFrame(() => launchAction(view));
    });
    // Home shortcuts open the same composers as the destination page actions.
    dashboard?.addEventListener('click', event => {
      const button = event.target.closest('.today-shortcuts [data-goto="todo"], .today-empty [data-goto="todo"], .today-shortcuts [data-goto="moods"]');
      if (!narrow.matches || !button) return;
      event.preventDefault(); event.stopPropagation();
      const view = button.dataset.goto;
      if (go(view)) requestAnimationFrame(() => launchAction(view));
    });
    const nav = document.createElement('nav'); nav.id = 'mobile-tabs'; nav.className = 'mobile-tabs'; nav.setAttribute('aria-label', '主要功能'); nav.hidden = true;
    for (const [view, title] of mobileTabs) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.mobileView = view;
      const label = document.createElement('span'); label.textContent = title; button.append(icon(view), label); nav.append(button);
      if (view === 'moods') button.setAttribute('aria-label', '心情日历');
    }
    const all = nav.querySelector('[data-mobile-view=all]');
    const dialog = document.createElement('dialog'); dialog.id = 'mobile-functions'; dialog.className = 'mobile-functions'; dialog.setAttribute('aria-labelledby','mobile-functions-title');
    dialog.innerHTML = `<div class="mobile-functions-toolbar"><header><h2 id="mobile-functions-title">全部功能</h2><div class="mobile-functions-actions"><button type="button" data-mobile-action="settings" aria-label="设置与数据"></button><button type="button" id="mobile-functions-close" aria-label="关闭全部功能">×</button></div></header>
      <label class="mobile-functions-search"><span class="product-sr-only">搜索功能</span><input id="mobile-functions-query" type="search" placeholder="搜索功能名称" autocomplete="off" enterkeyhint="search"></label>
      <div class="mobile-categories" role="group" aria-label="功能分类"></div></div>
      <p id="mobile-functions-count" role="status" aria-live="polite"></p><div id="mobile-functions-list"></div>
      <footer><button type="button" data-mobile-action="save">保存状态</button><button type="button" data-mobile-action="refresh">刷新数据</button><button type="button" data-mobile-action="connection">连接设置</button><button type="button" data-mobile-action="theme">切换主题</button><button type="button" data-mobile-action="logout">退出账号</button></footer>`;
    dialog.querySelector('[data-mobile-action="settings"]').append(icon('settings'));
    document.body.append(nav, dialog);
    all.setAttribute('aria-haspopup','dialog'); all.setAttribute('aria-controls',dialog.id); all.setAttribute('aria-expanded','false');
    const query = dialog.querySelector('input'), list = dialog.querySelector('#mobile-functions-list');
    const categories = dialog.querySelector('.mobile-categories');
    for (const title of ['全部', ...groups.map(group => group.title)]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.mobileCategory = title;
      button.textContent = title; categories.append(button);
    }
    let source = null, scheduled = false, category = '全部';
    const authenticated = () => !app.classList.contains('hidden');
    function renderFunctions() {
      const words = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      for (const button of categories.children) button.setAttribute('aria-pressed', String(button.dataset.mobileCategory === category));
      list.replaceChildren();
      let count = 0;
      for (const group of groups) {
        if (category !== '全部' && group.title !== category) continue;
        const matches = group.pages.filter(page => words.every(word => page.searchText.includes(word)));
        if (!matches.length) continue;
        const section = document.createElement('section'), heading = document.createElement('h3'), grid = document.createElement('div');
        heading.textContent = group.title; grid.className = 'mobile-functions-grid'; section.dataset.mobileGroup = group.title; section.append(heading,grid);
        for (const page of matches) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.mobileTarget = page.view;
          const mark = document.createElement('span'); mark.className = 'mobile-function-mark'; mark.textContent = page.glyph || '·'; mark.setAttribute('aria-hidden', 'true');
          const text = document.createElement('span'), label = document.createElement('strong'), description = document.createElement('small');
          label.textContent = page.label; description.textContent = page.description; text.append(label, description);
          button.append(mark, text);
          if (byID('panel-' + page.view)?.classList.contains('active')) button.setAttribute('aria-current','page');
          grid.append(button); count++;
        }
        list.append(section);
      }
      dialog.querySelector('#mobile-functions-count').textContent = words.length || !count ? (count ? `${count} 个匹配功能` : '没有匹配的功能。') : '';
      if (!count) {
        const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet mobile-functions-reset'; reset.textContent = '清除筛选';
        reset.addEventListener('click', () => { query.value = ''; category = '全部'; renderFunctions(); categories.firstElementChild.focus(); });
        list.append(reset);
      }
    }
    function closeFunctions(restoreFocus = true) {
      dialog.close(); all.setAttribute('aria-expanded','false');
      menu?.setAttribute('aria-expanded', 'false');
      if (restoreFocus && source?.isConnected) source.focus({preventScroll:true});
    }
    function openFunctions(button) {
      if (!authenticated()) return;
      source = button; query.value = ''; category = '全部'; renderFunctions(); window.DaynestUI?.setMenu?.(false,false);
      if (!dialog.open) dialog.showModal();
      all.setAttribute('aria-expanded','true'); dialog.scrollTop = 0;
      menu?.setAttribute('aria-expanded', 'true');
      // Focusing search on opening would summon the keyboard and hide the list.
      dialog.querySelector('#mobile-functions-close').focus({preventScroll:true});
    }
    function go(view) {
      const page = routes.get(view);
      if (!authenticated() || !page) return false;
      page.click();
      if (!byID('panel-' + view)?.classList.contains('active')) return false;
      if (dialog.open) { closeFunctions(false); byID('main-content')?.focus({ preventScroll: true }); }
      return true;
    }
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-mobile-view]'); if (!button) return;
      const view = button.dataset.mobileView;
      if (view === 'all') { openFunctions(button); return; }
      if (view === 'moods' && byID('panel-moods')?.classList.contains('active')) { mood?.calendar(); return; }
      if (byID('panel-' + view)?.classList.contains('active')) { window.scrollTo({ top: 0, behavior: 'instant' }); return; }
      go(view);
    });
    const menu = document.getElementById('mobile-menu');
    menu?.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); openFunctions(menu); },true);
    if (menu) { menu.setAttribute('aria-controls',dialog.id); menu.setAttribute('aria-haspopup','dialog'); menu.setAttribute('aria-label','打开全部功能'); }
    if (menu) menu.replaceChildren(icon('all'));
    topbar?.querySelector('#content-search-trigger > [aria-hidden]')?.replaceChildren(icon('search'));
    document.getElementById('diagnostics-open')?.replaceChildren(icon('settings'));
    dialog.querySelector('#mobile-functions-close').addEventListener('click',()=>closeFunctions());
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeFunctions();});
    dialog.addEventListener('close',()=>{all.setAttribute('aria-expanded','false');menu?.setAttribute('aria-expanded','false');});
    query.addEventListener('input', () => { dialog.scrollTop = 0; renderFunctions(); });
    query.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const matches = list.querySelectorAll('[data-mobile-target]');
      if (matches.length === 1) { event.preventDefault(); matches[0].click(); }
    });
    categories.addEventListener('click', event => {
      const button = event.target.closest('[data-mobile-category]');
      if (button) { category = button.dataset.mobileCategory; dialog.scrollTop = 0; renderFunctions(); }
    });
    dialog.addEventListener('click',event=>{
      const target = event.target.closest('[data-mobile-target]'); if (target) { go(target.dataset.mobileTarget); return; }
      const action = event.target.closest('[data-mobile-action]')?.dataset.mobileAction;
      const control = {settings:'diagnostics-open',save:'save-status-open',refresh:'app-sync-retry',connection:'mobile-server-bar',theme:'theme-toggle',logout:'logout'}[action];
      if (control) { closeFunctions(false); document.getElementById(control)?.click(); }
    });
    function sync() {
      scheduled = false;
      const visible = authenticated(), view = document.querySelector('.panel.active')?.id.replace(/^panel-/,'') || 'dashboard';
      nav.hidden = !visible; document.body.classList.toggle('mobile-has-tabs',visible); document.body.dataset.mobileView = visible ? view : '';
      if (view === 'moods') byID('page-title').textContent = '心情日历';
      const action = actions[view], target = byID(action?.[2]);
      pageAction.hidden = !visible || !action || !!(action[2] && !target);
      pageAction.disabled = !!target?.disabled;
      if (action) {
        const inLibrary = view === 'english' && englishLibrary && !englishLibrary.classList.contains('hidden');
        pageAction.setAttribute('aria-label', inLibrary ? '返回精读文章列表' : action[0]); pageAction.textContent = inLibrary ? '回文章' : action[1];
        pageAction.classList.toggle('mobile-action-label', action[1] !== '+');
      }
      if (!visible || view !== 'todo') todoSheets?.close();
      if (!visible && capture.open) capture.close();
      for (const button of nav.querySelectorAll('[data-mobile-view]')) {
        const selected = button.dataset.mobileView === view;
        const nested = button === all && !mobileTabs.some(([tab]) => tab === view);
        button.classList.toggle('active',selected || nested);
        if (selected) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
      }
      document.body.classList.toggle('mobile-memo-editor',visible && view === 'memos' && !!document.querySelector('.memo-workspace.show-editor'));
      if (view !== 'moods' || !visible) mood?.reset();
      for (const tabs of app.querySelectorAll('.workspace-tabs:not(.hidden)')) {
        const selected = tabs.querySelector('.nav-link.active');
        if (selected) tabs.scrollLeft += selected.getBoundingClientRect().left - tabs.getBoundingClientRect().left - (tabs.clientWidth - selected.offsetWidth) / 2;
      }
      if (!visible && dialog.open) closeFunctions(false);
      if (!visible) for (const id of ['mobile-memo-actions','mobile-share-connection']) { const overlay = document.getElementById(id); if (overlay?.open) overlay.close(); }
    }
    const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } };
    const observer = new MutationObserver(schedule);
    for (const node of [app,...document.querySelectorAll('.panel'),document.querySelector('.memo-workspace'),englishLibrary].filter(Boolean)) observer.observe(node,{attributes:true,attributeFilter:['class']});
    for (const [, , id] of Object.values(actions)) if (byID(id)) observer.observe(byID(id), { attributes: true, attributeFilter: ['disabled'] });
    document.addEventListener('daynest:account-ready',schedule); window.addEventListener('hashchange',schedule);
    document.addEventListener('daynest:account-leaving', () => { todoSheets?.close(); capture.close(); });

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
      if (!narrow.matches) return false;
      const view = document.body.dataset.mobileView;
      if (view === 'moods' && mood?.back()) return true;
      if (view === 'english' && englishLibrary && !englishLibrary.classList.contains('hidden')) {
        byID('english-library-close')?.click(); pageAction.focus({ preventScroll: true }); return true;
      }
      if (view === 'focus' && focusPanel?.classList.contains('is-quiet')) { byID('focus-quiet-toggle')?.click(); return true; }
      if (view !== 'memos' || !window.matchMedia('(max-width:700px)').matches) return false;
      const workspace = document.querySelector('.memo-workspace');
      if (workspace?.classList.contains('show-folders')) { workspace.classList.remove('show-folders'); return true; }
      if (workspace?.classList.contains('show-editor')) { document.activeElement?.blur(); document.getElementById('memo-mobile-list')?.click(); return true; }
      return false;
    }};
    sync(); viewport();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
}

function installMobileFilters(narrow, selectors) {
  const fields = selectors.map(selector => document.querySelector(selector)).filter(Boolean);
  if (!fields.length) return;
  const details = document.createElement('details'), summary = document.createElement('summary');
  details.className = 'mobile-inline-filters';
  summary.textContent = '筛选与排序'; details.append(summary);
  const anchors = fields.map(field => { const anchor = document.createComment('filter controls'); field.before(anchor); return anchor; });
  anchors[0].before(details);
  function updateLabel() {
    const changed = [...details.querySelectorAll('select')].filter(select => {
      const initial = [...select.options].find(option => option.defaultSelected) || select.options[0];
      return initial && select.value !== initial.value;
    }).length;
    summary.textContent = changed ? `筛选与排序 · ${changed} 项已调整` : '筛选与排序';
  }
  function layout() {
    details.hidden = !narrow.matches;
    if (narrow.matches) { details.append(...fields); updateLabel(); }
    else for (const [index, field] of fields.entries()) anchors[index].after(field);
  }
  narrow.addEventListener('change', layout); layout();
  details.addEventListener('change', updateLabel);
  details.addEventListener('click', event => { if (event.target.closest('#task-clear-filters')) requestAnimationFrame(updateLabel); });
  document.addEventListener('daynest:account-ready', updateLabel);
  document.addEventListener('daynest:account-leaving', () => { details.open = false; });
}

function installMobileMood(narrow) {
  const panel = document.getElementById('panel-moods');
  if (!panel) return null;
  const title = panel.querySelector('#mood-selected-date');
  const month = panel.querySelector('#mood-month-title'), today = panel.querySelector('#mood-today');
  const form = panel.querySelector('#mood-form');
  const panes = [
    ['calendar', '日历', month], ['entry', '写记录', title], ['review', '月度回顾', panel.querySelector('.mood-trend-card h3')],
  ];
  const tabs = document.createElement('div'); tabs.className = 'mobile-mood-tabs';
  tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '心情日历视图');
  for (const [name, label, heading] of panes) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.mobileMoodTab = name;
    button.textContent = label; tabs.append(button); heading.tabIndex = -1;
  }
  const optional = document.createElement('details'); optional.className = 'mobile-mood-optional';
  const summary = document.createElement('summary'); summary.textContent = '压力、精力与其他细节'; optional.append(summary);
  form.querySelector('.mood-writing-meta').before(optional);
  const fields = [form.querySelector('.mood-level-grid'), form.querySelector('#mood-activities').parentElement, form.querySelector('#mood-tags').closest('label')];
  const anchors = fields.map(field => { const anchor = document.createComment('mood field'); field.before(anchor); return anchor; });
  const todayAnchor = document.createComment('today button'); today.before(todayAnchor);
  panel.prepend(tabs);

  function setPane(pane, focus = false) {
    if (panel.dataset.mobileMoodPane !== pane && pane === 'entry') optional.open = false;
    panel.dataset.mobileMoodPane = pane;
    for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.dataset.mobileMoodTab === pane));
    if (!focus || !narrow.matches) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    const heading = panes.find(([name]) => name === pane)[2];
    heading.focus({ preventScroll: true });
  }
  function layout() {
    tabs.hidden = optional.hidden = !narrow.matches;
    if (narrow.matches) {
      panel.querySelector('.mood-month-actions').prepend(today);
      today.textContent = '今天';
      optional.append(...fields);
    } else {
      todayAnchor.after(today); today.textContent = '回到今天';
      for (const [index, field] of fields.entries()) anchors[index].after(field);
    }
    setPane('calendar');
  }
  tabs.addEventListener('click', event => {
    const pane = event.target.closest('[data-mobile-mood-tab]')?.dataset.mobileMoodTab;
    if (pane) setPane(pane);
  });
  document.addEventListener('daynest:mood-date-selected', () => {
    if (narrow.matches && panel.classList.contains('active')) setPane('entry', true);
  });
  narrow.addEventListener('change', layout); layout();
  return {
    reset() { if (panel.dataset.mobileMoodPane !== 'calendar') setPane('calendar'); },
    calendar() { if (narrow.matches) setPane('calendar', true); },
    today() {
      if (!narrow.matches) return;
      const selectedToday = '.mood-day.today[aria-pressed="true"]';
      if (!panel.querySelector(selectedToday)) today.click();
      if (panel.querySelector(selectedToday)) setPane('entry', true);
    },
    back() {
      if (!narrow.matches || panel.dataset.mobileMoodPane === 'calendar') return false;
      setPane('calendar', true); return true;
    },
  };
}

function installPlannerDayPicker(narrow) {
  const calendar = document.getElementById('planner-calendar');
  if (!calendar) return;
  const picker = document.createElement('div'); picker.className = 'mobile-planner-days';
  picker.setAttribute('role', 'group'); picker.setAttribute('aria-label', '查看本周某一天'); picker.hidden = true;
  const status = document.createElement('p'); status.className = 'mobile-planner-day-status'; status.hidden = true;
  status.setAttribute('role', 'status');
  const viewport = calendar.closest('.action-calendar-viewport') || calendar;
  viewport.before(picker, status);
  let selected = '';

  function select(date) {
    selected = date;
    document.dispatchEvent(new CustomEvent('daynest:planner-day', { detail: { date } }));
    for (const button of picker.children) button.setAttribute('aria-pressed', String(button.dataset.mobilePlannerDay === date));
    for (const column of calendar.querySelectorAll('[data-planner-date]')) {
      const active = column.dataset.plannerDate === date;
      column.toggleAttribute('data-mobile-day-active', active);
      if (active) status.textContent = column.querySelector('[data-planner-block]') ? '' : '这一天还没有时间块。';
    }
  }
  function renderDays() {
    const columns = [...calendar.querySelectorAll('[data-planner-date]')];
    const dates = columns.map(column => column.dataset.plannerDate);
    picker.hidden = status.hidden = !narrow.matches || !dates.length;
    if (picker.hidden) return;
    if (dates.join() !== [...picker.children].map(button => button.dataset.mobilePlannerDay).join()) {
      const labels = [...calendar.querySelectorAll('.planner-day-header span')];
      const buttons = columns.map((column, index) => {
        const date = dates[index], button = document.createElement('button'), day = document.createElement('strong');
        button.type = 'button'; button.dataset.mobilePlannerDay = date;
        button.setAttribute('aria-label', date + ' ' + labels[index].textContent);
        if (column.classList.contains('today')) button.setAttribute('aria-current', 'date');
        day.textContent = Number(date.slice(-2)); button.append(labels[index].textContent, day);
        return button;
      });
      picker.replaceChildren(...buttons);
    }
    select(dates.includes(selected) ? selected : (calendar.querySelector('.planner-day-column.today')?.dataset.plannerDate || dates[0]));
  }
  picker.addEventListener('click', event => {
    const day = event.target.closest('[data-mobile-planner-day]');
    if (!day) return;
    select(day.dataset.mobilePlannerDay);
    const scroll = calendar.querySelector('.planner-calendar-scroll');
    const first = calendar.querySelector('[data-mobile-day-active] [data-planner-block]');
    if (scroll) scroll.scrollTop = first ? Math.max(0, first.offsetTop - 36) : 0;
  });
  calendar.addEventListener('click', event => {
    if (!narrow.matches || !event.target.closest('[data-planner-block]')) return;
    const detail = document.getElementById('planner-block-detail');
    requestAnimationFrame(() => detail?.closest('article')?.scrollIntoView({ block: 'start' }));
  });
  new MutationObserver(renderDays).observe(calendar, { childList: true });
  narrow.addEventListener('change', () => {
    renderDays();
    if (!narrow.matches) {
      const weekStart = calendar.querySelector('[data-planner-date]')?.dataset.plannerDate;
      if (weekStart) document.dispatchEvent(new CustomEvent('daynest:planner-day', { detail: { date: weekStart } }));
    }
  });
  document.addEventListener('daynest:account-leaving', () => { selected = ''; });
  renderDays();
}

function installTodoSheets(narrow) {
  const createCard = document.querySelector('#panel-todo .todo-create-card');
  const navCard = document.querySelector('#panel-todo .todo-nav-card');
  const mainCard = document.querySelector('#panel-todo .todo-main-card');
  const viewList = navCard?.querySelector('.todo-view-list');
  if (!createCard || !navCard || !mainCard || !viewList) return null;

  function sheet(id, title) {
    const dialog = document.createElement('dialog');
    dialog.id = id; dialog.className = 'mobile-product-sheet'; dialog.setAttribute('aria-labelledby', id + '-title');
    const header = document.createElement('header'), heading = document.createElement('h2'), close = document.createElement('button');
    heading.id = id + '-title'; heading.textContent = title;
    close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭' + title);
    close.addEventListener('click', () => dialog.close());
    header.append(heading, close); dialog.append(header); document.body.append(dialog);
    return dialog;
  }
  const create = sheet('mobile-todo-create', '添加待办'), options = sheet('mobile-todo-options', '清单与筛选');
  const filter = document.createElement('button');
  filter.id = 'mobile-todo-filter'; filter.type = 'button'; filter.className = 'quiet'; filter.textContent = '筛选与分类';
  filter.setAttribute('aria-haspopup', 'dialog'); filter.addEventListener('click', () => options.showModal());
  const optionsBody = document.createElement('div'); optionsBody.className = 'mobile-todo-options-body'; options.append(optionsBody);
  const filterFields = document.createElement('div'); filterFields.className = 'mobile-todo-filter-fields';
  optionsBody.append(filterFields);
  const tools = document.createElement('div'); tools.className = 'mobile-todo-tools'; optionsBody.append(tools);
  const search = mainCard.querySelector('.todo-search');
  search?.after(filter);
  // Placeholders let a tablet or a rotated device return to the standard layout.
  const positions = new Map();
  const move = (node, parent, before = null) => {
    if (!node) return;
    if (!positions.has(node)) {
      const mark = document.createComment('mobile layout'); node.before(mark); positions.set(node, mark);
    }
    parent.insertBefore(node, before);
  };
  function layout() {
    if (narrow.matches) {
      move(createCard, create);
      move(viewList, mainCard, mainCard.firstElementChild);
      move(navCard, optionsBody);
      for (const id of ['todo-priority-filter', 'todo-tag-filter']) move(document.getElementById(id), filterFields);
      for (const id of ['todo-drafts-open', 'todo-local-open', 'todo-offline-open']) move(document.getElementById(id), tools);
    } else {
      create.close(); options.close();
      for (const [node, mark] of positions) if (mark.parentNode) mark.after(node);
    }
    filter.hidden = !narrow.matches;
  }
  // Draft controls are inserted by another module after the account is ready.
  document.addEventListener('daynest:account-ready', layout);
  narrow.addEventListener('change', layout); layout();
  options.addEventListener('click', event => {
    if (event.target.closest('.mobile-todo-tools button, [data-todo-list-view]')) options.close();
  }, true);
  createCard.querySelector('form')?.addEventListener('reset', () => { if (create.open) create.close(); });
  return {
    open() { if (narrow.matches && !create.open) create.showModal(); },
    close() { if (create.open) create.close(); if (options.open) options.close(); },
  };
}
