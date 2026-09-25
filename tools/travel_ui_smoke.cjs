const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const root = path.join(__dirname, '../internal/httpapi/assets'), nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', dataset: {}, handlers: {}, attributes: {}, open: false,
    classList: { toggle() {}, contains: () => false, add() {}, remove() {} },
    addEventListener(name, fn) { this.handlers[name] = fn; }, setAttribute(key, value) { this.attributes[key] = value; },
    reset() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; }, reportValidity: () => true,
    querySelector: () => null, querySelectorAll: () => [] });
  return nodes.get(id);
}
let token = 'alice', response, uuid = 0;
const tabNodes = ['route', 'packing', 'budget'].map(t => { const n = node('travel-tab-' + t); n.dataset.travelTab = t; return n; });
const ctx = { document: { getElementById: node, querySelectorAll: sel => sel === '[data-travel-tab]' ? tabNodes : [] },
  window: { addEventListener() {}, confirm: () => true }, localStorage: { getItem: () => token },
  crypto: { randomUUID: () => 'generated-id-' + (++uuid) }, MutationObserver: class { observe() {} },
  AbortController, setTimeout, clearTimeout, fetch: (...args) => response(...args) };
vm.createContext(ctx);
const source = fs.readFileSync(path.join(root, 'travel.js'), 'utf8');
const hook = '  sync(); render(); enter();';
assert(source.includes(hook));
vm.runInContext(source.replace(hook, '  window.test = {state, sync, load, persist, mutate, daysOf, cents, overlaps, totals, render, moveStop, addTemplate, exportTrip, request, openTrip, openStop};' + hook), ctx);
const api = ctx.window.test, ok = data => ({ ok: true, status: 200, json: async () => ({ data }) });
const stop = (id, time = '10:00') => ({ id, title: '<img src=x onerror=alert(1)>', date: '2026-10-01', time, minutes: 60,
  category: 'sight', location: '<script>', notes: 'Some notes', estimated_cents: 123, spent_cents: 100, done: false });
const fixture = () => ({ id: 'travel-00000001', title: '杭州周末', destination: '杭州', start_date: '2026-10-01', end_date: '2026-10-03',
  budget_cents: 30000, revision: 1, archived: false, notes: 'Take a walk', stops: [stop('stop-00000001'), stop('stop-00000002', '11:00')], packing: [] });
function setup(p = fixture()) {
  Object.assign(api.state, { items: [p], selected: p.id, date: p.start_date, loaded: true, busy: false, pending: null, dirty: false });
  node('travel-filter').value = p.archived ? 'archived' : 'active'; node('travel-search').value = ''; api.render(); return p;
}
function target(dataset) { return { dataset, closest: () => ({ dataset }) }; }

