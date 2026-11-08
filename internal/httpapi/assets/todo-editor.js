(() => {
  'use strict';
  const H = window.DaynestHTTP, C = window.DaynestTodoEditorCore;
  const $ = id => document.getElementById(id), pending = new Map();
  let owner = null, epoch = 0, editor = null, busy = false, controller = null, returnFocus = null;
  const dialog = document.createElement('dialog');
  dialog.id = 'todo-editor'; dialog.className = 'todo-editor'; dialog.setAttribute('aria-labelledby', 'te-title');
  dialog.innerHTML = `<header class="te-header"><div><p>MAKE ROOM FOR WHAT MATTERS</p><h2 id="te-title">整理这件待办</h2></div><button id="te-close" type="button" aria-label="关闭待办详情">×</button></header>
    <div class="te-body"><div class="te-meta"><span id="te-state"></span><span id="te-updated"></span></div>
    <p id="te-status" role="status" aria-live="polite"></p><span id="te-save-proof" hidden></span><p id="te-draft-status" role="status"></p>
    <form id="te-form"><fieldset id="te-fields"><label>待办标题<input id="te-name" required maxlength="400" autocomplete="off"></label>
    <div class="te-row"><label>放入分类<select id="te-list"></select></label><label>优先级<select id="te-priority"><option value="medium">普通</option><option value="high">重要</option><option value="low">低</option></select></label></div>
    <div class="te-row"><label>截止时间 · 本地时间<input id="te-due" type="datetime-local"></label><label>安排到哪一天<input id="te-myday" type="date"></label></div>
    <div class="te-row"><label>重复<select id="te-repeat"><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><label>标签 · 英文逗号分隔<input id="te-tags" maxlength="600"></label></div>
    <label>备注<textarea id="te-notes" rows="5" maxlength="12000" placeholder="补充细节、地址或完成标准"></textarea></label>
    <section class="te-step-section"><div><h3>拆成小步骤</h3><button id="te-add-step" type="button">＋ 添加步骤</button></div><div id="te-steps"></div></section></fieldset>
    <div class="te-footer"><button id="te-export" type="button" class="quiet">导出当前文字 ↓</button><button id="te-save" type="submit" class="primary">保存修改</button></div></form>
    <section id="te-review" class="te-review" hidden><header><div><p>先核对，再继续</p><h3 id="te-review-title">服务端内容</h3></div><button id="te-check" type="button" class="quiet">读取最新版本</button></header><pre id="te-server"></pre>
    <div class="te-review-actions"><button id="te-use-server" type="button">采用服务端内容</button><button id="te-keep-local" type="button">保留我的文字，继续编辑</button><button id="te-finish-check" type="button" hidden>结束本次核对</button></div></section>
    <p class="te-note">修改保存到电脑服务；多窗口发生变化时先对照。开启本机草稿后可在刷新后找回修改。请在「本机编辑草稿」核对保留结果，也可导出文字。</p></div>`;
  document.body.append(dialog);
  const banner = document.createElement('button');
  banner.className = 'te-pending'; banner.id = 'todo-pending'; banner.type = 'button'; banner.hidden = true;
  document.body.append(banner);

  const notify = (text, error = false) => window.DaynestUI?.notify(text, error ? 'error' : 'success');
  const changed = () => document.dispatchEvent(new CustomEvent('daynest:todos-changed'));
  const current = () => !!owner && H.current(owner);
  function contract(todo, context, uncertain = false) {
    if (!C.valid(todo, context.userID)) {
      const error = Error('待办数据不完整，请核对服务版本与保存结果。');
      error.uncertain = uncertain; throw error;
    }
    return todo;
  }
  async function read(id, context = H.capture(), signal) {
    const result = await H.json('/api/v1/todos/' + encodeURIComponent(id), { context, signal, envelope: true });
    if (result.meta?.write_contract !== 'todo-if-match-v1') throw Error('当前服务不支持待办版本校验，请重启新版 Go 服务。');
    const todo = contract(result.data, context);
    if (todo.id !== id) throw Error('返回了不同的待办，已拒绝采用。');
    return todo;
  }
  function updateBanner() {
    const entries = [...pending.values()].filter(p => H.current(p.context));
    banner.hidden = !entries.length;
    banner.textContent = `${entries.length} 项待办操作待核对 · 点击查看`;
  }
  function status(text) { $('te-status').textContent = text; }
  function captureDraft() {
    if (editor?.dirty && current()) window.DaynestTodoDrafts?.capture(editor.base, formValue());
  }
  function renderState() {
    if (!editor) return;
    captureDraft();
    window.DaynestSaveStatus?.bind($("te-save-proof"), "todos", editor.base?.id);
    $('te-fields').disabled = editor.deleted || editor.loading || !!editor.action;
    $('te-save').disabled = busy || editor.loading || editor.deleted || editor.review;
    $('te-save').textContent = busy ? '正在保存…' : '保存修改';
    $('te-close').disabled = busy;
    $('te-add-step').disabled = busy || editor.steps.length >= 30;
    dialog.querySelectorAll('[data-te-remove]').forEach(b => b.disabled = busy);
    $('te-review').hidden = !editor.review;
    $('te-check').disabled = busy;
    $('te-use-server').disabled = busy || !editor.remote;
    $('te-keep-local').disabled = busy || !editor.remote || !!editor.action;
    $('te-finish-check').hidden = !editor.action;
    $('te-finish-check').disabled = busy || !editor.checked;
    $('te-state').textContent = editor.deleted ? '任务已不存在' : editor.base.status === 'completed' ? '已完成' : '待处理';
    $('te-updated').textContent = '读取版本 · ' + new Date(editor.base.updated_at).toLocaleString('zh-CN');
    $('te-myday').disabled = editor.base.status === 'completed';
  }
  function formValue() {
    return { title: $('te-name').value, notes: $('te-notes').value, list_id: $('te-list').value, priority: $('te-priority').value,
      due: $('te-due').value, my_day_date: $('te-myday').value, repeat_rule: $('te-repeat').value, tags: $('te-tags').value,
      steps: editor.steps.map(s => ({ ...s })) };
  }
  function renderSteps() {
    const container = $('te-steps'); container.replaceChildren();
    for (const [index, step] of editor.steps.entries()) {
      const row = document.createElement('div'); row.className = 'te-step';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = step.completed; check.setAttribute('aria-label', `步骤 ${index + 1} 已完成`);
      const title = document.createElement('input'); title.type = 'text'; title.value = step.title; title.maxLength = 400; title.required = true; title.setAttribute('aria-label', `步骤 ${index + 1} 标题`);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.dataset.teRemove = index; remove.setAttribute('aria-label', `删除步骤 ${index + 1}`);
      check.addEventListener('change', () => { step.completed = check.checked; editor.dirty = true; editor.sequence++; });
      title.addEventListener('input', () => { step.title = title.value; editor.dirty = true; editor.sequence++; });
      remove.addEventListener('click', () => { if (!busy) { editor.steps.splice(index, 1); editor.dirty = true; editor.sequence++; renderSteps(); renderState(); } });
      row.append(check, title, remove); container.append(row);
    }
  }
  function fill(todo) {
    applyFields(C.editable(todo));
  }
  function applyFields(value) {
    for (const [field, key] of [['name', 'title'], ['notes', 'notes'], ['list', 'list_id'], ['priority', 'priority'], ['due', 'due'], ['myday', 'my_day_date'], ['repeat', 'repeat_rule'], ['tags', 'tags']]) $('te-' + field).value = value[key];
    editor.steps = value.steps; editor.dirty = false; editor.sequence++;
    renderSteps(); renderState();
  }
  function clear() {
    epoch++; controller?.abort(); controller = null; owner = null; editor = null; busy = false;
    for (const id of ['te-name', 'te-notes', 'te-tags', 'te-due', 'te-myday']) $(id).value = '';
    for (const id of ['te-list', 'te-steps', 'te-server', 'te-status', 'te-updated', 'te-state', 'te-draft-status']) $(id).textContent = '';
    $('te-close').disabled = false;
    if (dialog.open) dialog.close();
  }
  function close() {
    if (busy) return;
    if (editor?.dirty && !confirm('当前修改尚未提交。请确认本机草稿已保留或已导出，确定关闭？')) return;
    const focus = returnFocus; clear(); focus?.focus?.();
  }
  async function open(id, action = null) {
    action = action || pending.get(id) || null;
    if (action?.state === 'sending') { notify('正在等待这项操作的结果，请稍后。'); return; }
    if (busy || editor?.dirty && !confirm('切换待办会放弃当前未保存的修改，确定继续？')) return;
    clear(); window.DaynestTodoDrafts?.begin(); const generation = epoch; owner = H.capture(); const context = owner; returnFocus = document.activeElement;
    if (!context.userID || H.authExpired()) { notify('请先在线核验账号。', true); return; }
    status('正在读取待办…'); dialog.showModal(); $('te-form').hidden = true; $('te-review').hidden = true;
    controller = new AbortController();
    try {
      const [todo, lists] = await Promise.all([read(id, context, controller.signal), H.json('/api/v1/todo-lists', { context, signal: controller.signal })]);
      if (generation !== epoch || !current()) return;
      if (!Array.isArray(lists) || !lists.every(l => l.user_id === context.userID && typeof l.id === 'string' && typeof l.name === 'string')) throw Error('分类数据不完整，请重新读取。');
      editor = { base: todo, steps: [], sequence: 0, dirty: false, review: !!action, remote: action ? todo : null, action, checked: !!action, deleted: false, loading: false };
      for (const list of lists) { const option = document.createElement('option'); option.value = list.id; option.textContent = list.name; $('te-list').append(option); }
      $('te-form').hidden = false; $('te-server').textContent = action ? C.describe(todo) : '';
      fill(todo); status(action ? `原操作「${({complete:'更改完成状态',myday:'调整我的一天',step:'更改步骤状态',delete:'删除待办'})[action.kind]}」待核对，当前显示服务端最新内容。核对完成前不会再次发送。` : todo.next_todo_id ? '此周期任务已生成过下一项。重新完成不会再生成第二项。' : '修改标题、安排与步骤，保存时会校验读取的版本。');
      $('te-name').focus();
      return true;
    } catch (error) {
      if (generation !== epoch || !current()) return;
      if (action && error.status === 404 && error.code === 'not_found') {
        editor = { base: action.todo, steps: [], sequence: 0, dirty: false, review: true, remote: null, action, checked: true, deleted: true, loading: false };
        const option = document.createElement('option'); option.value = action.todo.list_id; option.textContent = '原分类'; $('te-list').append(option);
        $('te-form').hidden = false; fill(action.todo); $('te-server').textContent = '当前服务端已不存在此任务。不会再次发送原操作，也不会重新创建任务。';
        status('当前任务已不存在，可结束本次核对。');
      } else status(error.message);
    }
    finally { if (generation === epoch) controller = null; }
  }
  async function check() {
    if (!editor || busy || !current()) return;
    const generation = epoch, e = editor; busy = true; controller = new AbortController(); renderState();
    try {
      const [todo, lists] = await Promise.all([read(e.base.id, owner, controller.signal), H.json('/api/v1/todo-lists', { context: owner, signal: controller.signal })]);
      if (generation !== epoch || !current()) return;
      if (!Array.isArray(lists) || !lists.every(l => l.user_id === owner.userID && typeof l.id === 'string' && typeof l.name === 'string')) throw Error('分类数据不完整，未采用新版本。');
      const selected = $('te-list').value; $('te-list').replaceChildren();
      for (const list of lists) { const option = document.createElement('option'); option.value = list.id; option.textContent = list.name; $('te-list').append(option); }
      $('te-list').value = selected;
      e.remote = todo; e.checked = true; $('te-server').textContent = C.describe(todo);
      status('已读取最新版本。请对照后选择采用服务端内容，或保留当前文字继续编辑。');
    } catch (error) {
      if (generation !== epoch || !current()) return;
      if (error.status === 404 && error.code === 'not_found') { e.remote = null; e.checked = true; e.deleted = true; $('te-server').textContent = '当前服务端已不存在此任务。不会把编辑内容重新创建为另一项。'; status('任务已删除，当前文字仍可导出。'); }
      else status('核对失败，当前文字仍在：' + error.message);
    } finally { if (generation === epoch) { busy = false; controller = null; renderState(); } }
  }
  async function save(event) {
    event.preventDefault(); if (!editor || busy || editor.review || editor.deleted || !current()) return;
    const e = editor, generation = epoch, context = owner, sequence = e.sequence;
    let body; try { body = C.payload(formValue(), e.base); } catch (error) { status(error.message); return; }
    busy = true; controller = new AbortController(); renderState(); status('正在保存；此时继续输入的文字会保留。');
    try {
      const todo = contract(await H.json('/api/v1/todos/' + e.base.id, { method: 'PATCH', body, headers: C.headers(e.base), context, signal: controller.signal, validate(value) { contract(value, context, true); if(value.id !== e.base.id || C.version(value) === C.version(e.base)) throw Error(); } }), context, true);
      if (generation !== epoch || !current()) return;
      if (todo.id !== e.base.id || C.version(todo) === C.version(e.base)) { const error = Error('保存响应与原任务或版本不一致，请核对结果。'); error.uncertain = true; throw error; }
      e.base = todo;
      // Step order cannot change during the request. Preserve new input while
      // adopting server-assigned identities for newly added steps.
      e.steps.forEach((step, i) => { if (!step.id) step.id = todo.steps?.[i]?.id || ''; });
      if (sequence === e.sequence) { fill(todo); window.DaynestTodoDrafts?.capture(todo, formValue(), true); }
      else e.dirty = true;
      status(e.dirty ? '上一版已提交，继续输入的修改仍在，请再次保存。' : '已提交服务，当前修改已保存。'); changed();
    } catch (error) {
      if (generation !== epoch || !current()) return;
      if (error.status === 409 || error.uncertain) { e.review = true; e.remote = null; e.checked = false; $('te-server').textContent = '尚未读取最新版本。'; status(error.uncertain ? '保存结果尚未确认。先读取服务端核对，不会自动重发。' : '其他窗口或设备已修改此任务。当前文字已保留，请先对照服务端。'); }
      else if (error.status === 404 && error.code === 'not_found') { e.deleted = true; status('原任务已删除，当前文字仍可导出。'); }
      else status(error.message);
    } finally { if (generation === epoch) { busy = false; controller = null; renderState(); } }
  }
  async function action(todo, kind, value) {
    const context = H.capture();
    if (!C.valid(todo, context.userID)) { notify('待办数据尚未完整读取，请刷新后再操作。', true); return; }
    const existing = pending.get(todo.id);
    if (existing && H.current(existing.context)) { if (existing.state !== 'sending') await open(todo.id, existing); return; }
    const command = { todo, kind, context, state: 'sending' }; pending.set(todo.id, command); updateBanner();
    let path = '/api/v1/todos/' + todo.id, method = 'PATCH', body;
    if (kind === 'complete') { path += '/status'; body = { completed: value }; }
    else if (kind === 'myday') { path += '/my-day'; method = value ? 'PUT' : 'DELETE'; body = value ? { date: value } : undefined; }
    else if (kind === 'step') { path += '/steps/' + value.id; body = { completed: value.completed }; }
    else if (kind === 'delete') method = 'DELETE';
    else { pending.delete(todo.id); updateBanner(); return; }
    try {
      // Old servers ignore unknown headers. Verify support before using their
      // pre-existing status/day/step/delete routes, then preserve the clicked version.
      const latest = await read(todo.id, context);
      if (C.version(latest) !== C.version(todo)) { const conflict = Error('任务已变化，请核对。'); conflict.status = 409; throw conflict; }
      const result = await H.json(path, { method, body, headers: C.headers(todo), context });
      if (kind !== 'delete') { contract(result, context, true); if (result.id !== todo.id) { const error = Error('操作返回不同的待办，请核对结果。'); error.uncertain = true; throw error; } }
      if (pending.get(todo.id) === command) pending.delete(todo.id); changed();
      notify(kind === 'delete' ? '待办已删除。' : kind === 'complete' ? value ? '待办已完成。' : '待办已重新打开。' : '待办已更新。');
    } catch (error) {
      if (!H.current(context)) { if (pending.get(todo.id) === command) pending.delete(todo.id); return; }
      if (error.uncertain || error.status === 409) {
        command.state = 'review'; notify(error.uncertain ? '操作结果尚未确认，请点击待核对提示读取结果。' : '任务已变化，本次操作未覆盖新内容，请核对最新状态。', true);
      } else { if (pending.get(todo.id) === command) pending.delete(todo.id); notify(error.message, true); }
    } finally { updateBanner(); }
  }

  $('te-form').addEventListener('submit', save);
  $('te-form').addEventListener('input', () => { if (editor) { editor.dirty = true; editor.sequence++; captureDraft(); } });
  $('te-form').addEventListener('change', () => { if (editor) { editor.dirty = true; editor.sequence++; captureDraft(); } });
  $('te-add-step').addEventListener('click', () => { if (editor && !busy && editor.steps.length < 30) { editor.steps.push({ id: '', title: '', completed: false }); editor.dirty = true; editor.sequence++; renderSteps(); renderState(); $('te-steps').lastElementChild?.querySelector('input[type=text]')?.focus(); } });
  $('te-close').addEventListener('click', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('te-check').addEventListener('click', check);
  $('te-use-server').addEventListener('click', () => {
    if (!editor?.remote || busy || !confirm('采用服务端版本会替换当前编辑区的文字，确定继续？')) return;
    if (editor.action) pending.delete(editor.base.id);
    editor.base = editor.remote; editor.review = false; editor.remote = null; editor.action = null; editor.deleted = false;
    $('te-server').textContent = ''; fill(editor.base); updateBanner(); status('已采用服务端版本，尚未发送新的修改。'); changed();
  });
  $('te-keep-local').addEventListener('click', () => {
    if (!editor?.remote || busy || editor.action || !confirm('已看过最新内容，确定以当前文字继续编辑？下次保存会提交这些字段，并继续检查新版本。')) return;
    editor.base = editor.remote; editor.remote = null; editor.review = false; editor.dirty = true;
    if (editor.base.status === 'completed') $('te-myday').value = '';
    // A concurrently added step must not be adopted by silently matching text.
    const ids = new Set((editor.base.steps || []).map(s => s.id));
    editor.steps.forEach(s => { if (s.id && !ids.has(s.id)) s.id = ''; });
    renderState(); status('已保留当前文字。请检查分类、步骤和状态，再手动保存。');
  });
  $('te-finish-check').addEventListener('click', () => {
    if (!editor?.action || !editor.checked || busy) return;
    pending.delete(editor.base.id); updateBanner(); editor.action = null;
    if (editor.remote) { editor.base = editor.remote; editor.remote = null; editor.review = false; fill(editor.base); }
    status('本次核对已结束，没有再次发送原操作。'); changed(); renderState();
  });
  $('te-export').addEventListener('click', async () => {
    if (!editor || !current()) return;
    const value = formValue(), text = `# ${value.title || '待办修改'}\n\n> 当前编辑内容，未保证提交成功\n> 任务：${editor.base.id}\n> 版本：${C.version(editor.base)}\n\n分类：${value.list_id}\n优先级：${value.priority}\n截止：${value.due || '未设置'}\n我的一天：${value.my_day_date || '未加入'}\n重复：${value.repeat_rule}\n标签：${value.tags}\n\n${value.notes}\n\n${value.steps.map(s => `${s.completed ? '- [x]' : '- [ ]'} ${s.title}`).join('\n')}`;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' }), name = '待办修改-' + editor.base.id + '.md';
    try { if (window.DaynestMobile?.saveBlob) await window.DaynestMobile.saveBlob(blob, name, owner.token);
      else { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { status(error.message); }
  });
  banner.addEventListener('click', () => { const next = [...pending.values()].find(p => H.current(p.context) && p.state !== 'sending'); if (next) open(next.todo.id, next); });
  document.addEventListener('click', event => { const button = event.target.closest('[data-todo-edit]'); if (button) open(button.dataset.todoEdit); });
  document.addEventListener('daynest:account-leaving', () => { clear(); pending.clear(); updateBanner(); });
  document.addEventListener('daynest:account-ready', () => { if (owner && !current()) clear(); for (const [id, p] of pending) if (!H.current(p.context)) pending.delete(id); updateBanner(); });
  document.addEventListener('daynest:auth-expired', () => { if (editor) status('登录已过期，当前文字仍在；可先导出，再重新登录。'); });
  window.addEventListener('storage', event => { if ((!event.key || event.key === 'studyflow.token') && owner && !current()) { clear(); pending.clear(); updateBanner(); } });
  window.DaynestUI?.registerGuard('todo-editor', () => !!editor?.dirty || busy || pending.size > 0);
  window.DaynestTodoDrafts?.connect({
    read, notice: text => { $('te-draft-status').textContent = text; },
    async restore(record) {
      const context = H.capture();
      if (record.base.user_id !== context.userID || !await open(record.base.id) || !current()) return false;
      const remote = editor.base;
      editor.base = record.base;
      const value = { ...record.value, steps: record.value.steps.map(step => ({ ...step })) };
      if (record.baseDue !== undefined && value.due === record.baseDue) value.due = C.localTime(record.base.due_at);
      applyFields(value);
      editor.remote = remote; editor.review = true; editor.dirty = true;
      $('te-server').textContent = C.describe(remote);
      renderState(); status('草稿已恢复，请对照服务端内容，再选择保留当前文字或采用服务端版本。');
      return true;
    }
  });
  window.DaynestTodos = { open, action, read, list: path => H.json(path), lists: () => H.json('/api/v1/todo-lists') };
})();
