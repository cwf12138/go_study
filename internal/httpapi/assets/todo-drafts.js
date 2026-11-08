(() => {
  'use strict';
  const core = window.DaynestTodoDraftCore;
  const trigger = document.createElement('button');
  trigger.id = 'todo-drafts-open'; trigger.type = 'button'; trigger.className = 'quiet'; trigger.textContent = '本机编辑草稿';
  document.getElementById('todo-local-open').before(trigger);
  const dialog = document.createElement('dialog');
  dialog.id = 'todo-drafts-dialog'; dialog.className = 'todo-drafts-dialog'; dialog.setAttribute('aria-labelledby', 'td-title');
  dialog.innerHTML = `<header><div><p>留住未完成的事</p><h2 id="td-title">待办编辑草稿</h2></div><button id="td-close" type="button" aria-label="关闭草稿">×</button></header>
    <div class="td-body"><p>编辑时自动保留本机副本。选择草稿后可对照原任务，恢复后手动保存。</p>
    <label><input id="td-enabled" type="checkbox"> 在此设备保留待办编辑草稿</label>
    <p id="td-status" role="status" aria-live="polite"></p><div class="td-layout"><nav id="td-list" aria-label="草稿列表"></nav>
    <section id="td-preview" hidden><h3 id="td-heading"></h3><label>本机内容<textarea id="td-local" readonly rows="8"></textarea></label>
    <label>当前服务端内容<textarea id="td-remote" readonly rows="8"></textarea></label>
    <div class="td-actions"><button id="td-restore" type="button">恢复并核对</button><button id="td-export" type="button">导出文字</button><button id="td-delete" type="button">删除此副本</button></div></section></div>
    <p class="td-foot">副本以明文保存在当前浏览器或 App，按账号和服务隔离。服务接收后的副本也会保留，确认后可手动清理。</p><button id="td-clear" type="button">清理本账号待办副本</button></div>`;
  document.body.append(dialog);
  const element = id => document.getElementById('td-' + id);
  let hooks, account = '', storage = null, active = null, selected = null, generation = 0, turn = 0, loading = false;
  function sync() {
    const identity = window.DaynestAccount?.current?.();
    const next = identity ? core.scope(identity.server, identity.userID) : '';
    if (account !== next) {
      account = next; turn++; active = selected = null; storage = null; loading = false;
      element('local').value = element('remote').value = ''; element('heading').textContent = ''; message(''); element('list').replaceChildren(); element('preview').hidden = true;
      dialog.close();
      if (account) storage = core.create(localStorage, account);
    }
    return storage;
  }
  function message(text) { element('status').textContent = text; }
  function render() {
    try {
      const store = sync(); trigger.disabled = !store;
      const result = store?.list() || { records: [], damaged: 0 };
      trigger.textContent = '本机编辑草稿' + (result.records.length ? ` · ${result.records.length}` : '');
      element('enabled').checked = !!store?.enabled(); element('list').replaceChildren();
      for (const record of result.records) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = `${record.value.title || '未命名待办'}\n${new Date(record.savedAt).toLocaleString('zh-CN')}${record.submitted ? ' · 已提交副本' : ''}`;
        button.setAttribute('aria-current', String(selected?.id === record.id));
        button.addEventListener('click', () => preview(record)); element('list').append(button);
      }
      if (result.damaged) message('部分本机副本无法读取，请保留设备数据并导出可读内容。');
      else if (!result.records.length) message('还没有待办编辑草稿。');
    } catch (error) { message('本机存储不可用，请在编辑器中导出当前文字。'); }
  }
  function capture(base, value, submitted = false) {
    try {
      const store = sync(); if (!store?.enabled()) { hooks?.notice('本机草稿保留已关闭，当前文字可在编辑器导出。'); return; }
      if (!active || active.base?.id !== base.id) active = { id: core.writerID() };
      const record = { version: 1, id: active.id, generation: ++generation, savedAt: Date.now(), base,
        baseDue: window.DaynestTodoEditorCore.localTime(base.due_at), value, submitted };
      store.put(record); active = record; render(); hooks?.notice(submitted ? '服务已接收，本机副本继续保留。' : '本机草稿已保留。'); return record;
    } catch (error) {
      hooks?.notice('本机草稿未能保存，请先导出当前文字。' + error.message);
    }
  }
  async function preview(record) {
    const store = sync(); if (!store) return;
    selected = record; const currentTurn = ++turn;
    render();
    element('preview').hidden = false; element('heading').textContent = record.value.title || '未命名待办';
    element('local').value = core.readable(record); element('remote').value = '';
    element('restore').disabled = true; loading = true; message('正在读取原任务进行对照。');
    try {
      const remote = await hooks.read(record.base.id);
      if (currentTurn !== turn || store !== sync()) return;
      element('remote').value = window.DaynestTodoEditorCore.describe(remote);
      element('restore').disabled = false;
      message('可以恢复到编辑区，并核对服务端版本。');
    } catch (error) {
      if (currentTurn === turn && store === sync()) message(error.status === 404 ? '原任务已删除，副本可导出或清理。' : '暂时无法读取原任务，本机内容仍可导出。');
    } finally { if (currentTurn === turn) loading = false; }
  }
  trigger.addEventListener('click', () => { render(); if (!dialog.open) dialog.showModal(); });
  element('close').addEventListener('click', () => { turn++; dialog.close(); trigger.focus(); });
  dialog.addEventListener('cancel', () => { turn++; });
  element('enabled').addEventListener('change', () => {
    try { sync()?.setEnabled(element('enabled').checked); message(element('enabled').checked ? '已开启本机保留。' : '已停止新增副本，已有副本可逐项清理。'); }
    catch (error) { message('设置未能保存。'); render(); }
  });
  element('delete').addEventListener('click', () => {
    if (!selected || !confirm('确定删除这份本机副本？')) return;
    try { sync()?.remove(selected); turn++; selected = null; element('local').value = element('remote').value = ''; element('heading').textContent = ''; element('preview').hidden = true; render(); }
    catch (error) { message('副本未能删除，请稍后再试。'); }
  });
  element('clear').addEventListener('click', () => {
    if (!confirm('确定清理当前账号在此服务下的全部待办编辑副本？请先导出需要的内容。')) return;
    try {
      sync()?.clear(); turn++; selected = active = null; loading = false;
      element('local').value = element('remote').value = ''; element('heading').textContent = ''; element('preview').hidden = true;
      render(); message('本账号待办副本已清理。');
    } catch (error) { message('清理失败，请稍后重试。'); }
  });
  element('restore').addEventListener('click', async () => {
    if (!selected || loading || element('restore').disabled) return;
    const record = selected, store = sync(), currentTurn = ++turn;
    loading = true; element('restore').disabled = true;
    try {
      const restored = await hooks.restore(record);
      if (currentTurn !== turn || store !== sync()) return;
      if (restored) { active = null; dialog.close(); }
      else message('请先处理编辑区的未提交内容。');
    } catch (error) { if (currentTurn === turn) message('恢复失败，本机副本仍在。'); }
    finally { if (currentTurn === turn) { loading = false; element('restore').disabled = false; } }
  });
  element('export').addEventListener('click', async () => {
    if (!selected) return;
    const context = window.DaynestHTTP.capture();
    const blob = new Blob([core.readable(selected)], { type: 'text/plain;charset=utf-8' });
    try {
      if (window.DaynestMobile?.saveBlob) await window.DaynestMobile.saveBlob(blob, '待办草稿.txt', context.token);
      else { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = '待办草稿.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { message('导出失败，请重试。'); }
  });
  document.addEventListener('daynest:account-ready', render);
  document.addEventListener('daynest:account-leaving', () => { turn++; account = ''; storage = null; active = selected = null; dialog.close(); element('local').value = element('remote').value = ''; element('heading').textContent = ''; message(''); element('list').replaceChildren(); });
  window.addEventListener('storage', () => { render(); });
  window.DaynestTodoDrafts = { capture, begin() { active = null; }, connect(value) { hooks = value; render(); } };
})();
