// Browserless regression checks of the real Focus Studio controller. No user data or network.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('internal/httpapi/assets/index.html', 'utf8');
const source = fs.readFileSync('internal/httpapi/assets/app.js', 'utf8');
const elements = new Map();
let clock = Date.parse('2026-09-11T08:00:00Z');
class Clock extends Date { static now() { return clock; } }
function element(selector) {
  if (selector.startsWith('#')) assert.ok(html.includes(`id="${selector.slice(1)}"`), `missing element: ${selector}`);
  if (!elements.has(selector)) {
    const classes = new Set();
    elements.set(selector, {
      value: '', checked: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, attributes: {},
      style: { setProperty(name, value) { this[name] = value; } },
      classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, enabled) { if (enabled ?? !classes.has(name)) classes.add(name); else classes.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { this.focused = true; },
      reportValidity() { return Number(element('#focus-minutes').value) >= 1 && Number(element('#focus-minutes').value) <= 240; },
      querySelectorAll(selector) { return selector === 'input,select' ? ['#focus-minutes', '#focus-task', '#focus-break-enabled', '#focus-complete-task'].map(element) : []; },
    });
  }
  return elements.get(selector);
}
const presets = [15, 25, 45, 60].map(minutes => { const node = element(`preset-${minutes}`); node.dataset.focusDuration = String(minutes); return node; });
const context = {
  console, Date: Clock, Intl, URLSearchParams, AbortController,
  Headers: class { set() {} has() { return false; } },
  localStorage: { getItem() { return ''; }, setItem() {}, removeItem() {} },
  document: { querySelector: element, querySelectorAll: selector => selector === '[data-focus-duration]' ? presets : [] },
  window: { setTimeout() {}, clearTimeout() {} },
};
const instrumented = source.replace('  bootstrap();', '  refresh=async()=>{}; window.testFocus={state,renderFocus,renderFocusPlan,renderFocusTaskPreview,focusPlanSegments,phaseRemainingSeconds,phaseTotalSeconds,updateFocusClock,startFocus,pauseFocus,resumeFocus,advanceFocus,finishFocus,retryFocusTransition,setFocusQuiet};');
assert.notEqual(source, instrumented);
vm.runInNewContext(instrumented, context);
const app = context.window.testFocus;
app.state.user = { id: 'test-user' };
app.state.token = 'test-token';
app.state.currentView = 'focus';
element('#focus-minutes').value = 25;
element('#daily-goal-form').classList.add('hidden');
const session = (overrides = {}) => ({ id: 'test-session', planned_minutes: 25, break_enabled: true, break_minutes: 5, phase: 'focus_first', phase_remaining_seconds: 750, phase_started_at: new Date(clock).toISOString(), started_at: new Date(clock).toISOString(), status: 'running', ...overrides });
const response = data => ({ status: 200, ok: true, json: async () => ({ data }) });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function test() {
  // Native form submission from the main timer must target the settings form.
  assert.match(html, /id="start-focus"[^>]+form="focus-form"/);
  assert.equal((html.match(/id="start-focus"/g) || []).length, 1);
  for (const minutes of [1, 15, 25, 45, 60, 240]) {
    const split = app.focusPlanSegments(minutes, true);
    assert.equal(split[0].seconds + split[2].seconds, minutes * 60);
    assert.equal(split[1].seconds, 300);
    assert.equal(app.focusPlanSegments(minutes, false).length, 1);
  }
  app.renderFocus();
  assert.equal(element('#focus-clock').textContent, '25:00');
  assert.equal(presets[1].attributes['aria-pressed'], 'true');
  assert.equal(element('#focus-quiet-toggle').disabled, true);
  element('#focus-break-enabled').checked = true;
  app.renderFocusPlan();
  assert.match(element('#focus-phase-track').innerHTML, /12 分 30 秒/);
  assert.match(element('#focus-plan-summary').textContent, /25 分钟专注 \+ 5 分钟休息/);

  // Invalid duration doesn't submit, and an in-flight start locks both settings and presets.
  let calls = 0, release;
  context.fetch = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  element('#focus-minutes').value = 0;
  await app.startFocus({ preventDefault() {} });
  assert.equal(calls, 0);
  element('#focus-minutes').value = 25;
  element('#focus-complete-task').checked = false;
  const starting = app.startFocus({ preventDefault() {} });
  assert.equal(element('#focus-minutes').disabled, true);
  assert.equal(presets[0].disabled, true);
  await app.startFocus({ preventDefault() {} });
  assert.equal(calls, 1);
  release(response(session()));
  await starting;
  assert.equal(app.state.focus.completeTask, false);
  assert.equal(element('#focus-clock').textContent, '12:30');
  assert.equal(element('#start-focus').classList.contains('hidden'), true);
  clock += 13000;
  app.updateFocusClock();
  assert.equal(element('#focus-clock').textContent, '12:17');
  context.fetch = async () => response(session({ status: 'paused', phase_remaining_seconds: 737 }));
  await app.pauseFocus();
  clock += 90000;
  app.updateFocusClock();
  assert.equal(element('#focus-clock').textContent, '12:17', 'paused clock must not advance');
  assert.equal(element('#panel-focus').dataset.focusState, 'paused');
  assert.match(element('#focus-phase-track').innerHTML, /已暂停/);
  assert.equal(element('#resume-focus').classList.contains('hidden'), false);
  app.setFocusQuiet(true);
  assert.equal(element('#panel-focus').classList.contains('is-quiet'), true);
  assert.equal(element('#focus-quiet-toggle').attributes['aria-pressed'], 'true');
  app.setFocusQuiet(false);
  assert.equal(element('#panel-focus').classList.contains('is-quiet'), false);

  context.fetch = async () => response(session({ phase_remaining_seconds: 737 }));
  await app.resumeFocus();
  clock += 7000;
  app.updateFocusClock();
  assert.equal(element('#focus-clock').textContent, '12:10');
  // Server-restored settings replace stale form defaults.
  app.state.focus.plannedMinutes = 45;
  app.renderFocus();
  assert.equal(element('#focus-minutes').value, 45);
  assert.equal(presets[2].attributes['aria-pressed'], 'true');

  app.state.tasks = Array.from({ length: 8 }, (_, i) => ({ id: `task-${i}`, title: i === 7 ? '<script>unsafe</script>' : `Task ${i}`, status: 'todo', priority: 'medium' }));
  app.state.focus.taskID = 'task-7';
  app.renderFocusTaskPreview();
  assert.match(element('#focus-task-preview').innerHTML, /data-focus-task-select="task-7" aria-pressed="true"/);
  assert.match(element('#focus-task-preview').innerHTML, /&lt;script&gt;/);
  assert.equal((element('#focus-task-preview').innerHTML.match(/data-focus-task-select=/g) || []).length, 5);

  // Failed auto-advance remains visible and retries the phase, never finishes the session early.
  app.state.focus.phaseRemainingSeconds = 0;
  app.state.focus.autoFinishAttempted = false;
  calls = 0;
  context.fetch = async () => { calls++; throw new TypeError('offline'); };
  app.updateFocusClock();
  await flush();
  assert.equal(calls, 1);
  assert.equal(element('#focus-transition-notice').classList.contains('hidden'), false);
  for (let i = 0; i < 4; i++) app.updateFocusClock();
  assert.equal(calls, 1, 'clock ticks must not spam failed requests');
  context.fetch = async path => {
    if (path.endsWith('/active')) return response(session({ phase_remaining_seconds: 0 }));
    assert.match(path, /\/advance$/); return response(session({ phase: 'break', phase_remaining_seconds: 300 }));
  };
  await app.retryFocusTransition();
  assert.equal(element('#focus-clock').textContent, '05:00');
  assert.equal(element('#panel-focus').dataset.focusState, 'break');
  assert.equal(element('#focus-transition-notice').classList.contains('hidden'), true);

  // Lost mutation response: server already advanced, so recovery only reads current state.
  app.state.focus.phase = 'focus_first';
  app.state.focus.phaseRemainingSeconds = 0;
  app.state.focus.autoFinishAttempted = true;
  app.state.focus.transitionError = 'response lost';
  context.fetch = async path => { assert.match(path, /\/active$/); return response(session({ phase: 'break', phase_remaining_seconds: 250 })); };
  await app.retryFocusTransition();
  assert.equal(element('#focus-clock').textContent, '04:10');

  app.state.focus.phase = 'focus_second';
  app.state.focus.phaseRemainingSeconds = 0;
  app.state.focus.autoFinishAttempted = false;
  context.fetch = async () => { throw new TypeError('offline'); };
  app.updateFocusClock();
  await flush();
  assert.ok(app.state.focus.transitionError);
  app.setFocusQuiet(true);
  context.fetch = async path => {
    if (path.endsWith('/active')) return response(session({ phase: 'focus_second', phase_remaining_seconds: 0 }));
    assert.match(path, /\/finish$/); return response({});
  };
  await app.retryFocusTransition();
  assert.equal(app.state.focus, null);
  assert.equal(element('#panel-focus').classList.contains('is-quiet'), false);
  assert.equal(element('#start-focus').disabled, false);
  assert.equal(element('#focus-minutes').disabled, false);

  app.state.focus = { id: 'test-session', plannedMinutes: 25, breakEnabled: false, phase: 'focus', phaseRemainingSeconds: 0, status: 'running', autoFinishAttempted: true, transitionError: 'finish response lost' };
  context.fetch = async path => { assert.match(path, /\/active$/); return response(null); };
  await app.retryFocusTransition();
  assert.equal(app.state.focus, null, 'already-finished session must reconcile without another finish request');

  // A failed start must recover all controls.
  context.fetch = async () => { throw new TypeError('offline'); };
  await app.startFocus({ preventDefault() {} });
  assert.equal(app.state.isStartingFocus, false);
  assert.equal(element('#start-focus').disabled, false);
  assert.equal(presets[0].disabled, false);
  console.log('Focus Studio passed: form wiring, split durations, start locking, pause/resume, restored settings, quiet mode, task selection, escaped titles, transition retry and failure recovery.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
