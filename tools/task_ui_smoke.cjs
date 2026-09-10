// Task Studio's real filtering/rendering/controller logic with synthetic data only.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('internal/httpapi/assets/app.js', 'utf8');
const html = fs.readFileSync('internal/httpapi/assets/index.html', 'utf8');
const now = Date.parse('2026-09-11T12:00:00+08:00');
class Clock extends Date { static now() { return now; } }
const nodes = new Map(), documentListeners = new Map();
function node(selector) {
  if (selector.startsWith('#')) assert.ok(html.includes(`id="${selector.slice(1)}"`), `Missing ${selector}`);
  if (!nodes.has(selector)) {
    const classes = new Set();
    nodes.set(selector, {
      value: '', checked: false, disabled: false, innerHTML: '', textContent: '', attributes: {}, dataset: {}, listeners: {},
      classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key), toggle(key, value) { if (value ?? !classes.has(key)) classes.add(key); else classes.delete(key); } },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
      focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; },
      querySelectorAll() { return []; },
    });
  }
  return nodes.get(selector);
}
const context = {
  console, Date: Clock, Intl, URLSearchParams, AbortController, Headers: class { set() {} has() { return false; } },
  localStorage: { getItem() { return ''; }, setItem() {}, removeItem() {} },
  window: { addEventListener() {}, setTimeout() {}, clearTimeout() {} },
  document: { querySelector: node, querySelectorAll() { return []; }, addEventListener(type, handler) { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(handler); } },
};
const instrumented = source.replace('  bootstrap();', '  refresh=async()=>{}; renderFocus=()=>{window.focusRendered=true}; showView=(view)=>{state.currentView=view}; window.tasksTest={state,queryTaskPage,taskDeadlineBadge,renderTasks,resetTaskQuery,updateTaskQuery,prepareTaskFocus,focusTaskComposer,bindEvents,createTask};');
assert.notEqual(instrumented, source);
vm.runInNewContext(instrumented, context);
const app = context.window.tasksTest;
const base = { text: '', status: '', priority: '', deadline: '', sort: 'smart', page: 1, pageSize: 8 };
const task = (id, extras = {}) => ({ id, title: id, status: 'todo', priority: 'medium', estimated_minutes: 30, created_at: '2026-09-01T00:00:00Z', tags: [], ...extras });
const tasks = [
  task('late', { due_at: '2026-09-11T11:00:00+08:00', priority: 'low' }),
  task('urgent', { title: '实现 Worker Pool', description: '并发控制', tags: ['Go', '性能'], priority: 'high', due_at: '2026-09-11T18:00:00+08:00' }),
  task('week', { due_at: '2026-09-13T12:00:00+08:00', status: 'in_progress' }),
  task('undated'),
  task('done', { status: 'done', due_at: '2026-09-10T12:00:00+08:00' }),
  task('cancelled', { status: 'cancelled', due_at: '2026-09-10T12:00:00+08:00' }),
];
const ids = query => Array.from(app.queryTaskPage(tasks, { ...base, ...query }, now).items, item => item.id);
assert.deepEqual(ids({}), ['late', 'urgent', 'week', 'undated', 'cancelled', 'done']);
assert.deepEqual(ids({ text: 'worker GO 并发' }), ['urgent'], 'search spans title, description and tags, case insensitive');
assert.deepEqual(ids({ priority: 'high', status: 'todo', deadline: 'week' }), ['urgent']);
assert.deepEqual(ids({ deadline: 'overdue' }), ['late'], 'finished/cancelled items are not overdue');
assert.deepEqual(ids({ deadline: 'today' }), ['late', 'urgent']);
assert.deepEqual(ids({ deadline: 'undated' }), ['undated']);
assert.deepEqual(ids({ deadline: 'week' }), ['urgent', 'week']);
assert.deepEqual(ids({ text: 'does-not-exist' }), []);
assert.equal(app.taskDeadlineBadge(tasks[0], now).tone, 'overdue', 'earlier today is already overdue');
assert.equal(app.taskDeadlineBadge(tasks[1], now).tone, 'today');
assert.equal(app.taskDeadlineBadge(tasks[4], now).tone, 'closed');
assert.equal(app.taskDeadlineBadge(task('invalid', { due_at: 'invalid date' }), now).tone, 'undated');
const bounds = [task('now', { due_at: new Date(now).toISOString() }), task('end', { due_at: new Date(now + 7 * 86400000).toISOString() })];
assert.deepEqual(Array.from(app.queryTaskPage(bounds, { ...base, deadline: 'week' }, now).items, item => item.id), ['now']);
const dates = [task('missing', { created_at: null }), task('new', { created_at: '2026-09-10' }), task('old', { created_at: '2026-09-01' })];
assert.deepEqual(Array.from(app.queryTaskPage(dates, { ...base, sort: 'oldest' }, now).items, item => item.id), ['old', 'new', 'missing']);
assert.deepEqual(Array.from(app.queryTaskPage(dates, { ...base, sort: 'newest' }, now).items, item => item.id), ['new', 'old', 'missing']);

const many = Array.from({ length: 19 }, (_, index) => task(String(index).padStart(2, '0')));
const original = many.map(item => item.id).join(',');
let result = app.queryTaskPage(many, { ...base, page: 3 }, now);
assert.equal(result.items.length, 3);
assert.equal(result.totalPages, 3);
result = app.queryTaskPage(many.slice(0, 16), { ...base, page: 3 }, now);
assert.equal(result.page, 2, 'deleting the last page clamps to previous page');
result = app.queryTaskPage([], { ...base, page: 99 }, now);
assert.equal(result.page, 1);
assert.equal(result.items.length, 0);
assert.equal(many.map(item => item.id).join(','), original, 'sorting must not mutate shared source order');

