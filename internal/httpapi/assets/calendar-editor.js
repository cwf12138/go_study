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
  function eventPath(id, originalStart) {
    const path = '/api/v1/calendar/events/' + encodeURIComponent(id);
    return originalStart ? path + '/occurrences/' + encodeURIComponent(originalStart) : path;
  }
  function occurrenceContract(event, context, id, originalStart) {
    contract(event, context, id);
    if (event.original_start !== originalStart || event.repeat_rule !== 'none' ||
        event.overridden !== undefined && typeof event.overridden !== 'boolean') throw Error('本次日程响应与所选日期不一致。');
    return event;
  }
  async function readOccurrence(id, originalStart, context = H.capture(), signal) {
    const response = await H.json(eventPath(id, originalStart), { context, signal, envelope: true });
    if (response.meta?.write_contract !== 'calendar-occurrence-if-match-v1') throw Error('服务版本暂不支持单次编辑。');
    return occurrenceContract(response.data, context, id, originalStart);
  }
  function readEditor(item, context, signal) {
    return item.onlyThis ? readOccurrence(item.base.id, item.originalStart, context, signal) : read(item.base.id, context, signal);
  }
  function draftScope(item) {
    if (item.onlyThis) return { originalStart: item.originalStart };
    return item.base ? {} : { requestID: item.requestID };
  }
  function captureFields(item, fields, submitted = false) {
    // The draft only needs the fields and version it can edit.
    const base = item.base?.occurrence_overrides ? { ...item.base, occurrence_overrides: undefined } : item.base;
    window.DaynestCalendarDrafts?.capture(base, fields, submitted, draftScope(item));
  }
  function value() {
    return { title: $('calendar-event-title').value, description: $('calendar-event-description').value, location: $('calendar-event-location').value,
      category: $('calendar-event-category').value, color: $('calendar-event-color').value, start: $('calendar-event-start').value, end: $('calendar-event-end').value,
      all_day: $('calendar-event-all-day').checked, repeat_rule: $('calendar-event-repeat').value, repeat_until: $('calendar-event-repeat-until').value,
      reminder_minutes: Number($('calendar-event-reminder').value) };
  }
  function captureDraft() {
    if (!editor?.dirty || editor.command || !current()) return;
    if (!editor.base && editor.sequence === editor.restoredSequence) return;
    const fields = { ...value(), timed: editor.timed ? { ...editor.timed } : null };
    captureFields(editor, fields);
  }
  function renderOverrides() {
    const details = $('calendar-occurrence-overrides');
    const overrides = editor && !editor.onlyThis ? editor.base?.occurrence_overrides : null;
    details.hidden = !overrides?.length;
    if (details.hidden || editor.renderedOverrides === overrides) return;
    editor.renderedOverrides = overrides;
    $('calendar-occurrence-summary').textContent = `已单独调整 ${overrides.length} 次`;
    const sorted = [...overrides].sort((a, b) => a.original_start.localeCompare(b.original_start));
    $('calendar-occurrence-list').replaceChildren(...sorted.map(item => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'quiet';
      const original = C.wall(item.original_start).replace('T', ' ');
      const now = C.wall(item.start_at).replace('T', ' ');
      button.textContent = `${item.title} · ${original}${now === original ? '' : ' → ' + now}`;
      button.addEventListener('click', () => switchScope(true, item.original_start));
      return button;
    }));
  }
  function render() {
    captureDraft();
    let proof = $("calendar-save-proof"); if (!proof) { proof = document.createElement("span"); proof.id = "calendar-save-proof"; $("calendar-editor-status").after(proof); }
    const resource = editor?.onlyThis ? `${editor.base.id}/occurrences/${encodeURIComponent(editor.originalStart)}` : editor?.base?.id;
    window.DaynestSaveStatus?.bind(proof, "calendar/events", resource);
    $('calendar-dialog-close').disabled = busy;
    $('calendar-event-cancel').disabled = busy;
    if (!editor) return;
    const single = editor.onlyThis;
    const canSwitch = !!editor.originalStart && !!editor.base && !editor.deleted;
    $('calendar-scope-actions').hidden = !canSwitch;
    $('calendar-edit-occurrence').hidden = single || !canSwitch || editor.base.repeat_rule === 'none';
    $('calendar-edit-series').hidden = !single;
    $('calendar-edit-occurrence').disabled = $('calendar-edit-series').disabled = busy || H.authExpired();
    $('calendar-event-recurrence-fields').hidden = single;
    renderOverrides();
    $('calendar-event-fields').disabled = editor.loading || editor.deleted || !!editor.command;
    $('calendar-event-save').disabled = busy || editor.loading || editor.review || editor.deleted || !!editor.command || H.authExpired();
    $('calendar-event-save').textContent = busy ? '正在核对与保存…' : single ? '保存本次' : editor.base?.repeat_rule !== 'none' && editor.base ? '保存整组' : editor.base ? '保存修改' : '创建日程';
    $('calendar-event-delete').classList.toggle('hidden', !editor.base || single && !editor.base.overridden);
    $('calendar-event-delete').textContent = single ? '恢复整组安排' : editor.base && editor.base.repeat_rule !== 'none' ? '删除整组' : '删除日程';
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
    const scope = single ? `仅本次 · 原定 ${C.wall(editor.originalStart).replace('T', ' ')} · 北京时间` :
      repeated ? '重复日程：编辑和删除作用于整组；开始与结束是首次安排。' : '个人日程 · 按北京时间（UTC+08:00）安排。';
    $('calendar-editor-scope').textContent = scope + (all ? ' 全天日期包含结束当天。' : '') + (editor.command ? ' 原提交内容已固定，核对前不会再次创建。' : '');
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
    $('calendar-scope-actions').hidden = true;
    $('calendar-occurrence-overrides').hidden = true;
    $('calendar-occurrence-overrides').open = false;
    $('calendar-occurrence-list').replaceChildren();
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
    return true;
  }
  async function open(id = '', selected = C.day(new Date().toISOString()), minutes = null, originalStart = '', onlyThis = false) {
    if (!id) { try { if (store(H.capture()).read().some(row=>!row.confirmed||row.missing)) return recovery(); } catch (error) { notify(error.message, true); return; } }
    const turn = begin(onlyThis ? '编辑本次日程' : id ? '编辑日程' : '留一段时间给它'); if (turn === null) return;
    window.DaynestCalendarDrafts?.begin();
    const context = owner; controller = new AbortController(); status(id ? '正在读取日程原文与版本…' : '先安排时间，再从容准备。');
    try {
      const startMinutes = Number.isInteger(minutes) ? Math.min(1410, Math.max(0, minutes)) : 540;
      const start = C.iso(C.date(selected) + 'T' + String(Math.floor(startMinutes / 60)).padStart(2, '0') + ':' + String(startMinutes % 60).padStart(2, '0'));
      const end = new Date(Date.parse(start) + (minutes === null ? 60 : 30) * 60000).toISOString();
      const event = id ? await (onlyThis ? readOccurrence(id, originalStart, context, controller.signal) : read(id, context, controller.signal)) : { title: '', description: '', location: '', category: '生活', color: '#5b81ff', start_at: start, end_at: end, all_day: false, repeat_rule: 'none', reminder_minutes: 0 };
      if (turn !== generation || !current()) return;
      editor = { base: id ? event : null, originalStart, onlyThis, command: null, remote: null, review: false, missing: false, deleted: false, loading: false, dirty: false, sequence: 0 };
      if (!id) editor.requestID = window.DaynestCalendarDraftCore.writerID();
      form.hidden = false; fill(event); status(id ? '保存时核对读取的完整版本；未改动的时间保留原有精度。' : '输入后可从本机草稿继续。点击创建时会保留提交记录，方便核对结果。'); $('calendar-event-title').focus();
      return true;
    } catch (error) { if (turn === generation && current()) status(error.message); }
    finally { if (turn === generation) controller = null; }
  }
  function switchScope(onlyThis, originalStart = editor?.originalStart) {
    if (!editor?.base || !originalStart || busy) return;
    const focus = returnFocus;
    open(editor.base.id, undefined, null, originalStart, onlyThis);
    returnFocus = focus;
  }
  function explain(error) {
    if (error.code === 'invalid_state' && editor?.base?.occurrence_overrides?.length) return '此更改会移除已单独调整的日期。请先从「已单独调整」打开相关日程并恢复整组安排。';
    if (error.status === 404 && ['route_not_found', 'method_not_allowed'].includes(error.code)) return '当前服务不支持新的日程保存契约，请重启新版 Go；原提交仍在本机。';
    if (error.status === 409) return '日程或提交标识已变化。当前文字仍在，请读取最新内容后对照。';
    return error.uncertain ? '服务端可能已处理，请先核对结果，不会自动重发。' : error.message;
  }
  function acceptCommand(result, row) {
    C.result(result, owner, row);
    if (result.event === null) {
      store(owner).markDeleted(row); row.known_deleted = true; editor.deleted = true; editor.review = true;
      retireCreateDrafts(row);
      status('回执已确认，原日程已删除。重试不会复活日程，可导出后清理本机记录。'); return;
    }
    store(owner).markConfirmed(row); editor.command = null; editor.base = result.event; editor.review = false; editor.remote = null; editor.deleted = false;
    retireCreateDrafts(row);
    fill(result.event); status(result.created ? '日程已创建，原内容与确认标记继续保留在本机。' : '已找到原日程，没有再次创建；当前显示最新内容，原提交仍在本机。'); changed(); refreshBadge();
  }
  function retireCreateDrafts(row) {
    const source = editor.draftSource;
    try {
      window.DaynestCalendarDrafts?.removeMatching(record =>
        (source && source.id === record.id && source.generation === record.generation) ||
        window.DaynestCalendarDraftCore.transferred(record, row));
    } catch (_) {
      $('calendar-draft-status').textContent = '提交已核对，仍在列表的本机草稿可手动清理。';
    }
  }
  async function save(event) {
    event.preventDefault(); if (!editor || busy || editor.review || editor.command || editor.deleted || !current()) return;
    const e = editor, context = owner, turn = generation, sequence = e.sequence;
    let body; try { body = C.payload(value(), e.base); } catch (error) { status(error.message); return; }
    busy = true; controller = new AbortController(); status('正在核对与保存，继续输入的修改会保留。');
    try {
      if (!e.base) {
        const journal = store(context);
        const prior = journal.read().find(row => row.request_id === e.requestID);
        if (prior) {
          status('这份草稿已有提交记录。请从日历筛选菜单打开新建记录进行核对，当前输入可继续导出。');
          return;
        }
        e.command = journal.put(body, e.requestID);
        e.dirty = false; e.review = true; render(); refreshBadge();
        const result = await H.json('/api/v1/calendar/event-commands', { method: 'POST', body: { schema_version: 1, request_id: e.command.request_id, ...e.command.body }, context, signal: controller.signal, validate(value) { C.result(value, context, e.command); } });
        if (turn === generation && current()) acceptCommand(result, e.command);
      } else {
        render(); const latest = await readEditor(e, context, controller.signal);
        if (C.version(latest) !== C.version(e.base)) { const error = Error('版本已变化'); error.status = 409; throw error; }
        const result = await H.json(eventPath(e.base.id, e.onlyThis ? e.originalStart : ''), {
          method: e.onlyThis ? 'PUT' : 'PATCH',
          body: e.onlyThis ? body : { ...body, clear_repeat_until: !body.repeat_until },
          headers: C.headers(e.base), context, signal: controller.signal,
          validate(value) {
            if (e.onlyThis) occurrenceContract(value, context, e.base.id, e.originalStart);
            else contract(value, context, e.base.id, true);
            if (C.version(value) === C.version(e.base) || e.onlyThis && !value.overridden) throw Error();
          }
        });
        if (turn !== generation || !current()) return;
        e.base = result;
        if (sequence === e.sequence) {
          fill(result);
          captureFields(e, { ...value(), timed: editor.timed }, true);
        } else e.dirty = true;
        status(e.dirty ? '上一版已提交，继续输入的修改仍在，请再次保存。' : e.onlyThis ? '已提交服务，本次日程已调整。' : '已提交服务，当前日程修改已保存。'); changed();
      }
    } catch (error) {
      if (turn !== generation || !current()) return;
      if (error.status === 409 && error.code !== 'invalid_state' || error.uncertain || e.command) { e.review = true; e.remote = null; $('calendar-event-remote').textContent = '尚未读取最新结果。'; }
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
        const remote = await readEditor(e, owner, controller.signal); if (turn !== generation || !current()) return;
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
    const prompt = editor.onlyThis ? '将本次日程恢复为整组安排？' : editor.base.repeat_rule === 'none' ? '删除这个日程？' : '删除整组重复日程及全部实例？';
    if (!confirm(prompt + (editor.dirty ? ' 可先返回并导出当前编辑内容。' : ''))) return;
    const e = editor, turn = generation, sequence = e.sequence; busy = true; controller = new AbortController(); render();
    try {
      const latest = await readEditor(e, owner, controller.signal);
      if (C.version(latest) !== C.version(e.base)) { const error = Error('版本变化'); error.status = 409; throw error; }
      const result = await H.json(eventPath(e.base.id, e.onlyThis ? e.originalStart : ''), {
        method: 'DELETE', headers: C.headers(e.base), context: owner, signal: controller.signal,
        validate(value) {
          if (!e.onlyThis) return;
          occurrenceContract(value, owner, e.base.id, e.originalStart);
          if (value.overridden || C.version(value) === C.version(e.base)) throw Error();
        }
      });
      if (turn !== generation || !current()) return;
      if (e.onlyThis) {
        e.base = result;
        if (sequence === e.sequence) fill(result);
        status(e.dirty ? '本次日程已恢复为整组安排。恢复期间的新输入仍在草稿中。' : '本次日程已恢复为整组安排。');
      } else { e.deleted = true; e.dirty = false; status('日程已删除。'); }
      changed();
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
  $('calendar-edit-occurrence').addEventListener('click', () => switchScope(true));
  $('calendar-edit-series').addEventListener('click', () => switchScope(false));
  $('calendar-event-use-server').addEventListener('click', () => {
    if (!editor?.remote || busy || !confirm('采用服务端内容会替换当前编辑区，确定继续？')) return;
    editor.base = editor.remote; editor.remote = null; editor.review = false; editor.pendingDelete = false; fill(editor.base); $('calendar-event-remote').textContent = ''; status('已采用服务端版本，没有再次发送原操作。'); changed();
  });
  $('calendar-event-keep-local').addEventListener('click', () => {
    if (!editor?.remote || busy || editor.pendingDelete || !confirm('已对照最新内容，确定保留当前字段继续编辑？下次保存会继续校验新版本。')) return;
    editor.base = editor.remote; editor.remote = null; editor.review = false; editor.dirty = true; render();
    status(editor.onlyThis ? '当前文字与安排已保留，请检查本次日期后手动保存。' : '当前文字与安排已保留，请核对整组重复范围，再手动保存。');
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
    readDraft(record) {
      return record.originalStart ? readOccurrence(record.base.id, record.originalStart) : read(record.base.id);
    },
    hasSubmission(record) {
      return store(H.capture()).read().some(row => row.request_id === record.requestID);
    },
    async restore(record) {
      const context = H.capture();
      if (record.base === null) {
        const prior = store(context).read().find(row => row.request_id === record.requestID);
        if (prior) {
          if (begin('核对原日程提交') === null) return false;
          recover(prior);
          return true;
        }
        if (!await open() || !H.current(context)) return false;
        // An unresolved submission from a different session may have opened the journal.
        if (!editor) return true;
        editor.requestID = record.requestID;
        editor.draftSource = record;
        applyFields(record.value);
        editor.restoredSequence = editor.sequence;
        editor.dirty = true;
        status('已恢复新建草稿。确认日期和内容后，点击创建日程。');
        return true;
      }
      if (record.base.user_id !== context.userID ||
          !await open(record.base.id, undefined, null, record.originalStart, !!record.originalStart) ||
          !current() || !H.current(context)) return false;
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
