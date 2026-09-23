// Browserless regression check for the calendar's first paint. It deliberately
// runs without an access token or API so a blank calendar can never regress.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

function element() {
  return {
    innerHTML: "", textContent: "", value: "", checked: false, open: false, dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, insertAdjacentHTML(_position, html) { this.innerHTML = html + this.innerHTML; },
    querySelector() { return element(); }, focus() {}, close() {}, showModal() {},
  };
}

const elements = new Map();
const getElement = (selector) => {
  if (!elements.has(selector)) elements.set(selector, element());
  return elements.get(selector);
};
const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const context = {
  console, Date, Intl, URLSearchParams,
  localStorage: storage, sessionStorage: storage,
  location: { hash: "" },
  document: {
    querySelector: getElement,
    querySelectorAll() { return []; },
  },
  window: {
    addEventListener() {}, setInterval() {}, setTimeout() {}, clearTimeout() {}, confirm() { return false; },
  },
  requestAnimationFrame(callback) { callback(); },
};
context.window.localStorage = storage;

const scriptPath = path.join(__dirname, "..", "internal", "httpapi", "assets", "calendar.js");
let source = fs.readFileSync(scriptPath, "utf8");
const instrumented = source.replace(
  /\n  bind\(\);\r?\n\}\)\(\);\s*$/,
  "\n  window.__calendarTest = { parseWikipediaHistory, state, renderCalendar, calendarItemTitle, itemsByDate };\n  bind();\n})();\n",
);
if (instrumented === source) throw new Error("calendar test instrumentation point was not found");
vm.runInNewContext(instrumented, context, { filename: scriptPath });

const canvas = getElement("#calendar-canvas");
const cells = (canvas.innerHTML.match(/data-calendar-date=/g) || []).length;
if (!canvas.innerHTML.includes("calendar-month-grid") || cells !== 42) {
  throw new Error(`calendar first paint failed: monthGrid=${canvas.innerHTML.includes("calendar-month-grid")} cells=${cells}`);
}
if (getElement("#calendar-title").textContent === "日历" || !getElement("#calendar-title").textContent) {
  throw new Error(`calendar title was not initialized: ${getElement("#calendar-title").textContent}`);
}
const history = context.window.__calendarTest.parseWikipediaHistory([
  "== 大事记 ==",
  "=== 20世纪 ===",
  "* 1985年：泰坦尼克号残骸被发现。",
  "* 公元前5509年：拜占庭历的创世纪日期。",
  "=== 21世纪 ===",
  "* 2004年：别斯兰人质危机发生。",
  "== 出生 ==",
  "* 1875年：埃德加·赖斯·巴勒斯出生。",
].join("\n"), "https://zh.wikipedia.org/wiki/9月1日");
if (history.length !== 3 || history[0].year !== 2004 || history[2].year !== -5509) {
  throw new Error(`history parser failed: ${JSON.stringify(history)}`);
}

console.log(`calendar UI smoke ok: ${cells} day cells, title=${getElement("#calendar-title").textContent}, history=${history.length}`);
for (const view of ['year', 'month', 'week', 'day']) {
  context.window.__calendarTest.state.view = view;
  context.window.__calendarTest.renderCalendar();
  if (getElement('#panel-calendar').dataset.calendarMode !== view) throw new Error(`calendar mode missing: ${view}`);
}
console.log('calendar responsive view hooks passed: year, month, week, day');

const moodTest = context.window.__calendarTest;
const moods = ['awful', 'low', 'neutral', 'good', 'great'];
moodTest.state.view = 'month';
moodTest.state.anchor = new Date(2026, 8, 1);
moodTest.state.selected = '2026-09-01';
moodTest.state.overview = { mood_entries: moods.map((mood, i) => ({ id: String(i), mood, date: '2026-09-0' + (i + 1) })) };
moodTest.renderCalendar();
for (const mood of moods) {
  const asset = '/static/mood-art/' + mood + '-flat-v2.png';
  assert.ok(canvas.innerHTML.includes('src="' + asset + '"'), 'month view must use journal artwork: ' + mood);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'internal', 'httpapi', 'assets', 'mood-art', mood + '-flat-v2.png')));
}
assert.ok(getElement('#calendar-day-agenda').innerHTML.includes('awful-flat-v2.png'), 'agenda uses same mood badge');
assert.ok(getElement('#calendar-day-agenda').innerHTML.includes('心情 · 很糟'), 'visible text explains mood');
assert.doesNotMatch(canvas.innerHTML, /😣|🙁|😐|🙂|😄/);
assert.equal(moodTest.calendarItemTitle({ type: 'event', title: '<script>' }), '&lt;script&gt;');
assert.match(moodTest.calendarItemTitle({ type: 'mood', title: '<img>', raw: { mood: '"><script>' } }), /neutral-flat-v2.png/);
assert.ok(moodTest.calendarItemTitle({ type: 'mood', title: '<img>', raw: {} }).includes('&lt;img&gt;'));
moodTest.state.query = '低落';
assert.equal([...moodTest.itemsByDate().values()].flat().length, 1, 'mood labels remain searchable');
console.log('calendar mood artwork passed: five shared images, month/agenda, readable labels, search and escaping');
