(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('panel-travel');
  if (!panel) return;
  const categories = { sight: '游览', food: '餐饮', transport: '交通', stay: '住宿', other: '其他' };
  const packCategories = { essentials: '证件与必需品', clothes: '衣物', electronics: '数码', care: '洗护', other: '其他' };
  const state = { owner: '', epoch: 0, items: [], selected: '', date: '', tab: 'route', loaded: false,
    busy: false, pending: null, dirty: false, editing: null, stopID: '', drag: '' };
  const controllers = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => '¥' + (value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const current = () => state.items.find(p => p.id === state.selected);
  const locked = () => state.busy || !!state.pending;
  const status = text => { $('travel-status').textContent = text; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // Calendar dates are destination-local, never converted through the browser's time zone.
  function dayNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('请选择有效日期。');
    const time = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > '2100-12-31') throw Error('日期须在 2000–2100 年内。');
    return time / 86400000;
  }
  function daysOf(start, end) {
    const a = dayNumber(start), b = dayNumber(end);
    if (b < a || b - a > 30) throw Error('请选择连续 1–31 天的旅行日期。');
    return Array.from({ length: b - a + 1 }, (_, i) => new Date((a + i) * 86400000).toISOString().slice(0, 10));
  }
  function cents(value) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw Error('金额须为非负数，最多两位小数。');
    const [whole, decimal = ''] = String(value).split('.');
    const result = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
    if (!Number.isSafeInteger(result) || result > 100000000) throw Error('单项金额不能超过 100 万元。');
    return result;
  }
  function totals(p) {
    return p.stops.reduce((sum, s) => ({ estimated: sum.estimated + s.estimated_cents, spent: sum.spent + s.spent_cents }), { estimated: 0, spent: 0 });
  }
  function overlaps(stops) {
    const timed = stops.filter(s => s.time).map(s => ({ ...s, at: Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3)) })).sort((a, b) => a.at - b.at);
    const pairs = [];
    timed.forEach((a, i) => timed.slice(i + 1).forEach(b => { if (b.at < a.at + a.minutes) pairs.push([a.title, b.title]); }));
    return pairs;
  }
  function bodyOf(p) {
    return clone({ title: p.title, destination: p.destination, start_date: p.start_date, end_date: p.end_date,
      notes: p.notes, budget_cents: p.budget_cents, archived: p.archived, stops: p.stops, packing: p.packing, revision: p.revision || 0 });
  }
  function validPlan(p) {
    const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v);
    const amount = v => Number.isSafeInteger(v) && v >= 0 && v <= 100000000;
    if (!p || !id(p.id) || typeof p.title !== 'string' || typeof p.destination !== 'string' || typeof p.notes !== 'string'
      || typeof p.archived !== 'boolean' || !amount(p.budget_cents) || !Number.isInteger(p.revision) || p.revision < 1
      || !Array.isArray(p.stops) || !Array.isArray(p.packing) || p.stops.length > 200 || p.packing.length > 100) return false;
    try {
      const days = daysOf(p.start_date, p.end_date), ids = new Set();
      const unique = key => { if (!id(key) || ids.has(key)) return false; ids.add(key); return true; };
      return p.stops.every(s => s && unique(s.id) && days.includes(s.date) && typeof s.title === 'string'
        && typeof s.location === 'string' && typeof s.notes === 'string' && typeof s.done === 'boolean'
        && Object.hasOwn(categories, s.category) && Number.isInteger(s.minutes) && s.minutes >= 1 && s.minutes <= 1440
        && typeof s.time === 'string' && (s.time === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))
        && amount(s.estimated_cents) && amount(s.spent_cents))
        && p.packing.every(v => v && unique(v.id) && typeof v.title === 'string' && Object.hasOwn(packCategories, v.category)
          && typeof v.packed === 'boolean' && Number.isInteger(v.quantity) && v.quantity >= 1 && v.quantity <= 99);
    } catch { return false; }
  }
  function sync() {
    const owner = localStorage.getItem('studyflow.token') || '';
    if (owner === state.owner) return;
    controllers.forEach(c => c.abort());
    state.epoch++;
    Object.assign(state, { owner, items: [], selected: '', date: '', tab: 'route', loaded: false, busy: false, pending: null, dirty: false, editing: null, stopID: '', drag: '' });
    ['travel-dialog', 'travel-stop-dialog'].forEach(id => { if ($(id).open) $(id).close(); });
    ['travel-form', 'travel-stop-form', 'travel-pack-form'].forEach(id => $(id).reset());
    $('travel-search').value = '';
    $('travel-filter').value = 'active';
    status('等待加载当前账号的旅行。');
    render();
  }
  async function request(path = '', body) {
    const owner = state.owner, epoch = state.epoch;
    if (!owner || owner !== localStorage.getItem('studyflow.token')) { sync(); throw Error('请重新登录。'); }
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/v1/travel-plans' + path, { method: body ? 'PUT' : 'GET',
        headers: { Authorization: 'Bearer ' + owner, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
      const payload = await response.json();
      if (epoch !== state.epoch || owner !== localStorage.getItem('studyflow.token')) { sync(); throw Error('账号已切换。'); }
      if (!response.ok) {
        const error = Error(payload.error?.message || (response.status === 404 ? '接口不存在，请重启更新后的 Go 服务。' : `请求失败 (${response.status})`));
        error.httpStatus = response.status;
        throw error;
      }
      return payload.data;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function load() {
    sync();
    if (locked() || state.dirty) { status('请先保存或取消正在编辑的内容。'); return; }
    if (!state.owner) return;
    state.busy = true;
    const epoch = state.epoch;
    render();
    status('正在加载旅行档案…');
    try {
      const items = await request();
      if (!Array.isArray(items) || !items.every(validPlan)) throw Error('服务返回的旅行数据格式不正确。');
      state.items = items;
      state.loaded = true;
      status('已同步。你的下一程，从这里开始。');
    } catch (error) { if (epoch === state.epoch) status('加载失败：' + error.message + ' 可点击刷新重试。'); }
    finally { if (epoch === state.epoch) { state.busy = false; render(); } }
  }
  async function persist(plan, dialogID = '') {
    const owner = state.owner;
    sync();
    if (owner !== state.owner || state.busy || !state.owner || !state.loaded) return false;
    const operation = state.pending || { id: plan.id, body: bodyOf(plan), dialogID };
    state.pending = operation;
    state.busy = true;
    const epoch = state.epoch;
    render();
    status('正在保存旅行…');
    let saved = false;
    try {
      const item = await request('/' + encodeURIComponent(operation.id), operation.body);
      if (!validPlan(item) || item.id !== operation.id) throw Error('保存响应不完整，请重试核对。');
      state.items = [item, ...state.items.filter(p => p.id !== item.id)];
      state.selected = item.id;
      state.pending = null;
      state.dirty = false;
      $('travel-filter').value = item.archived ? 'archived' : 'active';
      $('travel-search').value = '';
      if (operation.dialogID) $(operation.dialogID).close();
      status('已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      saved = true;
    } catch (error) {
      if (epoch === state.epoch) {
        if (error.httpStatus === 400 || error.httpStatus === 422) {
          state.pending = null;
          status(error.message);
        } else {
          status(error.httpStatus === 409 ? '保存冲突：另一页面已修改此旅行。本地草稿已保留，请导出后重新载入。' : '保存未确认：' + error.message + ' 草稿保留在本页，请重试或导出。');
          if (operation.dialogID) $(operation.dialogID).close();
        }
        if (operation.dialogID) $(operation.dialogID === 'travel-dialog' ? 'travel-form-status' : 'travel-stop-form-status').textContent = $('travel-status').textContent;
      }
    } finally { if (epoch === state.epoch) { state.busy = false; render(); } }
    return saved;
  }
  function render() {
    const dayScroll = $('travel-days').scrollLeft, listScroll = $('travel-list').scrollLeft;
    const query = $('travel-search').value.trim().toLowerCase();
    const items = state.items.filter(p => p.archived === ($('travel-filter').value === 'archived') && (!query || (p.title + ' ' + p.destination).toLowerCase().includes(query)));
    if (!items.some(p => p.id === state.selected)) state.selected = items[0]?.id || '';
    const p = current(), disabled = locked() || !p || p.archived;
    $('travel-list').innerHTML = items.map((v, i) => `<button type="button" class="travel-library-card" data-trip="${esc(v.id)}" aria-pressed="${v.id === state.selected}" ${locked() ? 'disabled' : ''}><span class="travel-library-index">${String(i + 1).padStart(2, '0')} / JOURNEY</span><strong>${esc(v.title)}</strong><span>${esc(v.destination)}</span><small>${esc(v.start_date)} → ${esc(v.end_date.slice(5))}</small></button>`).join('') || `<p class="travel-placeholder">${state.loaded ? '还没有符合条件的旅行。' : state.busy ? '正在载入…' : '尚未加载，点击上方刷新。'}</p>`;
    $('travel-list').scrollLeft = listScroll;
    $('travel-empty').classList.toggle('hidden', !!p);
    $('travel-content').classList.toggle('hidden', !p);
    $('travel-recovery').classList.toggle('hidden', !state.pending);
    ['new', 'start', 'filter', 'search'].forEach(id => { $('travel-' + id).disabled = locked() || !state.loaded; });
    $('travel-refresh').disabled = locked();
    ['retry', 'reconcile', 'draft-export'].forEach(id => { $('travel-' + id).disabled = state.busy; });
    ['travel-fields', 'travel-stop-fields', 'travel-save', 'travel-stop-save'].forEach(id => { $(id).disabled = locked(); });
    ['edit', 'stop-new', 'sort-time', 'pack-template', 'pack-fields'].forEach(id => { $('travel-' + id).disabled = disabled; });
    $('travel-archive').disabled = locked();
    if (!p) return;
    const days = daysOf(p.start_date, p.end_date), sum = totals(p);
    if (!days.includes(state.date)) state.date = days[0];
    const delta = dayNumber(p.start_date) - dayNumber(today());
    $('travel-countdown').textContent = p.archived ? '已归档 · 随时重温' : delta > 0 ? `距离出发还有 ${delta} 天 · 按本机日期` : today() <= p.end_date ? '旅途中 · 好好感受每一站' : '旅行已结束 · 把回忆好好收下';
    $('travel-title').textContent = p.title;
    $('travel-meta').textContent = `${p.destination} / ${p.start_date} — ${p.end_date} / ${days.length} 天`;
    $('travel-stop-count').textContent = `${p.stops.filter(s => s.done).length} / ${p.stops.length}`;
    $('travel-pack-count').textContent = `${p.packing.filter(s => s.packed).length} / ${p.packing.length}`;
    $('travel-estimated').textContent = money(sum.estimated);
    $('travel-spent').textContent = money(sum.spent);
    $('travel-archive').textContent = p.archived ? '恢复旅行' : '归档';
    $('travel-notes-text').textContent = p.notes || '还没有备忘。出发前的提醒、住宿信息，都可以写在这里。';
    $('travel-days').innerHTML = days.map((d, i) => `<button type="button" data-day="${d}" aria-pressed="${d === state.date}"><span>DAY ${String(i + 1).padStart(2, '0')}</span><strong>${d.slice(5).replace('-', '/')}</strong><small>${p.stops.filter(s => s.date === d).length} 站</small></button>`).join('');
    $('travel-days').scrollLeft = dayScroll;
    $('travel-day-title').textContent = state.date + ' · ' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(state.date + 'T00:00:00Z').getUTCDay()];
    const stops = p.stops.filter(s => s.date === state.date), conflicts = overlaps(stops);
    $('travel-overlaps').classList.toggle('hidden', !conflicts.length);
    $('travel-overlaps').textContent = conflicts.length ? `有 ${conflicts.length} 处时间重叠：${conflicts.slice(0, 3).map(pair => pair.join(' / ')).join('；')}${conflicts.length > 3 ? '…' : ''}。如果是同时进行的安排，可以保留。` : '';
    $('travel-route').innerHTML = stops.map((s, i) => stopHTML(s, i, stops.length, disabled)).join('') || '<div class="travel-route-empty"><span aria-hidden="true">⌁</span><h4>给这一天，留一点期待。</h4><p>添加一个地点或一段安排。不必排满，留白也是旅行的一部分。</p></div>';
    $('travel-packing').innerHTML = Object.entries(packCategories).map(([key, label]) => {
      const rows = p.packing.filter(v => v.category === key);
      if (!rows.length) return '';
      return `<section class="travel-pack-group"><h4>${label}<span>${rows.filter(v => v.packed).length} / ${rows.length}</span></h4>${rows.map(v => `<div class="travel-pack-item ${v.packed ? 'is-done' : ''}"><label><input type="checkbox" data-pack-check="${esc(v.id)}" ${v.packed ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${esc(v.title)}</span></label><span>× ${v.quantity}</span><button type="button" class="quiet" data-pack-remove="${esc(v.id)}" aria-label="移除${esc(v.title)}" ${disabled ? 'disabled' : ''}>移除</button></div>`).join('')}</section>`;
    }).join('') || '<p class="travel-placeholder">清单还是空的。加入基础清单，或记录你自己的出行必需品。</p>';
    renderBudget(p, sum);
    renderTabs();
  }
  function stopHTML(s, i, count, disabled) {
    const off = disabled ? 'disabled' : '';
    return `<article class="travel-stop ${s.done ? 'is-done' : ''}" data-stop="${esc(s.id)}" draggable="${!disabled}"><div class="travel-stop-time"><strong>${esc(s.time || '自由安排')}</strong><span>${s.minutes} 分钟</span><i aria-hidden="true"></i></div><div class="travel-stop-card"><header><span class="travel-category">${categories[s.category] || '其他'}</span><span class="travel-stop-order">STOP ${String(i + 1).padStart(2, '0')}</span></header><h4>${esc(s.title)}</h4>${s.location ? `<p class="travel-location">⌖ ${esc(s.location)}</p>` : ''}${s.notes ? `<p class="travel-stop-note">${esc(s.notes)}</p>` : ''}<div class="travel-stop-cost"><span>预计 ${money(s.estimated_cents)}</span><span>已记 ${money(s.spent_cents)}</span></div><footer><label><input type="checkbox" data-stop-check="${esc(s.id)}" ${s.done ? 'checked' : ''} ${off}>${s.done ? '已留下足迹' : '完成这一站'}</label><div><button type="button" class="quiet" data-stop-up="${esc(s.id)}" aria-label="上移${esc(s.title)}" ${disabled || i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="quiet" data-stop-down="${esc(s.id)}" aria-label="下移${esc(s.title)}" ${disabled || i === count - 1 ? 'disabled' : ''}>↓</button><button type="button" class="quiet" data-stop-edit="${esc(s.id)}" ${off}>编辑</button><button type="button" class="quiet" data-stop-remove="${esc(s.id)}" ${off}>移除</button></div></footer></div></article>`;
  }
  function renderBudget(p, sum) {
    $('travel-budget-limit').textContent = p.budget_cents ? money(p.budget_cents) : '未设置预算';
    $('travel-budget-caption').textContent = '预计 ' + money(sum.estimated) + (p.budget_cents && sum.estimated > p.budget_cents ? ' · 预计超出预算' : '');
    $('travel-budget-progress').value = p.budget_cents ? Math.min(100, sum.spent / p.budget_cents * 100) : 0;
    $('travel-budget-remaining').textContent = p.budget_cents ? (sum.spent > p.budget_cents ? '已超出 ' + money(sum.spent - p.budget_cents) : '尚余 ' + money(p.budget_cents - sum.spent)) : '在“编辑旅行”中设置预算，开启对比。';
    $('travel-budget-remaining').classList.toggle('is-over', !!p.budget_cents && sum.spent > p.budget_cents);
    $('travel-budget-categories').innerHTML = Object.entries(categories).map(([key, label]) => {
      const t = totals({ stops: p.stops.filter(s => s.category === key) });
      const percent = sum.spent ? t.spent / sum.spent * 100 : 0;
      return `<div class="travel-budget-category"><span>${label}</span><div><strong>${money(t.spent)}</strong><span class="travel-cost-bar"><i style="width:${percent}%"></i></span></div><small>预计 ${money(t.estimated)}</small></div>`;
    }).join('');
    $('travel-budget-lines').innerHTML = '<h4>每一笔，心中有数。</h4>' + (p.stops.length ? `<div class="travel-table-scroll"><table><caption class="sr-only">行程费用明细，人民币</caption><thead><tr><th scope="col">日期 / 行程</th><th scope="col">预计</th><th scope="col">已记</th><th scope="col">差额（已记 − 预计）</th></tr></thead><tbody>${p.stops.map(s => `<tr><th scope="row"><small>${esc(s.date)}</small>${esc(s.title)}</th><td>${money(s.estimated_cents)}</td><td>${money(s.spent_cents)}</td><td>${s.spent_cents > s.estimated_cents ? '+' : ''}${money(s.spent_cents - s.estimated_cents)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="travel-placeholder">添加行程并填写费用后，会在这里自动汇总。</p>');
  }
  function renderTabs() {
    ['route', 'packing', 'budget'].forEach(tab => {
      const selected = tab === state.tab, button = $('travel-tab-' + tab);
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      $('travel-' + tab + '-view').classList.toggle('hidden', !selected);
    });
  }
  function editable() { sync(); return !locked() && state.loaded && current() && !current().archived; }
  async function mutate(fn) {
    if (!editable()) return false;
    const p = clone(current());
    try { if (fn(p) === false) return false; return await persist(p); }
    catch (error) { status(error.message); return false; }
  }
  function openTrip(edit = false) {
    sync();
    if (locked() || !state.loaded || (edit && !editable())) return;
    if (!edit && state.items.length >= 50) { status('每个账号最多 50 趟旅行（含归档）。'); return; }
    state.editing = edit ? clone(current()) : null;
    state.dirty = false;
    const p = state.editing;
    $('travel-form').reset();
    $('travel-name').value = p?.title || '';
    $('travel-destination').value = p?.destination || '';
    $('travel-start-date').value = p?.start_date || today();
    $('travel-end-date').value = p?.end_date || today();
    $('travel-budget-input').value = p ? (p.budget_cents / 100).toFixed(2) : '0';
    $('travel-note-input').value = p?.notes || '';
    $('travel-form-title').textContent = edit ? '编辑旅行' : '计划一场旅行';
    $('travel-form-status').textContent = '';
    $('travel-dialog').showModal(); $('travel-name').focus();
  }
  function openStop(id = '') {
    if (!editable()) return;
    const p = current(), s = p.stops.find(v => v.id === id);
    if (!s && p.stops.length >= 200) { status('每趟旅行最多 200 个行程。'); return; }
    state.stopID = id; state.dirty = false;
    $('travel-stop-form').reset();
    const fields = { name: s?.title || '', date: s?.date || state.date, category: s?.category || 'sight', time: s?.time || '', minutes: s?.minutes || 60,
      location: s?.location || '', estimated: ((s?.estimated_cents || 0) / 100).toFixed(2), spent: ((s?.spent_cents || 0) / 100).toFixed(2), notes: s?.notes || '' };
    Object.entries(fields).forEach(([key, value]) => { $('travel-stop-' + key).value = value; });
    $('travel-stop-date').min = p.start_date; $('travel-stop-date').max = p.end_date;
    $('travel-stop-form-title').textContent = s ? '编辑这一站' : '添加一站';
    $('travel-stop-form-status').textContent = '';
    $('travel-stop-dialog').showModal(); $('travel-stop-name').focus();
  }
  function closeDialog(id) {
    if (locked()) return;
    if (state.dirty && !window.confirm('放弃尚未保存的修改？')) return;
    $(id).close(); state.dirty = false;
  }
  $('travel-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (locked() || !$('travel-form').reportValidity()) return;
    try {
      const p = state.editing ? clone(state.editing) : { id: crypto.randomUUID(), revision: 0, stops: [], packing: [], archived: false };
      p.title = $('travel-name').value.trim(); p.destination = $('travel-destination').value.trim();
      p.start_date = $('travel-start-date').value; p.end_date = $('travel-end-date').value;
      p.budget_cents = cents($('travel-budget-input').value); p.notes = $('travel-note-input').value.trim();
      const days = daysOf(p.start_date, p.end_date);
      if (p.stops.some(s => !days.includes(s.date))) throw Error('部分行程在新日期范围外，请先调整这些行程。');
      await persist(p, 'travel-dialog');
    } catch (error) { $('travel-form-status').textContent = error.message; }
  });
  $('travel-stop-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!editable() || !$('travel-stop-form').reportValidity()) return;
    try {
      const p = clone(current()), old = p.stops.find(v => v.id === state.stopID);
      const s = { id: old?.id || crypto.randomUUID(), title: $('travel-stop-name').value.trim(), date: $('travel-stop-date').value,
        category: $('travel-stop-category').value, time: $('travel-stop-time').value, minutes: Number($('travel-stop-minutes').value),
        location: $('travel-stop-location').value.trim(), notes: $('travel-stop-notes').value.trim(),
        estimated_cents: cents($('travel-stop-estimated').value), spent_cents: cents($('travel-stop-spent').value), done: old?.done || false };
      if (!daysOf(p.start_date, p.end_date).includes(s.date)) throw Error('请选择旅行日期范围内的一天。');
      if (s.time && Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3)) + s.minutes > 1440) throw Error('跨日行程请分天记录。');
      p.stops = old ? p.stops.map(v => v.id === s.id ? s : v) : [...p.stops, s];
      if (await persist(p, 'travel-stop-dialog')) { state.date = s.date; render(); }
    } catch (error) { $('travel-stop-form-status').textContent = error.message; }
  });
  ['travel-form', 'travel-stop-form'].forEach(id => $(id).addEventListener('input', () => { state.dirty = true; }));
  document.querySelectorAll('[data-travel-close]').forEach(b => b.addEventListener('click', () => closeDialog(b.dataset.travelClose)));
  ['travel-dialog', 'travel-stop-dialog'].forEach(id => $(id).addEventListener('cancel', e => { e.preventDefault(); closeDialog(id); }));
  ['travel-new', 'travel-start'].forEach(id => $(id).addEventListener('click', () => openTrip()));
  $('travel-edit').addEventListener('click', () => openTrip(true));
  $('travel-stop-new').addEventListener('click', () => openStop());
  $('travel-refresh').addEventListener('click', load);
  $('travel-filter').addEventListener('change', render);
  $('travel-search').addEventListener('input', render);
  $('travel-list').addEventListener('click', e => {
    const b = e.target.closest('[data-trip]');
    if (b && !locked()) { state.selected = b.dataset.trip; state.date = ''; render(); }
  });
  $('travel-days').addEventListener('click', e => {
    const b = e.target.closest('[data-day]');
    if (b) { state.date = b.dataset.day; render(); $('travel-days').querySelector(`[data-day="${state.date}"]`)?.focus({ preventScroll: true }); }
  });
  document.querySelectorAll('[data-travel-tab]').forEach(b => {
    b.addEventListener('click', () => { state.tab = b.dataset.travelTab; renderTabs(); });
    b.addEventListener('keydown', e => {
      const tabs = ['route', 'packing', 'budget'], index = tabs.indexOf(state.tab);
      const next = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[e.key];
      if (next === undefined) return;
      e.preventDefault(); state.tab = tabs[next]; renderTabs(); $('travel-tab-' + state.tab).focus();
    });
  });
  $('travel-archive').addEventListener('click', async () => {
    sync();
    if (locked() || !current() || !window.confirm(current().archived ? '恢复这趟旅行？' : '归档这趟旅行？所有行程、费用与清单均会保留。')) return;
    const p = clone(current()); p.archived = !p.archived; await persist(p);
  });
  function moveStop(p, id, direction) {
    const s = p.stops.find(v => v.id === id);
    if (!s) return false;
    const sameDay = p.stops.filter(v => v.date === s.date), index = sameDay.findIndex(v => v.id === id), other = sameDay[index + direction];
    if (!other) return false;
    const a = p.stops.findIndex(v => v.id === id), b = p.stops.findIndex(v => v.id === other.id);
    [p.stops[a], p.stops[b]] = [p.stops[b], p.stops[a]];
  }
  $('travel-route').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.stopEdit) openStop(b.dataset.stopEdit);
    if (b.dataset.stopRemove && window.confirm('移除这一站及其费用记录？此操作保存后无法撤销。')) await mutate(p => { p.stops = p.stops.filter(s => s.id !== b.dataset.stopRemove); });
    const id = b.dataset.stopUp || b.dataset.stopDown;
    if (id) { await mutate(p => moveStop(p, id, b.dataset.stopUp ? -1 : 1)); $('travel-route').querySelector(`[data-stop-${b.dataset.stopUp ? 'up' : 'down'}="${id}"]`)?.focus({ preventScroll: true }); }
  });
  $('travel-route').addEventListener('change', async e => {
    const id = e.target.dataset.stopCheck, checked = e.target.checked;
    if (id) { await mutate(p => { const s = p.stops.find(v => v.id === id); if (s) s.done = checked; }); $('travel-route').querySelector(`[data-stop-check="${id}"]`)?.focus({ preventScroll: true }); }
  });
  $('travel-sort-time').addEventListener('click', () => mutate(p => {
    const day = p.stops.filter(v => v.date === state.date).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    let i = 0; p.stops = p.stops.map(v => v.date === state.date ? day[i++] : v);
  }));
  $('travel-route').addEventListener('dragstart', e => {
    const card = e.target.closest('[data-stop]');
    if (!editable() || !card || e.target.closest('button,input,label')) { e.preventDefault(); return; }
    state.drag = card.dataset.stop; e.dataTransfer.setData('text/plain', state.drag); e.dataTransfer.effectAllowed = 'move'; card.classList.add('is-dragging');
  });
  function clearDrag() { state.drag = ''; panel.querySelectorAll('.is-dragging,.is-drop-target').forEach(el => el.classList.remove('is-dragging', 'is-drop-target')); }
  ['travel-route', 'travel-days'].forEach(id => {
    $(id).addEventListener('dragover', e => {
      if (!state.drag || locked()) return;
      const target = e.target.closest('[data-stop],[data-day]');
      if (!target) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      panel.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target')); target.classList.add('is-drop-target');
    });
    $(id).addEventListener('drop', e => {
      const target = e.target.closest('[data-stop],[data-day]'), moving = state.drag;
      clearDrag(); if (!target || !moving) return; e.preventDefault();
      mutate(p => {
        const stop = p.stops.find(s => s.id === moving); if (!stop) return false;
        if (target.dataset.day) { if (stop.date === target.dataset.day) return false; stop.date = target.dataset.day; }
        else { const to = target.dataset.stop; if (moving === to) return false; p.stops = p.stops.filter(s => s.id !== moving); const index = p.stops.findIndex(s => s.id === to); if (index < 0) return false; p.stops.splice(index, 0, stop); }
      });
    });
  });
  $('travel-route').addEventListener('dragend', clearDrag);
  $('travel-pack-form').addEventListener('submit', async e => {
    e.preventDefault(); if (!$('travel-pack-form').reportValidity()) return;
    const title = $('travel-pack-name').value.trim(), quantity = Number($('travel-pack-quantity').value), category = $('travel-pack-category').value;
    if (!title) { status('请填写行李名称。'); return; }
    if (await mutate(p => { if (p.packing.length >= 100) throw Error('每趟旅行最多 100 个行李项。'); p.packing.push({ id: crypto.randomUUID(), title, quantity, category, packed: false }); })) {
      $('travel-pack-name').value = ''; $('travel-pack-quantity').value = '1'; $('travel-pack-name').focus();
    }
  });
  $('travel-packing').addEventListener('change', async e => {
    const id = e.target.dataset.packCheck, checked = e.target.checked;
    if (id) { await mutate(p => { const item = p.packing.find(v => v.id === id); if (item) item.packed = checked; }); $('travel-packing').querySelector(`[data-pack-check="${id}"]`)?.focus({ preventScroll: true }); }
  });
  $('travel-packing').addEventListener('click', e => {
    const b = e.target.closest('[data-pack-remove]');
    if (b && window.confirm('从行李清单移除这一项？')) mutate(p => { p.packing = p.packing.filter(v => v.id !== b.dataset.packRemove); });
  });
  function addTemplate(p) {
    const titles = new Set(p.packing.map(v => v.title.trim().toLowerCase()));
    const template = [['身份证件', 'essentials'], ['充电器', 'electronics'], ['充电宝', 'electronics'], ['换洗衣物', 'clothes'], ['洗漱用品', 'care'], ['雨伞', 'other']];
    const added = template.filter(([title]) => !titles.has(title.toLowerCase()));
    if (p.packing.length + added.length > 100) throw Error('基础清单加入后超过 100 项，请先整理已有清单。');
    if (!added.length) { status('基础物品已在清单中，没有重复添加。'); return false; }
    p.packing.push(...added.map(([title, category]) => ({ id: crypto.randomUUID(), title, category, quantity: 1, packed: false })));
  }
  $('travel-pack-template').addEventListener('click', () => mutate(addTemplate));
  function download(name, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportTrip(p) {
    const lines = [p.title, `${p.destination} | ${p.start_date} — ${p.end_date}`, '时间为目的地当地时间；金额为人民币。', '', `预算：${money(p.budget_cents)} | 预计：${money(totals(p).estimated)} | 已记：${money(totals(p).spent)}`];
    daysOf(p.start_date, p.end_date).forEach(date => {
      lines.push('', '━━ ' + date + ' ━━');
      p.stops.filter(s => s.date === date).forEach(s => lines.push(`${s.done ? '☑' : '☐'} ${s.time || '自由安排'} ${s.title}（${s.minutes} 分钟）`, `  ${s.location} | 预计 ${money(s.estimated_cents)} / 已记 ${money(s.spent_cents)}`, s.notes ? '  ' + s.notes : ''));
    });
    lines.push('', '━━ 行李清单 ━━', ...p.packing.map(v => `${v.packed ? '☑' : '☐'} ${v.title} × ${v.quantity}`), '', '━━ 旅行备忘 ━━', p.notes);
    return lines.join('\n');
  }
  $('travel-export').addEventListener('click', () => { sync(); if (current()) download('旅行行程-' + current().start_date + '.txt', exportTrip(current()), 'text/plain;charset=utf-8'); });
  $('travel-draft-export').addEventListener('click', () => { sync(); if (state.pending) download('旅行草稿.json', JSON.stringify({ id: state.pending.id, ...state.pending.body }, null, 2), 'application/json'); });
  $('travel-retry').addEventListener('click', () => { if (state.pending) persist(null); });
  $('travel-reconcile').addEventListener('click', () => {
    if (state.busy || !window.confirm('放弃本页待确认修改并读取服务器记录？请先导出需要保留的草稿。')) return;
    state.pending = null; state.dirty = false;
    ['travel-dialog', 'travel-stop-dialog'].forEach(id => $(id).close()); load();
  });
  function enter() { sync(); if (panel.classList.contains('active') && state.owner && !state.loaded && !state.busy) load(); }
  new MutationObserver(enter).observe(panel, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe($('app-view'), { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('storage', e => { if (e.key === 'studyflow.token') enter(); });
  window.addEventListener('beforeunload', e => { if (state.dirty || state.pending) { e.preventDefault(); e.returnValue = ''; } });
  sync(); render(); enter();
})();
