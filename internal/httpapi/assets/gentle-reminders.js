(() => {
  'use strict';
  const C = window.DaynestReminders, M = window.DaynestReminderMotion, $ = id => document.getElementById('gr-' + id);
  if (!C || !M || !$('dialog')) return;
  const app = document.getElementById('app-view'), locks = !!navigator.locks?.request;
  const icons = {
    water: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 5S11 20 11 29a13 13 0 0 0 26 0C37 20 24 5 24 5Z" fill="currentColor" opacity=".15"/><path d="M24 7S12 21 12 29a12 12 0 0 0 24 0C36 21 24 7 24 7Z" stroke="currentColor" stroke-width="2.2"/><path d="M18 29a6 6 0 0 0 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    move: '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="28" cy="10" r="4" fill="currentColor" opacity=".25" stroke="currentColor" stroke-width="2"/><path d="m14 21 9-4 8 6 7-2M23 17l-3 14-8 9m8-9 10 2 3 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 15h6M5 23h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".4"/></svg>'
  };
  const names = { water: '喝一点水', move: '起身活动' }, dones = { water: '喝过了', move: '活动过了' };
  let owner = '', epoch = 0, data = C.fresh(), dirty = false, editingRevision = 0, busy = false, working = false;
  let storageError = false, nudgeKey = '', historyKey = '', permissionBusy = false;
  let dialogOpener = null, restoreFocus = false;
  const notifications = new Map(), nudgeRows = new Map();
  function identity() {
    if (app.classList.contains('hidden')) return '';
    try {
      const part = (localStorage.getItem('studyflow.token') || '').split('.')[1] || '';
      const id = JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'='))).sub;
      return typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : '';
    } catch { return ''; }
  }
  const key = id => 'daynest.gentle-reminders.v1.' + id;
  function read(id) {
    const s = C.parse(localStorage.getItem(key(id))), stop = Number(localStorage.getItem(key(id) + '.stopped'));
    return stop > 0 && s.running ? C.change(s, {type:'pause'}, stop) : s;
  }
  function focus(now) {
    try { return C.focusBlocked(JSON.parse(localStorage.getItem('studyflow.focus') || 'null'), owner, now); }
    catch { return false; }
  }
  function systemAvailable() { return locks && window.isSecureContext && typeof Notification !== 'undefined'; }
  function closeNotifications() { for (const n of notifications.values()) n.close(); notifications.clear(); }
  function markStopped() {
    if (!owner) return;
    try {
      const old = Number(localStorage.getItem(key(owner)+'.stopped'));
      localStorage.setItem(key(owner)+'.stopped', String(old > 0 ? Math.min(old,Date.now()) : Date.now()));
    } catch { /* A storage failure prevents further reminder writes. */ }
  }
  function error(message = '') {
    $('error').textContent = message; $('error').hidden = !message;
  }
  function clean() {
    M.reset(); restoreFocus = false; dialogOpener = null; nudgeRows.clear();
    epoch++; closeNotifications(); $('dialog').close(); $('nudge').hidden = true;
    $('nudge-items').innerHTML = $('announcement').textContent = $('history-list').innerHTML = '';
    $('save-status').textContent = $('action-status').textContent = ''; owner = ''; dirty = false; working = false; busy = false;
    permissionBusy = false; storageError = false; nudgeKey = historyKey = ''; data = C.fresh(); error();
    $('snooze-minutes').value = '5'; $('settings').open = $('history').open = false;
    for (const id of ['settings','history']) $(id).querySelector('summary')?.setAttribute('aria-expanded','false');
    formFromData(); render();
  }
  function sync() {
    const next = identity();
    if (next !== owner) {
      markStopped();
      clean(); owner = next;
      if (owner) {
        try { data = read(owner); } catch { storageError = true; error('本机提醒数据无法读取，原数据未覆盖。请检查浏览器存储权限，或使用底部“清除”按钮重置。'); }
        formFromData(); render();
      }
    }
    return !!owner;
  }
  function signedOut() {
    // Synchronous logout marker also pauses background tabs. No late async write
    // is allowed to remove it; only an explicit, authenticated Start can.
    markStopped();
    clean();
  }
  async function transaction(operation, {quiet = false, start = false} = {}) {
    if (!sync() || storageError) return false;
    const id = owner, generation = epoch;
    const run = async () => {
      if (id !== identity() || generation !== epoch) return false;
      let previous;
      try { previous = read(id); } catch { storageError = true; closeNotifications(); render(); throw Error('本机提醒数据无法读取，已停止提醒；原数据未覆盖。可在底部清除此账号的本机提醒数据后重新开始。'); }
      const next = operation(previous, Date.now());
      if (id !== identity() || generation !== epoch) return false;
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        next.revision = previous.revision + 1;
        localStorage.setItem(key(id), JSON.stringify(next));
      }
      if (start) localStorage.removeItem(key(id) + '.stopped');
      data = next;
      if (!dirty && editingRevision !== data.configRevision) formFromData();
      if (!quiet) error();
      render(); return true;
    };
    try { return locks ? await navigator.locks.request(key(id), run) : await run(); }
    catch (e) {
      if (generation !== epoch || id !== owner) return false;
      error(e?.name === 'QuotaExceededError' || e?.name === 'SecurityError' ? '浏览器无法保存提醒。请允许本站使用本机存储；此次操作未生效。' : e.message || '无法更新提醒。');
      return false;
    }
  }
  function formFromData() {
    for (const kind of C.KINDS) { $(kind+'-enabled').checked = data.channels[kind].enabled; $(kind+'-minutes').value = String(data.channels[kind].minutes); }
    $('defer-focus').checked = data.deferFocus; $('window-enabled').checked = data.window.enabled;
    $('window-start').value = data.window.start; $('window-end').value = data.window.end;
    $('snooze-minutes').value = String(data.snoozeMinutes);
    M.reveal($('window-fields'),data.window.enabled,true); editingRevision = data.configRevision; dirty = false;
    draftControls();
  }
  function draftControls() {
    for (const kind of C.KINDS) $(kind+'-minutes').disabled = !$(kind+'-enabled').checked;
    $('window-start').disabled = $('window-end').disabled = !$('window-enabled').checked;
    for (const b of $('form').querySelectorAll('[data-gr-preset]')) {
      const [kind,value] = b.dataset.grPreset.split(':');
      b.setAttribute('aria-pressed',String(Number($(kind+'-minutes').value) === Number(value)));
      b.disabled = busy || !$(kind+'-enabled').checked;
    }
    for (const b of $('form').querySelectorAll('[data-gr-step]')) {
      const [kind,step] = b.dataset.grStep.split(':'), value = Number($(kind+'-minutes').value);
      b.disabled = busy || !$(kind+'-enabled').checked || (Number(step)<0 ? value<=5 : value>=180);
    }
  }
  function draftChanged() {
    dirty = true; $('save-status').textContent = '设置尚未保存。';
    const fields = $('window-fields'), show = $('window-enabled').checked;
    M.reveal(fields,show); draftControls();
  }
  function settings() {
    const channels = {};
    for (const kind of C.KINDS) {
      const enabled = $(kind+'-enabled').checked, minutes = Number($(kind+'-minutes').value);
      channels[kind] = {enabled,minutes:!enabled && (!Number.isInteger(minutes) || minutes<5 || minutes>180) ? data.channels[kind].minutes : minutes};
    }
    const windowEnabled = $('window-enabled').checked;
    return { channels, deferFocus: $('defer-focus').checked, notifications: data.notifications, snoozeMinutes:Number($('snooze-minutes').value),
      window: {enabled:windowEnabled,start:$('window-start').value || (!windowEnabled ? data.window.start : ''),end:$('window-end').value || (!windowEnabled ? data.window.end : '')} };
  }
  function notificationLabel() {
    const permission = typeof Notification === 'undefined' ? '' : Notification.permission;
    $('notifications').disabled = busy || permissionBusy || !owner || storageError || !systemAvailable() || (permission === 'denied' && !data.notifications);
    $('notifications').textContent = permissionBusy ? '等待授权…' : data.notifications ? '关闭系统通知' : '开启系统通知';
    $('notification-status').textContent = !systemAvailable() ? '系统通知需要支持 Web Locks 的浏览器与 HTTPS / localhost；网页内提醒仍可使用。' :
      permission === 'denied' ? '通知权限被浏览器关闭了。可在地址栏的网站权限中修改，网页内提醒不受影响。' :
      data.notifications && permission === 'granted' ? '已启用。网页在后台运行时可发出系统通知；系统勿扰模式仍可能拦截。' : '默认只在网页内提示，不请求系统权限。';
  }
  function render() {
    const now = Date.now(), block = C.blocked(data, now, focus(now)), enabled = C.KINDS.filter(k => data.channels[k].enabled);
    const pending = enabled.filter(k => data.channels[k].pendingAt), due = !storageError && data.running && !block ? pending : [];
    $('trigger').disabled = !owner;
    const stateLabel = !data.running ? (enabled.some(k => data.channels[k].dueAt || data.channels[k].remaining !== data.channels[k].minutes*C.MINUTE) ? '已暂停，随时继续' : '准备好，再开始') :
      block === 'quiet' ? '免打扰时段' : block === 'focus' ? '专注中，先不打扰' : due.length ? '该给自己一个小停顿了' : '按你的节奏，轻轻提醒';
    $('state').textContent = storageError ? '提醒已停止，需要检查本机存储' : stateLabel;
    $('state-help').textContent = storageError ? '本机存储不可用，提醒未运行。' : !data.running ? '暂停时保留剩余时间，继续后接着计时。' : block === 'quiet' ? `${data.window.start}–${data.window.end} 可提醒；到点的提醒会留到时段内。` :
      block === 'focus' ? '倒计时照常进行；到点后，等到专注暂停、休息或结束再提醒。' : '不抢焦点、不强制休息。完成后再开始下一轮。';
    $('state-dot').dataset.state = storageError || !data.running ? 'paused' : block ? 'quiet' : 'running';
    $('toggle').textContent = data.running ? '暂停全部' : '开始 / 继续';
    $('toggle').setAttribute('aria-pressed',String(data.running));
    $('toggle').dataset.playing = String(data.running);
    $('toggle').disabled = busy || storageError || !owner;
    $('trigger').dataset.state = storageError || !data.running ? 'paused' : due.length ? 'due' : 'running';
    const nearest = Math.min(...enabled.map(k => C.remaining(data,k,now)));
    $('caption').textContent = !owner ? '照顾一下自己' : storageError ? '需要检查设置' : !data.running ? '已暂停 · 点此开始' : block === 'quiet' ? '免打扰中' : pending.length && block === 'focus' ? '等专注告一段落' : due.length ? `${due.length} 项小提醒` : `${Math.max(1, Math.ceil(nearest/C.MINUTE))} 分钟后`;
    $('dot').hidden = !due.length; $('trigger').setAttribute('aria-label', '轻提醒：'+$('caption').textContent);
    for (const kind of C.KINDS) {
      const c = data.channels[kind], remain = C.remaining(data,kind,now), isDue = due.includes(kind);
      $(kind+'-card').dataset.state = storageError || !c.enabled ? 'off' : !data.running ? 'paused' : isDue ? 'due' : block ? 'quiet' : 'running';
      $(kind+'-interval').textContent = c.enabled ? `每 ${c.minutes} 分钟` : '已关闭这项提醒';
      $(kind+'-clock').textContent = storageError || !c.enabled ? '—' : C.duration(remain);
      $(kind+'-badge').textContent = storageError ? '已停止' : !c.enabled ? '已关闭' : !data.running ? '已暂停' : c.pendingAt ? (block ? '待提醒' : '到时间了') : block === 'quiet' ? '免打扰' : '计时中';
      $(kind+'-badge').dataset.due = String(isDue);
      $(kind+'-status').textContent = !c.enabled ? '可在下方设置中重新开启。' : c.pendingAt ? block === 'focus' ? '已到时间，等专注告一段落。' : block === 'quiet' ? '已到时间，等到可提醒时段。' : '现在、稍后，或跳过这一次，都可以。' :
        !data.running ? '已暂停，剩余时间会保留。' : kind === 'water' ? '按自己的需要，补充一点水。' : '离开椅子，换一个姿势。';
      $(kind+'-bar').style.transform = `scaleX(${c.enabled ? Math.min(1,Math.max(0,1-remain/(c.minutes*C.MINUTE))) : 0})`;
      const justDone = data.history.some(h=>h.kind===kind && now>=h.at && now-h.at<2000);
      $(kind+'-done').disabled = busy || storageError || !owner || !c.enabled || justDone;
      $(kind+'-done').textContent = justDone ? '✓ 已记录' : dones[kind];
      $(kind+'-snooze').hidden = $(kind+'-skip').hidden = !isDue;
      $(kind+'-snooze').disabled = $(kind+'-skip').disabled = busy;
      $(kind+'-snooze').textContent = `${$('snooze-minutes').value} 分钟后`;
    }
    const stats = C.today(data, now);
    $('water-count').textContent = stats.water; $('move-count').textContent = stats.move;
    $('history-count').textContent = `${stats.rows.length} 次`;
    const hk = C.today(data,now).rows.map(h => h.kind+':'+h.at).join('|');
    if (historyKey !== hk || !$('history-list').innerHTML) {
      historyKey = hk;
      const rows = stats.rows.slice(-30).reverse();
      $('history-list').innerHTML = rows.length ? rows.map(h => `<li><span class="gr-history-icon gr-${h.kind}">${icons[h.kind]}</span><span>${dones[h.kind]}</span><time>${new Date(h.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></li>`).join('') : '<li class="gr-empty">今天还没有记录。不用追求次数，照顾好自己就好。</li>';
    }
    $('save').disabled = busy || storageError || !owner;
    $('reload').disabled = busy || storageError || !owner;
    $('reset').disabled = busy || !owner;
    notificationLabel(); draftControls();
    const visible = !!owner && !storageError && !document.hidden && (locks || document.hasFocus()) && !$('dialog').open;
    renderNudge(due,visible);
    const nk = visible ? due.map(k => `${k}:${data.channels[k].cycle}`).join('|') : '';
    if (nk !== nudgeKey) {
      nudgeKey = nk;
      $('announcement').textContent = visible && due.length ? due.map(k=>names[k]).join('，')+'。可以完成、稍后提醒或跳过。' : '';
    }
    for (const [kind,n] of notifications) if (!due.includes(kind) || !data.notifications) { n.close(); notifications.delete(kind); }
  }
  function renderNudge(due, visible) {
    const clear = () => { for (const row of nudgeRows.values()) M.cancel(row.node); nudgeRows.clear(); $('nudge-items').innerHTML = ''; };
    // Account changes, hidden pages, errors and modal handoff are immediate.
    if (!visible) { M.reveal($('nudge'),false,true,clear); return; }
    if (!due.length) { M.reveal($('nudge'),false,false,clear); return; }
    M.reveal($('nudge'),true);
    const wanted = new Set(due.map(k=>`${k}:${data.channels[k].cycle}`));
    for (const [id,row] of nudgeRows) if (!wanted.has(id) && !row.leaving) {
      row.leaving = true; row.node.inert = true;
      M.remove(row.node,() => { row.node.remove(); nudgeRows.delete(id); });
      // Remaining rows retain their DOM identity and keyboard focus.
    }
    for (const kind of due) {
      const id = `${kind}:${data.channels[kind].cycle}`;
      let row = nudgeRows.get(id);
      if (!row) {
        const node = document.createElement('div'); node.className = `gr-nudge-item gr-${kind}`;
        node.innerHTML = `<span class="gr-art" aria-hidden="true">${icons[kind]}</span><div><strong>${names[kind]}</strong><p>${kind==='water'?'按需要补充一点水。':'起身走走，给身体一点空间。'}</p><div><button type="button" data-gr-action="done" data-kind="${kind}" data-cycle="${data.channels[kind].cycle}">${dones[kind]}</button><button type="button" data-gr-action="snooze" data-kind="${kind}" data-cycle="${data.channels[kind].cycle}"></button><button type="button" class="gr-link" data-gr-action="skip" data-kind="${kind}" data-cycle="${data.channels[kind].cycle}">跳过</button></div></div>`;
        row = {node,leaving:false}; nudgeRows.set(id,row); $('nudge-items').append(node);
      }
      if (row.leaving) { row.leaving = false; M.cancel(row.node); row.node.inert = false; M.pulse(row.node); }
      for (const b of row.node.querySelectorAll('button')) b.disabled = busy;
      row.node.querySelector('[data-gr-action="snooze"]').textContent = `${$('snooze-minutes').value} 分钟后`;
    }
  }
  async function tick() {
    if (!sync() || storageError || working || (!locks && (document.hidden || !document.hasFocus()))) return;
    working = true;
    const generation = epoch, deliver = [];
    try {
      const ok = await transaction((s, now) => {
        s = C.tick(s,now);
        if (!C.blocked(s,now,focus(now))) for (const k of C.KINDS) {
          const c = s.channels[k];
          if (!c.enabled || !c.pendingAt || c.notified) continue;
          const system = document.hidden && s.notifications && systemAvailable() && Notification.permission === 'granted';
          if (!document.hidden || system) { c.notified = true; if (system) deliver.push(k); }
        }
        return s;
      }, {quiet:true});
      if (ok && generation === epoch) for (const kind of deliver) {
        try {
          const n = new Notification(names[kind], {body:'给自己一个小停顿。返回日常，可确认、稍后提醒或跳过。', tag:`daynest-gr-${owner}-${kind}`, silent:true});
          notifications.set(kind,n);
          n.onclick = () => { if (sync() && generation === epoch) { window.focus(); open(); } n.close(); };
        } catch { error('系统未能显示通知。返回网页后仍可查看提醒，不会丢失待处理事项。'); }
      }
    } finally { if (generation === epoch) working = false; }
  }
  async function act(type,kind,cycle) {
    if (busy || !sync()) return;
    const generation = epoch, previous = document.activeElement, fromNudge = $('nudge').contains(previous);
    const fromCard = kind && $(kind+'-card').contains(previous);
    busy = true; render();
    let applied = false;
    const ok = await transaction((s, now) => {
      const next = C.change(s,{type,kind,cycle,minutes:Number($('snooze-minutes').value)},now);
      applied = JSON.stringify(next) !== JSON.stringify(s); return next;
    }, {start:type==='start'});
    if (generation === epoch) {
      busy = false; render();
      if (ok) {
        $('action-status').textContent = !applied ? '已载入最新提醒状态。' : type === 'done' ? `✓ ${dones[kind]}，下一轮已准备好。` : type === 'pause' ? 'Ⅱ 已暂停，剩余时间会为你保留。' : type === 'start' ? '▷ 提醒已开始，按自己的节奏就好。' : type === 'snooze' ? `◷ 好的，${$('snooze-minutes').value} 分钟后再提醒。` : '已跳过，下次再照顾自己。';
        M.pulse($('action-status'));
        if (applied && kind) {
          M.pulse($(kind+'-'+(type==='done'?'icon':'clock')),type==='done'?'confirm':'settle');
          if (type==='done') M.pulse($(kind+'-count'),'confirm');
        }
      }
      if (fromNudge && (!document.contains(previous) || $('nudge').inert || previous?.closest?.('.gr-nudge-item')?.inert)) ($('nudge').inert ? $('trigger') : $('nudge-open')).focus();
      else if (fromCard && (previous.hidden || previous.disabled)) $(kind+'-card').focus({preventScroll:true});
    }
  }
  function open(event) {
    if (!sync()) return;
    if ($('dialog').open && $('dialog').dataset.motion !== 'closing') return;
    if (!$('dialog').open) dialogOpener = event?.currentTarget || $('trigger');
    restoreFocus = true; M.dialog($('dialog'),true); render();
  }
  function close() { M.dialog($('dialog'),false); }
  $('trigger').addEventListener('click', open); $('nudge-open').addEventListener('click', open);
  $('close').addEventListener('click',close);
  $('dialog').addEventListener('cancel',event => { event.preventDefault(); close(); });
  $('dialog').addEventListener('close', () => {
    if ($('dialog').open) return;
    M.cancel($('dialog')); render();
    if (restoreFocus && owner && identity() === owner) {
      const target = dialogOpener && document.contains(dialogOpener) && !dialogOpener.disabled && !dialogOpener.hidden ? dialogOpener : $('trigger');
      target.focus({preventScroll:true});
    }
    restoreFocus = false;
  });
  $('toggle').addEventListener('click', () => { if (dirty && !data.running) { error('先保存或重新载入正在编辑的设置，再开始提醒。'); return; } act(data.running?'pause':'start'); });
  for (const kind of C.KINDS) {
    $(kind+'-card').tabIndex = -1;
    $(kind+'-icon').innerHTML = icons[kind];
    for (const type of ['done','snooze','skip']) $(kind+'-'+type).addEventListener('click', () => act(type,kind,data.channels[kind].cycle));
  }
  $('nudge-items').addEventListener('click', e => {
    const b = e.target.closest('[data-gr-action]');
    if (b) act(b.dataset.grAction,b.dataset.kind,Number(b.dataset.cycle));
  });
  $('form').addEventListener('input',draftChanged);
  $('form').addEventListener('click', e => {
    const b = e.target.closest('[data-gr-preset],[data-gr-step]'); if (!b || b.disabled) return;
    if (b.dataset.grPreset) {
      const [kind,minutes] = b.dataset.grPreset.split(':'); $(kind+'-minutes').value = minutes;
    } else {
      const [kind,step] = b.dataset.grStep.split(':'), field = $(kind+'-minutes');
      const value = field.value.trim() && Number.isFinite(Number(field.value)) ? Number(field.value) : data.channels[kind].minutes;
      field.value = String(Math.max(5,Math.min(180,Math.round(value)+Number(step))));
    }
    draftChanged();
    if (b.disabled && b.dataset.grStep) $(b.dataset.grStep.split(':')[0]+'-minutes').focus({preventScroll:true});
  });
  $('snooze-minutes').addEventListener('change', render);
  $('form').addEventListener('submit', async e => {
    e.preventDefault(); if (busy || !sync()) return;
    let value; try { value = settings(); C.validateSettings(value); } catch(e) { error(e.message); return; }
    const revision = editingRevision, generation = epoch; busy = true; render();
    const ok = await transaction((s,now)=>C.change(s,{type:'settings',settings:value,configRevision:revision},now));
    if (generation !== epoch) return;
    busy = false;
    if (ok) { formFromData(); $('save-status').textContent = '✓ 已保存在本机。'+(data.running?'提醒继续运行。':'点击“开始 / 继续”启用。'); M.pulse($('save-status')); }
    render();
  });
  $('reload').addEventListener('click', () => {
    if (!sync()) return;
    try { data = read(owner); formFromData(); error(); $('save-status').textContent = '已载入最新设置。'; render(); } catch(e) { error(e.message); }
  });
  $('notifications').addEventListener('click', async () => {
    if (!sync() || busy || permissionBusy || !systemAvailable()) return;
    if (dirty) { error('请先保存或重新载入正在编辑的设置。'); return; }
    const generation = epoch, want = !data.notifications; permissionBusy = true; render();
    try {
      const permission = !want || Notification.permission === 'granted' ? Notification.permission : await Notification.requestPermission();
      if (generation !== epoch || !sync()) return;
      if (want && permission !== 'granted') { error('未获得系统通知权限，仍会保留网页内提醒。'); return; }
      await transaction((s,now)=>C.change(s,{type:'settings',settings:{...s,notifications:want},configRevision:s.configRevision},now));
    } catch { if (generation === epoch) error('浏览器未能开启系统通知，网页内提醒仍可使用。'); }
    finally { if (generation === epoch) { permissionBusy = false; render(); } }
  });
  $('reset').addEventListener('click', async () => {
    if (!sync() || busy || !confirm('仅清除此账号在当前浏览器中的提醒设置和最近 7 天确认记录，并停止提醒。此操作无法撤销；不影响服务器其他数据。继续吗？')) return;
    const id = owner, generation = epoch;
    try {
      const run = () => { if (id !== identity() || generation !== epoch) return; localStorage.removeItem(key(id)); localStorage.removeItem(key(id)+'.stopped'); };
      if (locks) await navigator.locks.request(key(id),run); else run();
      if (generation !== epoch) return;
      storageError = false; data = C.fresh(); formFromData(); closeNotifications(); error(); render(); $('save-status').textContent = '本机提醒数据已清除，提醒已停止。';
    } catch { error('浏览器不允许清除本机存储，请检查网站权限。'); }
  });
  document.getElementById('logout').addEventListener('click',signedOut,true);
  document.addEventListener('daynest:account-ready', () => { sync(); tick(); });
  document.addEventListener('daynest:focus-changed', tick);
  document.addEventListener('visibilitychange', () => { render(); tick(); });
  window.addEventListener('focus', () => { render(); tick(); });
  window.addEventListener('storage', e => {
    if (e.key === 'studyflow.token') { sync(); tick(); return; }
    if (e.key === 'studyflow.focus') { tick(); return; }
    if (owner && (e.key === null || e.key === key(owner) || e.key === key(owner)+'.stopped')) {
      try { data = read(owner); if (storageError) error(); storageError = false; if (!dirty) formFromData(); closeNotifications(); render(); } catch { storageError = true; error('其他窗口中的提醒数据不可读取，提醒已停止。原数据未覆盖。'); render(); }
    }
  });
  new MutationObserver(() => { sync(); }).observe(app,{attributes:true,attributeFilter:['class']});
  $('capability').textContent = locks ? '支持多标签页串行更新：同一轮系统通知最多发出一次，重复确认不会重复计数。' : '此环境不支持跨标签页锁：仅前台窗口显示网页提醒，系统通知关闭。建议只打开一个日常页面。';
  M.disclosure($('settings')); M.disclosure($('history'));
  formFromData(); sync(); render(); tick(); window.setInterval(tick,1000);
})();
