import { clockMinute, createCommuteStore, dayKey, durations, formatMinute, stages, summarize, validDay } from './mobile-commute-core.js';

export function installMobileCommute() {
  document.addEventListener('DOMContentLoaded', () => {
    const shortcuts = document.querySelector('#panel-dashboard .today-shortcuts');
    if (!shortcuts) return;
    const store = createCommuteStore(window.indexedDB);
    const entry = document.createElement('button');
    entry.id = 'commute-open';
    entry.className = 'commute-entry';
    entry.type = 'button';
    entry.setAttribute('aria-haspopup', 'dialog');
    entry.setAttribute('aria-controls', 'commute-dialog');
    entry.innerHTML = '<span aria-hidden="true">◷</span><strong>通勤打卡</strong><span aria-hidden="true">›</span>';
    shortcuts.after(entry);

    const dialog = document.createElement('dialog');
    dialog.id = 'commute-dialog';
    dialog.className = 'commute-dialog';
    dialog.setAttribute('aria-labelledby', 'commute-title');
    dialog.innerHTML = `
      <header><h2 id="commute-title">通勤打卡</h2><button type="button" data-close aria-label="关闭通勤打卡">×</button></header>
      <div class="commute-body">
        <div class="commute-date">
          <button type="button" data-direction="-1" aria-label="前一天">‹</button>
          <label><span class="product-sr-only">记录日期</span><input type="date" data-date aria-label="记录日期"></label>
          <button type="button" data-direction="1" aria-label="后一天">›</button>
          <button type="button" data-today>今天</button>
        </div>
        <button type="button" class="commute-previous" data-continue hidden>继续记录昨天</button>
        <div class="commute-tiles">${stages.map(({ key, label }) => `<button type="button" data-stamp="${key}"><span>${label}</span><strong>—</strong><small>点一下记录</small></button>`).join('')}</div>
        <p class="commute-duration" data-duration hidden></p>
        <form class="commute-editor" data-editor hidden>
          <h3 data-edit-heading></h3>
          <div class="commute-edit-fields">
            <label>时间<input name="clock" type="time" required></label>
            <label>日期<select name="offset"><option value="0">当天</option><option value="1440">次日</option></select></label>
          </div>
          <div class="commute-actions">
            <button class="primary" type="submit">保存时间</button>
            <button type="button" class="quiet" data-cancel>取消</button>
            <button type="button" class="text-button" data-remove hidden>清除时间</button>
          </div>
        </form>
        <p class="commute-status" data-status role="status" aria-live="polite"></p>
        <details class="commute-summary">
          <summary>统计与历史</summary>
          <div class="commute-ranges" role="group" aria-label="统计时间范围">
            <button type="button" data-span="7" aria-pressed="true">近 7 天</button>
            <button type="button" data-span="30" aria-pressed="false">近 30 天</button>
          </div>
          <p data-sample></p>
          <dl class="commute-averages" data-average></dl>
          <div class="commute-history" data-history></div>
        </details>
        <p class="commute-storage">记录保存在当前手机。</p>
      </div>`;
    document.body.append(dialog);

    const $ = selector => dialog.querySelector(selector);
    const body = $('.commute-body'), date = $('[data-date]'), editor = $('[data-editor]');
    const status = $('[data-status]'), note = $('[data-duration]');
    const tiles = [...dialog.querySelectorAll('[data-stamp]')];
    const { clock, offset } = editor.elements;
    let owner, selected, editing, stamps = {}, recent = [], span = 7;
    let loading = false, saving = false, turn = 0, loaded = false;

    function currentAccount() {
      const account = window.DaynestAccount?.current?.();
      if (!account || window.DaynestHTTP?.authExpired?.()) return null;
      return { scope: JSON.stringify([account.server, account.userID]), session: account.sessionID };
    }
    function current(snapshot) {
      const active = currentAccount();
      return dialog.open && owner === snapshot && active?.scope === snapshot.scope && active.session === snapshot.session;
    }
    function say(message, failed = false) {
      status.textContent = message;
      status.dataset.error = String(failed);
    }
    function durationText(value) {
      const hours = Math.floor(value / 60), minutes = value % 60;
      return hours ? `${hours} 小时${minutes ? ' ' + minutes + ' 分钟' : ''}` : `${minutes} 分钟`;
    }
    function paint() {
      const now = new Date(), today = dayKey(now), yesterday = dayKey(now, -1);
      const busy = loading || saving;
      date.max = today;
      date.value = selected;
      date.disabled = saving;
      $('[data-direction="-1"]').disabled = saving;
      $('[data-direction="1"]').disabled = saving || selected >= today;
      $('[data-today]').disabled = saving || selected === today;
      const last = recent.find(row => row.day === yesterday)?.stamps;
      $('[data-continue]').hidden = selected !== today || !last || last.home != null;
      $('[data-continue]').disabled = busy;
      for (const tile of tiles) {
        const value = stamps[tile.dataset.stamp];
        tile.disabled = busy || !loaded;
        tile.dataset.recorded = String(value != null);
        tile.querySelector('strong').textContent = formatMinute(value);
        tile.querySelector('small').textContent = value != null ? '点按修改' : clockMinute(selected, now) === null ? '补录时间' : '点按记录';
      }
      const available = durations(stamps).filter(item => item.minutes !== null);
      note.hidden = !available.length;
      note.textContent = available.map(item => `${item.label} ${durationText(item.minutes)}`).join(' · ');
      clock.disabled = offset.disabled = saving;
      editor.querySelectorAll('button').forEach(button => button.disabled = saving);
      for (const button of dialog.querySelectorAll('[data-span]')) button.setAttribute('aria-pressed', String(Number(button.dataset.span) === span));
    }
    function paintStats() {
      const since = dayKey(new Date(), 1 - span), rows = recent.filter(row => row.day >= since);
      $('[data-sample]').textContent = rows.length ? `${rows.length} 天有记录 · 平均时间` : '这段时间还没有通勤记录。';
      const average = $('[data-average]'), history = $('[data-history]');
      average.replaceChildren();
      history.replaceChildren();
      if (!rows.length) return;
      for (const row of summarize(rows)) {
        const item = document.createElement('div'), label = document.createElement('dt'), value = document.createElement('dd');
        label.textContent = row.label;
        value.textContent = formatMinute(row.average);
        if (row.count) value.title = `${row.count} 次记录`;
        item.append(label, value);
        average.append(item);
      }
      for (const row of rows.slice().reverse()) {
        const item = document.createElement('button'), label = document.createElement('strong'), times = document.createElement('small');
        item.type = 'button';
        label.textContent = row.day;
        times.textContent = stages.filter(stage => row.stamps[stage.key] != null)
          .map(stage => `${stage.label} ${formatMinute(row.stamps[stage.key])}`).join(' · ');
        item.append(label, times);
        item.addEventListener('click', () => { if (!saving) { load(row.day); body.scrollTop = 0; } });
        history.append(item);
      }
    }
    function closeEditor() {
      editing = null;
      editor.hidden = true;
    }
    function edit(key, value = stamps[key] ?? clockMinute(selected, new Date())) {
      editing = key;
      $('[data-edit-heading]').textContent = `修改${stages.find(stage => stage.key === key).label}时间`;
      clock.value = value == null ? '' : formatMinute(value % 1440);
      offset.value = value >= 1440 ? '1440' : '0';
      $('[data-remove]').hidden = stamps[key] == null;
      editor.hidden = false;
      editor.scrollIntoView({ block: 'nearest' });
    }
    async function load(day) {
      if (!owner || !current(owner) || saving || !validDay(day) || day > dayKey(new Date())) return;
      const snapshot = owner, request = ++turn;
      selected = day;
      stamps = {};
      loading = true;
      loaded = false;
      closeEditor();
      say('正在读取记录…');
      paint();
      try {
        const now = new Date();
        const [row, history] = await Promise.all([
          store.read(snapshot.scope, day), store.between(snapshot.scope, dayKey(now, -29), dayKey(now)),
        ]);
        if (!current(snapshot) || request !== turn) return;
        stamps = row;
        recent = history;
        loaded = true;
        say('');
      } catch (_) {
        if (current(snapshot) && request === turn) say('读取本机记录失败，换个日期或重新打开再试。', true);
      } finally {
        if (current(snapshot) && request === turn) {
          loading = false;
          paint();
          paintStats();
        }
      }
    }
    async function save(key, value, quick = false) {
      if (!owner || !current(owner) || saving || !loaded) return;
      const snapshot = owner, day = selected, now = new Date(), today = dayKey(now);
      const max = clockMinute(day, now);
      if (value !== null && max !== null && value > max) {
        say('请选择当前或过去的时间。', true);
        return;
      }
      saving = true;
      paint();
      try {
        const next = await store.write(snapshot.scope, day, key, value, stamps[key] ?? null);
        if (!current(snapshot)) return;
        stamps = next;
        recent = recent.filter(row => row.day !== day);
        if (day >= dayKey(now, -29) && day <= today && Object.keys(next).length) {
          recent.push({ day, stamps: next });
          recent.sort((a, b) => a.day.localeCompare(b.day));
        }
        closeEditor();
        const label = stages.find(stage => stage.key === key).label;
        say(value === null ? `已清除${label}时间。` : `已记录${label} ${formatMinute(value)}。`);
        paintStats();
      } catch (error) {
        if (!current(snapshot)) return;
        say(error.message || '写入本机失败，请重试。', true);
        if (quick) edit(key, value);
      } finally {
        if (current(snapshot)) { saving = false; paint(); }
      }
    }

    entry.addEventListener('click', () => {
      if (dialog.open) return;
      owner = currentAccount();
      if (!owner) { window.DaynestUI?.notify('请先登录，再打开通勤打卡。', 'error'); return; }
      recent = [];
      loading = saving = false;
      dialog.showModal();
      body.scrollTop = 0;
      paintStats();
      load(dayKey(new Date()));
    });
    $('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      owner = null;
      turn++;
      closeEditor();
      stamps = {};
      recent = [];
      paintStats();
    });
    for (const type of ['daynest:account-leaving', 'daynest:auth-expired']) {
      document.addEventListener(type, () => { if (dialog.open) dialog.close(); });
    }
    date.addEventListener('change', () => {
      if (validDay(date.value) && date.value <= date.max) load(date.value);
      else date.value = selected;
    });
    for (const button of dialog.querySelectorAll('[data-direction]')) {
      button.addEventListener('click', () => load(dayKey(new Date(selected + 'T12:00:00'), Number(button.dataset.direction))));
    }
    $('[data-today]').addEventListener('click', () => load(dayKey(new Date())));
    $('[data-continue]').addEventListener('click', () => load(dayKey(new Date(), -1)));
    for (const tile of tiles) tile.addEventListener('click', () => {
      const key = tile.dataset.stamp, value = clockMinute(selected, new Date());
      if (stamps[key] != null || value === null) edit(key);
      else save(key, value, true);
    });
    editor.addEventListener('submit', event => {
      event.preventDefault();
      if (!editing || !editor.reportValidity()) return;
      const [hour, minute] = clock.value.split(':').map(Number);
      save(editing, Number(offset.value) + hour * 60 + minute);
    });
    $('[data-cancel]').addEventListener('click', closeEditor);
    $('[data-remove]').addEventListener('click', () => {
      if (editing && window.confirm('要清除这个时间吗？')) save(editing, null);
    });
    for (const button of dialog.querySelectorAll('[data-span]')) button.addEventListener('click', () => {
      span = Number(button.dataset.span);
      paint();
      paintStats();
    });
  }, { once: true });
}