app.state.tasks = [...many, task('unsafe', { title: '<img src=x onerror=alert(1)>', description: '<script>bad</script>', tags: ['<svg>'], goal_id: 'goal' })];
app.state.goals = [{ id: 'goal', title: '<b>Goal</b>' }];
app.updateTaskQuery({ text: 'onerror' });
assert.match(node('#tasks-list').innerHTML, /&lt;img/);
assert.match(node('#tasks-list').innerHTML, /&lt;script&gt;/);
assert.match(node('#tasks-list').innerHTML, /&lt;b&gt;Goal/);
assert.ok(!node('#tasks-list').innerHTML.includes('<img src=x'));
assert.match(node('#tasks-list').innerHTML, /data-task-menu aria-expanded="false"/);
app.resetTaskQuery();
assert.match(node('#tasks-summary').textContent, /20 项匹配/);
assert.equal((node('#tasks-list').innerHTML.match(/data-task-swipe-card/g) || []).length, 8);
assert.equal(node('#tasks-pagination').classList.contains('hidden'), false);
app.updateTaskQuery({ page: 3 });
app.updateTaskQuery({ priority: 'high' });
assert.equal(app.state.taskQuery.page, 1);
assert.match(node('#tasks-list').innerHTML, /重置筛选/);
assert.equal(node('#task-stat-todo').textContent, 20, 'overview counts full collection, independent of filters');
app.state.tasks = [];
app.resetTaskQuery();
assert.match(node('#tasks-list').innerHTML, /创建第一项任务/);
assert.equal(node('#tasks-pagination').classList.contains('hidden'), true);

app.bindEvents();
node('#task-search').value = '中文';
node('#task-search').listeners.compositionstart[0]();
node('#task-search').listeners.input[0]({ target: node('#task-search'), isComposing: true });
assert.equal(app.state.taskQuery.text, '', 'IME input waits for composition to finish');
app.renderTasks();
assert.equal(node('#task-search').value, '中文', 'background rendering must preserve unfinished IME composition');
node('#task-search').listeners.compositionend[0]({ target: node('#task-search') });
assert.equal(app.state.taskQuery.text, '中文');
node('#task-priority-filter').value = 'low';
node('#task-priority-filter').listeners.change[0]();
assert.equal(app.state.taskQuery.priority, 'low');

// Enter on a nested action button must retain native button activation, not open delete.
app.state.currentView = 'tasks';
const card = {}, button = { closest: selector => selector === '[data-task-swipe-card]' ? card : null };
let prevented = false;
for (const listener of documentListeners.get('keydown') || []) listener({ key: 'Enter', target: button, preventDefault() { prevented = true; } });
assert.equal(prevented, false);

app.state.tasks = [task('focus-task', { estimated_minutes: 480 }), task('done-task', { status: 'done' })];
app.prepareTaskFocus('focus-task');
assert.equal(app.state.currentView, 'focus');
assert.equal(node('#focus-task').value, 'focus-task');
assert.equal(node('#focus-minutes').value, 240, 'task estimate is capped to focus duration limit');
assert.equal(app.state.focus, null, 'shortcut prepares a session, never starts it');
app.state.focus = { id: 'existing-session', taskID: 'existing-task' };
node('#focus-task').value = 'existing-task';
app.prepareTaskFocus('focus-task');
assert.equal(node('#focus-task').value, 'existing-task');
assert.equal(app.state.focus.taskID, 'existing-task');
app.state.focus = null;
app.state.currentView = 'tasks';
app.state.isStartingFocus = true;
app.prepareTaskFocus('focus-task');
assert.equal(app.state.currentView, 'tasks', 'in-flight focus request must not be altered');
app.state.isStartingFocus = false;
app.prepareTaskFocus('done-task');
assert.equal(app.state.currentView, 'tasks');
app.focusTaskComposer();
assert.equal(node('#task-title').focused, true);
async function testCreate() {
  const form = node('#task-form'), button = node('task-submit');
  const fields = ['#task-title', '#task-goal', '#task-description', '#task-minutes', '#task-priority', '#task-due', '#task-tags'].map(node);
  form.querySelector = () => button;
  form.querySelectorAll = () => [...fields, button];
  form.reportValidity = () => true;
  let resets = 0, requests = 0, release;
  form.reset = () => { resets++; node('#task-title').value = ''; };
  app.state.token = 'mock-token';
  app.state.user = { id: 'mock-user' };
  node('#task-title').value = 'draft';
  app.updateTaskQuery({ status: 'done' });
  context.fetch = async () => { throw new TypeError('offline'); };
  const event = { currentTarget: form, preventDefault() {} };
  await app.createTask(event);
  assert.equal(node('#task-title').value, 'draft', 'failed create must preserve draft');
  assert.equal(app.state.taskQuery.status, 'done', 'failed create must retain filters');
  assert.equal(resets, 0);
  assert.equal(button.disabled, false);
  context.fetch = () => { requests++; return new Promise(resolve => { release = resolve; }); };
  const pending = app.createTask(event);
  assert.equal(node('#task-title').disabled, true, 'prevent editing a submitted draft while it is saving');
  await app.createTask(event);
  assert.equal(requests, 1, 'duplicate submissions are blocked');
  release({ ok: true, status: 201, json: async () => ({ data: { id: 'new-task' } }) });
  await pending;
  assert.equal(resets, 1);
  assert.equal(app.state.taskQuery.status, '');
  assert.equal(app.state.taskQuery.sort, 'newest');
  assert.equal(node('#task-title').disabled, false);
  console.log('Task Studio passed: search/filter, due boundaries, sorting, pagination, escaping, IME, keyboard controls, safe focus handoff and create failure/duplicate protection.');
}
testCreate().catch(error => { console.error(error); process.exitCode = 1; });