(async () => {
  assert.equal(api.cents('0.29'), 29); assert.equal(api.cents('1000000'), 100000000);
  for (const v of ['-1', '1.234', '1e3', 'Infinity', '', '1000000.01']) assert.throws(() => api.cents(v));
  assert.equal(api.daysOf('2028-02-28', '2028-03-01').length, 3);
  assert.equal(api.daysOf('2026-03-01', '2026-03-31').length, 31);
  for (const pair of [['2026-02-30', '2026-03-01'], ['2026-01-01', '2026-02-01'], ['2026-02-01', '2026-01-01']]) assert.throws(() => api.daysOf(...pair));
  let p = setup();
  assert.equal(api.overlaps(p.stops).length, 0); p.stops[1].time = '10:30'; assert.equal(api.overlaps(p.stops).length, 1);
  assert.equal(api.totals(p).estimated, 246); assert.equal(api.totals(p).spent, 200);
  api.render(); assert(!node('travel-route').innerHTML.includes('<img')); assert(node('travel-route').innerHTML.includes('&lt;img'));
  assert(!node('travel-budget-lines').innerHTML.includes('<img')); assert(node('travel-overlaps').textContent.includes('1 处'));
  api.moveStop(p, p.stops[0].id, 1); assert.equal(p.stops[0].id, 'stop-00000002');
  api.addTemplate(p); assert.equal(p.packing.length, 6); api.addTemplate(p); assert.equal(p.packing.length, 6);
  assert(api.exportTrip(p).includes('杭州')); assert(api.exportTrip(p).includes('充电器'));
  tabNodes[0].handlers.keydown({ key: 'ArrowRight', preventDefault() {} }); assert.equal(api.state.tab, 'packing');
  assert.equal(tabNodes[1].attributes['aria-selected'], 'true'); assert.equal(tabNodes[0].tabIndex, -1);
  api.openTrip(true); assert(node('travel-dialog').open); assert.equal(node('travel-destination').value, '杭州'); node('travel-dialog').close();
  api.openStop(p.stops[0].id); assert.equal(node('travel-stop-date').max, '2026-10-03'); node('travel-stop-dialog').close();

  // An uncertain write must keep exactly the same body/identifier for its retry.
  response = async () => { throw Error('offline'); };
  node('travel-dialog').open = true;
  await api.persist({ ...p, title: 'retry title' }, 'travel-dialog');
  assert(api.state.pending); assert(!node('travel-dialog').open);
  const requestBody = JSON.stringify(api.state.pending.body);
  response = async (url, options) => { assert(url.endsWith(p.id)); assert.equal(options.body, requestBody); return ok({ ...p, ...JSON.parse(options.body), revision: 2 }); };
  await api.persist(null); assert(!api.state.pending); assert.equal(api.state.items.length, 1); assert.equal(api.state.items[0].revision, 2);

  response = async () => ({ ok: false, status: 409, json: async () => ({ error: { message: 'conflict' } }) });
  await api.persist({ ...api.state.items[0], title: 'conflicting local draft' });
  assert.equal(api.state.pending.body.title, 'conflicting local draft'); assert.equal(api.state.items[0].title, 'retry title');
  const pending = api.state.pending; await api.load(); assert.strictEqual(api.state.pending, pending);

  setup(); response = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'invalid date' } }) });
  node('travel-dialog').open = true; await api.persist({ ...fixture(), title: '' }, 'travel-dialog');
  assert(!api.state.pending); assert(node('travel-dialog').open); assert.equal(node('travel-form-status').textContent, 'invalid date'); node('travel-dialog').close();

  // Real event wiring: done toggle, reorder, packing template/add, date/tab switches.
  p = setup(); let calls = 0;
  response = async (url, options) => { calls++; return ok({ ...api.state.items[0], ...JSON.parse(options.body), revision: api.state.items[0].revision + 1 }); };
  await node('travel-route').handlers.change({ target: { dataset: { stopCheck: p.stops[0].id }, checked: true } });
  assert(api.state.items[0].stops[0].done);
  await node('travel-route').handlers.click({ target: target({ stopDown: p.stops[0].id }) });
  assert.equal(api.state.items[0].stops[1].id, p.stops[0].id);
  await node('travel-pack-template').handlers.click(); assert.equal(api.state.items[0].packing.length, 6);
  node('travel-pack-name').value = '相机'; node('travel-pack-quantity').value = '2'; node('travel-pack-category').value = 'electronics';
  await node('travel-pack-form').handlers.submit({ preventDefault() {} });
  assert.equal(api.state.items[0].packing.at(-1).quantity, 2); assert.equal(node('travel-pack-name').value, '');
  node('travel-days').handlers.click({ target: target({ day: '2026-10-02' }) }); assert.equal(api.state.date, '2026-10-02');

  // Drag to a day is equivalent to editing the destination-local date.
  api.state.drag = api.state.items[0].stops[0].id;
  const movedID = api.state.drag;
  node('travel-days').handlers.drop({ target: target({ day: '2026-10-03' }), preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.state.items[0].stops.find(s => s.id === movedID).date, '2026-10-03');
  assert.equal(api.state.drag, '');

  // Archived plans are read-only, even if a synthetic event bypasses disabled buttons.
  setup({ ...fixture(), archived: true }); calls = 0;
  await api.mutate(p => { p.title = 'must not save'; }); assert.equal(calls, 0);
  setup(); response = async () => ok({}); await api.persist(fixture()); assert(api.state.pending, 'malformed response should preserve draft');

  // A late response belonging to Alice must never populate Bob's page.
  setup(); let release; response = () => new Promise(resolve => { release = resolve; });
  const stale = api.persist({ ...fixture(), title: 'alice private' }); token = 'bob'; api.sync();
  release(ok({ ...fixture(), title: 'alice private', revision: 2 })); await stale;
  assert.equal(api.state.items.length, 0); assert(!api.state.pending); assert.equal(api.state.owner, 'bob');
  response = async () => { throw Error('offline'); }; await api.load(); assert(!api.state.loaded); assert(!api.state.busy); assert(node('travel-status').textContent.includes('加载失败'));
  response = async () => ok([{ ...fixture(), start_date: 'not-a-date' }]); await api.load();
  assert(!api.state.loaded); assert(!api.state.busy); assert(node('travel-status').textContent.includes('格式不正确'));

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const id of nodes.keys()) assert(html.includes(`id="${id}"`), 'missing DOM: ' + id);
  assert(html.includes('data-view="travel"')); assert(html.includes('/static/travel.js')); assert(html.includes('/static/travel.css'));
  // Catch accidental panel nesting and duplicate IDs, a previous source of empty feature pages.
  const panelStart = html.indexOf('<section id="panel-travel"'), projectStart = html.indexOf('<section id="panel-projects"');
  assert(panelStart > 0 && projectStart > panelStart);
  const travelSegment = html.slice(panelStart, projectStart);
  assert.equal((travelSegment.match(/<section\b/g) || []).length, (travelSegment.match(/<\/section>/g) || []).length);
  const ids = [...html.matchAll(/\bid="(travel[^"]*|panel-travel)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, ids.length);
  const css = fs.readFileSync(path.join(root, 'travel.css'), 'utf8');
  assert(css.includes('prefers-reduced-motion')); assert(css.includes('data-theme=dark')); assert(css.includes('max-width: 700px'));
  console.log('Travel UI passed: dates, cents, totals, overlaps, escaping, tabs, dialogs, mutation events, sorting, templates, save retries/conflicts, account isolation and DOM wiring.');
})().catch(error => { console.error(error); process.exitCode = 1; });
