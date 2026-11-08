(() => {
  'use strict';
  const H = window.DaynestHTTP, C = window.DaynestCalendarEditorCore, $ = id => document.getElementById(id);
  const dialog = $('calendar-event-dialog'), form = $('calendar-event-form');
  // Keep the modal usable from quick entries even when the calendar panel is hidden.
  document.body.append(dialog);
  let owner = null, editor = null, generation = 0, busy = false, controller = null, returnFocus = null;
  const current = () => !!owner && H.current(owner), store = context => C.commands(localStorage, context);
  const notify = (text, error = false) => window.DaynestUI?.notify(text, error ? 'error' : 'success');
  function status(text) { $('calendar-editor-status').textContent = text; }
  function changed(signal = true) {
    const context = H.capture();
    document.dispatchEvent(new CustomEvent('daynest:calendar-events-changed', { detail: { server: context.server, userID: context.userID } }));
    if (signal) try { localStorage.setItem(C.PREFIX + 'changed', JSON.stringify({ server: context.server, userID: context.userID, nonce: Date.now() + ':' + Math.random() })); } catch (_) {}
  }
  function refreshBadge() {
    const context = H.capture(), button = $('calendar-recovery-open');
    if (!context.userID) { button.hidden = true; return; }
    try { const rows = store(context).read(); const pending=rows.filter(row=>!row.confirmed||row.missing).length; button.hidden = !rows.length; button.textContent = pending?`待核对日程 · ${pending}`:`新建记录 · ${rows.length}`; }
    catch (_) { button.hidden = false; button.textContent = '本机日程记录需要检查'; }
  }
  function contract(event, context, id, uncertain = false) {
    if (!C.valid(event, context.userID) || id && event.id !== id) { const error = Error('日程响应与原记录不一致，请先核对结果。'); error.uncertain = uncertain; throw error; }
    return event;
  }
  async function read(id, context = H.capture(), signal) {
    const response = await H.json('/api/v1/calendar/events/' + encodeURIComponent(id), { context, signal, envelope: true });
    if (response.meta?.write_contract !== 'calendar-if-match-v1') throw Error('当前服务不支持日程版本校验，请重启新版 Go 服务。');
    return contract(response.data, context, id);
  }
  function value() {
    return { title: $('calendar-event-title').value, description: $('calendar-event-description').value, location: $('calendar-event-location').value,
      category: $('calendar-event-category').value, color: $('calendar-event-color').value, start: $('calendar-event-start').value, end: $('calendar-event-end').value,
      all_day: $('calendar-event-all-day').checked, repeat_rule: $('calendar-event-repeat').value, repeat_until: $('calendar-event-repeat-until').value,
      reminder_minutes: Number($('calendar-event-reminder').value) };
  }
  function captureDraft() {
    if (editor?.base && editor.dirty && !editor.command && current()) {
      window.DaynestCalendarDrafts?.capture(editor.base, { ...value(), timed: editor.timed ? { ...editor.timed } : null });
    }
  }
  function render() {
    captureDraft();
    let proof = $("calendar-save-proof"); if (!proof) { proof = document.createElement("span"); proof.id = "calendar-save-proof"; $("calendar-editor-status").after(proof); }
    window.DaynestSaveStatus?.bind(proof, "calendar/events", editor?.base?.id);
    $('calendar-dialog-close').disabled = busy;
    $('calendar-event-cancel').disabled = busy;
    if (!editor) return;
    $('calendar-event-fields').disabled = editor.loading || editor.deleted || !!editor.command;
    $('calendar-event-save').disabled = busy || editor.loading || editor.review || editor.deleted || !!editor.command || H.authExpired();
    $('calendar-event-save').textContent = busy ? '正在核对与保存…' : editor.base ? '保存修改' : '创建日程';
    $('calendar-event-delete').classList.toggle('hidden', !editor.base);
    $('calendar-event-delete').disabled = busy || editor.loading || editor.review || editor.deleted || H.authExpired();
    $('calendar-editor-review').hidden = !editor.review;
    $('calendar-event-check').disabled = busy || H.authExpired();
    $('calendar-event-use-server').hidden = !!editor.command;
    $('calendar-event-keep-local').hidden = !!editor.command;
    $('calendar-event-use-server').disabled = busy || !editor.remote;
    $('calendar-event-keep-local').disabled = busy || !editor.remote || editor.pendingDelete;
    $('calendar-command-retry').hidden = !editor.command;
    $('calendar-command-retry').disabled = busy || !editor.missing || editor.deleted || editor.command?.known_deleted || H.authExpired();
    $('calendar-command-clear').hidden = !editor.command;
    $('calendar-command-clear').disabled = busy;
    $('calendar-event-repeat-until').disabled = $('calendar-event-repeat').value === 'none';
    const all = $('calendar-event-all-day').checked, repeated = $('calendar-event-repeat').value !== 'none';
    $('calendar-start-label').textContent = all ? '开始日期' : '开始 · 北京时间';
    $('calendar-end-label').textContent = all ? '结束日期 · 含当天' : '结束 · 北京时间';
    $('calendar-editor-scope').textContent = (repeated ? '重复日程：编辑和删除作用于整组；开始与结束是首次安排。' : '个人日程 · 按北京时间（UTC+08:00）安排。') + (all ? ' 全天日期包含结束当天。' : '') + (editor.command ? ' 原提交内容已固定，核对前不会再次创建。' : '');
  }
  function option(id, value, label) {
    const node = $(id); if (![...node.options].some(o => o.value === String(value))) { const o = document.createElement('option'); o.value = value; o.textContent = label || value; o.dataset.calendarCustom='true'; node.append(o); }
    node.value = value;
  }
  function fill(event) {
    applyFields(C.editable(event));
  }
  function applyFields(v) {
    editor.mode = v.all_day;
    $('calendar-event-all-day').checked = v.all_day;
    $('calendar-event-start').type = $('calendar-event-end').type = v.all_day ? 'date' : 'datetime-local';
    for (const field of ['title', 'description', 'location', 'color', 'start', 'end']) $('calendar-event-' + field).value = v[field];
    option('calendar-event-category', v.category); option('calendar-event-reminder', v.reminder_minutes, v.reminder_minutes ? `提前 ${v.reminder_minutes} 分钟` : '不提醒');
    $('calendar-event-repeat').value = v.repeat_rule; $('calendar-event-repeat-until').value = v.repeat_until;
    $('calendar-event-id').value = editor.base?.id || '';
    editor.timed = v.all_day ? v.timed || null : { start: v.start, end: v.end }; editor.dirty = false; editor.sequence++; render();
  }
  function clear() {
    generation++; controller?.abort(); controller = null; owner = null; editor = null; busy = false;
    form.reset(); form.querySelectorAll('option[data-calendar-custom]').forEach(option=>option.remove()); $('calendar-event-id').value = ''; $('calendar-event-fields').disabled = false; $('calendar-dialog-close').disabled = false; $('calendar-event-cancel').disabled = false;
    $('calendar-command-list').replaceChildren(); $('calendar-command-list').hidden = true;
    $('calendar-event-remote').textContent = ''; $('calendar-editor-status').textContent = ''; $('calendar-draft-status').textContent = ''; $('calendar-editor-scope').textContent = '';
    if (dialog.open) dialog.close();
  }
  function close() {
    if (busy) return;
    if (editor?.dirty && !confirm('当前日程修改尚未提交。请确认本机草稿已保留或已导出，确定关闭？')) return;
    const focus = returnFocus; clear(); refreshBadge(); (focus?.isConnected?focus:$('calendar-create'))?.focus?.();
  }
  function begin(title) {
    if (busy || editor?.dirty && !confirm('切换将放弃当前未保存的修改，确定继续？')) return null;
    clear(); owner = H.capture(); if (!owner.userID) { notify('请先在线核验账号。', true); return null; }
    returnFocus = document.activeElement; $('calendar-dialog-title').textContent = title; form.hidden = true; $('calendar-editor-review').hidden = true; dialog.showModal(); return generation;
  }
  function recover(row) {
    if (!current() || busy) return;
    editor = { base: null, command: row, remote: null, review: true, missing: !!row.missing, deleted: !!row.known_deleted, loading: false, dirty: false, sequence: 0 };
    $('calendar-command-list').hidden = true; form.hidden = false; fill(row.body);
    $('calendar-event-remote').textContent = '原提交标识：' + row.request_id;
    status(row.known_deleted ? '原日程曾确认已删除。只允许核对或导出，不恢复这次创建。' : row.missing?'此提交曾确认，当前回执待核对；原内容与标识仍在本机。':row.confirmed?'此提交曾确认成功，原内容仍在本机。可核对服务状态或明确清理记录。':'本机保留了原始新建提交。请先核对回执；不会自动发送。'); render();
  }
  function recovery() {
    const turn = begin('本机日程提交记录'); if (turn === null) return;
    try {
      const rows = store(owner).read(), list = $('calendar-command-list'); list.hidden = false;
      status(rows.length ? '原内容保留在本机。选择记录核对服务状态，或明确清理已确认的记录。' : '没有本机日程提交记录。');
      for (const row of rows) { const button = document.createElement('button'); button.type = 'button'; button.className = 'calendar-command-item'; button.textContent = (row.confirmed&&!row.missing?'已确认 · ':'待核对 · ') + row.body.title + ' · ' + new Date(row.created_at).toLocaleString('zh-CN'); button.addEventListener('click', () => recover(row)); list.append(button); }
      if(rows.some(row=>row.confirmed&&!row.missing)){
        const clean=document.createElement('button');clean.type='button';clean.className='calendar-command-item';clean.textContent='清理已确认的本机记录';
        clean.addEventListener('click',()=>{if(!current()||busy||!confirm('清理已确认且无回执疑问的本机记录？不会删除服务端日程；尚待核对的记录继续保留。'))return;try{for(const row of store(owner).read())if(row.confirmed&&!row.missing)store(owner).remove(row);refreshBadge();recovery();}catch(error){status(error.message);}});
        list.append(clean);
      }
    } catch (error) { status(error.message); }
  }
  async function open(id = '', selected = C.day(new Date().toISOString())) {
    if (!id) { try { if (store(H.capture()).read().some(row=>!row.confirmed||row.missing)) { recovery(); return; } } catch (error) { notify(error.message, true); return; } }
    const turn = begin(id ? '编辑日程' : '留一段时间给它'); if (turn === null) return;
    window.DaynestCalendarDrafts?.begin();
    const context = owner; controller = new AbortController(); status(id ? '正在读取日程原文与版本…' : '先安排时间，再从容准备。');
    try {
      const event = id ? await read(id, context, controller.signal) : { title: '', description: '', location: '', category: '生活', color: '#5b81ff', start_at: C.iso(C.date(selected) + 'T09:00'), end_at: C.iso(selected + 'T10:00'), all_day: false, repeat_rule: 'none', reminder_minutes: 0 };
      if (turn !== generation || !current()) return;
      editor = { base: id ? event : null, command: null, remote: null, review: false, missing: false, deleted: false, loading: false, dirty: false, sequence: 0 };
      form.hidden = false; fill(event); status(id ? '保存时核对读取的完整版本；未改动的时间保留原有精度。' : '新建前会在本机保留原提交，结果不明时可核对，避免重复创建。'); $('calendar-event-title').focus();
      return true;
    } catch (error) { if (turn === generation && current()) status(error.message); }
    finally { if (turn === generation) controller = null; }
  }
  function explain(error) {
    if (error.status === 404 && ['route_not_found', 'method_not_allowed'].includes(error.code)) return '当前服务不支持新的日程保存契约，请重启新版 Go；原提交仍在本机。';
    if (error.status === 409) return '日程或提交标识已变化。当前文字仍在，请读取最新内容后对照。';
    return error.uncertain ? '服务端可能已处理，请先核对结果，不会自动重发。' : error.message;
  }
  function acceptCommand(result, row) {
    C.result(result, owner, row);
    if (result.event === null) {
      store(owner).markDeleted(row); row.known_deleted = true; editor.deleted = true; editor.review = true;
      status('回执已确认，原日程已删除。重试不会复活日程，可导出后清理本机记录。'); return;
    }
    store(owner).markConfirmed(row); editor.command = null; editor.base = result.event; editor.review = false; editor.remote = null; editor.deleted = false;
    fill(result.event); status(result.created ? '日程已创建，原内容与确认标记继续保留在本机。' : '已找到原日程，没有再次创建；当前显示最新内容，原提交仍在本机。'); changed(); refreshBadge();
  }
  async function save(event) {
    event.preventDefault(); if (!editor || busy || editor.review || editor.command || editor.deleted || !current()) return;
    const e = editor, context = owner, turn = generation, sequence = e.sequence;
    let body; try { body = C.payload(value(), e.base); } catch (error) { status(error.message); return; }
    busy = true; controller = new AbortController(); status('正在核对与保存，继续输入的修改会保留。');
    try {
      if (!e.base) {
        e.command = store(context).put(body); e.dirty = false; e.review = true; render(); refreshBadge();
        const result = await H.json('/api/v1/calendar/event-commands', { method: 'POST', body: { schema_version: 1, request_id: e.command.request_id, ...e.command.body }, context, signal: controller.signal, validate(value) { C.result(value, context, e.command); } });
        if (turn === generation && current()) acceptCommand(result, e.command);
      } else {
        render(); const latest = await read(e.base.id, context, controller.signal);
        if (C.version(latest) !== C.version(e.base)) { const error = Error('版本已变化'); error.status = 409; throw error; }
        const result = contract(await H.json('/api/v1/calendar/events/' + e.base.id, { method: 'PATCH', body: { ...body, clear_repeat_until: !body.repeat_until }, headers: C.headers(e.base), context, signal: controller.signal, validate(value) { contract(value, context, e.base.id, true); if(C.version(value) === C.version(e.base)) throw Error(); } }), context, e.base.id, true);
        if (turn !== generation || !current()) return;
        if (C.version(result) === C.version(e.base)) { const error = Error('保存响应未提供新版本，请核对结果。'); error.uncertain = true; throw error; }
        e.base = result;
        if (sequence === e.sequence) {
          fill(result);
          window.DaynestCalendarDrafts?.capture(result, { ...value(), timed: editor.timed }, true);
        } else e.dirty = true;
        status(e.dirty ? '上一版已提交，继续输入的修改仍在，请再次保存。' : '已提交服务，当前日程修改已保存。'); changed();
      }
    } catch (error) {
      if (turn !== generation || !current()) return;
      if (error.status === 409 || error.uncertain || e.command) { e.review = true; e.remote = null; $('calendar-event-remote').textContent = '尚未读取最新结果。'; }
      if (error.status === 404 && error.code === 'not_found' && e.base) e.deleted = true;
      status(explain(error));
    } finally { if (turn === generation) { busy = false; controller = null; render(); refreshBadge(); } }
  }
  async function check() {
    if (!editor || busy || !current()) return;
    const e = editor, turn = generation; busy = true; controller = new AbortController(); render();
    try {
      if (e.command) {
        const result = await H.json('/api/v1/calendar/event-commands/' + e.command.request_id, { context: owner, signal: controller.signal });
        if (turn === generation && current()) acceptCommand(result, e.command);
      } else {
        const remote = await read(e.base.id, owner, controller.signal); if (turn !== generation || !current()) return;
        e.remote = remote; e.review = true; $('calendar-event-remote').textContent = C.describe(remote); status('已读取服务端最新内容，当前编辑区保持原样。对照后选择如何继续。');
      }
    } catch (error) {
      if (turn !== generation || !current()) return;
      if (error.status === 404 && error.code === 'not_found') {
        if (e.command) { try{store(owner).markMissing(e.command);}catch(markerError){status(markerError.message+' 原内容仍在，请先导出。');return;} e.missing = true; status(e.command.known_deleted ? '回执暂缺，但原日程曾确认已删除，不会恢复此提交。' : '暂未找到回执。这不保证原请求未处理；可稍后核对，或明确使用原标识重试。'); }
        else { e.deleted = true; e.remote = null; status('当前日程已不存在。编辑文字仍可导出，不会重新创建。'); $('calendar-event-remote').textContent = '日程已删除。'; changed(); }
      } else status(explain(error));
    } finally { if (turn === generation) { busy = false; controller = null; render(); refreshBadge(); } }
  }
  async function retry() {
    if (!editor?.command || busy || !editor.missing || editor.command.known_deleted || !current()) return;
    if (!confirm('确认按原标识、原内容重试？不会创建新的提交标识，也不会覆盖已有日程的后续编辑。')) return;
    const turn = generation, row = editor.command; busy = true; controller = new AbortController(); render();
    try { const result = await H.json('/api/v1/calendar/event-commands', { method: 'POST', body: { schema_version: 1, request_id: row.request_id, ...row.body }, context: owner, signal: controller.signal, validate(value) { C.result(value, owner, row); } }); if (turn === generation && current()) acceptCommand(result, row); }
    catch (error) { if (turn === generation && current()) status(explain(error)); }
    finally { if (turn === generation) { busy = false; controller = null; render(); refreshBadge(); } }
  }
  async function removeEvent() {
    if (!editor?.base || busy || editor.review || editor.deleted || !current()) return;
    if (!confirm((editor.base.repeat_rule === 'none' ? '删除这个日程？' : '删除整组重复日程及全部实例？') + (editor.dirty ? ' 当前未保存的修改不会提交。' : ''))) return;
    const e = editor, turn = generation; busy = true; controller = new AbortController(); render();
    try {
      const latest = await read(e.base.id, owner, controller.signal);
      if (C.version(latest) !== C.version(e.base)) { const error = Error('版本变化'); error.status = 409; throw error; }
      await H.json('/api/v1/calendar/events/' + e.base.id, { method: 'DELETE', headers: C.headers(e.base), context: owner, signal: controller.signal });
      if (turn !== generation || !current()) return;
      e.deleted = true; e.dirty = false; status('日程已删除。'); changed();
    } catch (error) { if (turn === generation && current()) { e.review = error.uncertain || error.status === 409; e.pendingDelete = !!error.uncertain; e.remote = null; status(explain(error)); if (error.status === 404 && error.code === 'not_found') { e.deleted = true; status('当前日程已不存在。'); } } }
    finally { if (turn === generation) { busy = false; controller = null; render(); } }
  }
  form.addEventListener('submit', save);
  const touch = () => { if (editor) { editor.dirty = true; editor.sequence++; captureDraft(); } };
  form.addEventListener('input', touch); form.addEventListener('change', () => { touch(); render(); });
  $('calendar-event-all-day').addEventListener('change', () => {
    if (!editor) return; const v = value(), start = v.start, end = v.end;
    if (v.all_day && !editor.mode) {
      editor.timed = { start, end }; $('calendar-event-start').type = $('calendar-event-end').type = 'date';
      $('calendar-event-start').value = start.slice(0, 10); $('calendar-event-end').value = end.slice(11) === '00:00' && end > start ? C.shift(end.slice(0, 10), -1) : end.slice(0, 10);
    } else if (!v.all_day && editor.mode) {
      $('calendar-event-start').type = $('calendar-event-end').type = 'datetime-local';
      const same = editor.timed && editor.timed.start.slice(0, 10) === start && editor.timed.end.slice(0, 10) === end;
      $('calendar-event-start').value = same ? editor.timed.start : start + 'T09:00'; $('calendar-event-end').value = same ? editor.timed.end : end + 'T18:00';
    }
    editor.mode = v.all_day; render();
  });
  $('calendar-dialog-close').addEventListener('click', close); $('calendar-event-cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('calendar-event-check').addEventListener('click', check); $('calendar-command-retry').addEventListener('click', retry); $('calendar-event-delete').addEventListener('click', removeEvent);
  $('calendar-recovery-open').addEventListener('click', recovery);
  $('calendar-event-use-server').addEventListener('click', () => {
    if (!editor?.remote || busy || !confirm('采用服务端内容会替换当前编辑区，确定继续？')) return;
    editor.base = editor.remote; editor.remote = null; editor.review = false; editor.pendingDelete = false; fill(editor.base); $('calendar-event-remote').textContent = ''; status('已采用服务端版本，没有再次发送原操作。'); changed();
  });
  $('calendar-event-keep-local').addEventListener('click', () => {
    if (!editor?.remote || busy || editor.pendingDelete || !confirm('已对照最新内容，确定保留当前字段继续编辑？下次保存会继续校验新版本。')) return;
    editor.base = editor.remote; editor.remote = null; editor.review = false; editor.dirty = true; render(); status('当前文字与安排已保留，请核对整组重复范围，再手动保存。');
  });
  $('calendar-command-clear').addEventListener('click', () => {
    if (!editor?.command || busy || !confirm('仅清理这项本机待核对记录，不撤销服务端日程。未确认结果请先核对或导出，确定清理？')) return;
    try { store(owner).remove(editor.command); editor.dirty = false; close(); } catch (error) { status(error.message); }
  });
  $('calendar-event-export').addEventListener('click', async () => {
    if (!editor || !current()) return;
    const v = value(), text = `# ${v.title || '日程修改'}\n\n> 当前编辑内容，未保证提交成功\n> ${owner.server}\n> ${editor.command ? '提交标识：' + editor.command.request_id : '日程：' + (editor.base?.id || '尚未创建')}\n\n北京时间（UTC+08:00）\n${v.all_day ? '全天日期（含结束日）' : '开始与结束'}：${v.start} 至 ${v.end}\n分类：${v.category}\n重复：${v.repeat_rule}\n重复截止：${v.repeat_until || '无'}\n提醒：提前 ${v.reminder_minutes} 分钟\n地点：${v.location}\n\n${v.description}\n`;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' }), filename = '日程编辑-' + (editor.base?.id || editor.command?.request_id || '草稿') + '.md';
    try { if (window.DaynestMobile?.saveBlob) await window.DaynestMobile.saveBlob(blob, filename, owner.token);
      else { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } }
    catch (error) { status(error.message); }
  });
  window.DaynestUI?.registerGuard('calendar-events', () => !!editor?.dirty || busy || !!editor?.review);
  document.addEventListener('daynest:account-leaving', () => { clear(); refreshBadge(); });
  document.addEventListener('daynest:account-ready', () => { if (owner && !current()) clear(); refreshBadge(); });
  document.addEventListener('daynest:auth-expired', () => { if (editor) { status('登录已过期，当前文字仍在。请先导出，再重新登录。'); render(); } });
  window.addEventListener('storage', event => {
    if ((!event.key || event.key === 'studyflow.token') && owner && !current()) clear();
    if (!event.key || event.key === 'studyflow.token' || event.key.startsWith(C.PREFIX)) refreshBadge();
    if (event.key === C.PREFIX + 'changed') try { const v = JSON.parse(event.newValue), context = H.capture(); if (v.server === context.server && v.userID === context.userID) changed(false); } catch (_) {}
  });
  window.DaynestCalendarDrafts?.connect({
    read, notice: text => { $('calendar-draft-status').textContent = text; },
    async restore(record) {
      const context = H.capture();
      if (record.base.user_id !== context.userID || !await open(record.base.id) || !current() || !H.current(context)) return false;
      const remote = editor.base;
      editor.base = record.base;
      applyFields({ ...record.value, timed: record.value.timed ? { ...record.value.timed } : null });
      editor.remote = remote; editor.review = true; editor.dirty = true;
      $('calendar-event-remote').textContent = C.describe(remote);
      render(); status('草稿已恢复，请对照服务端版本，再选择保留当前字段或采用服务端内容。');
      return true;
    }
  });
  window.DaynestCalendarEvents = { open, recovery };
  refreshBadge();
})();
