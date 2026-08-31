// Browserless regression check for the calendar's first paint. It deliberately
// runs without an access token or API so a blank calendar can never regress.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  return {
    innerHTML: "", textContent: "", value: "", checked: false, open: false, dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, insertAdjacentHTML(_position, html) { this.innerHTML = html + this.innerHTML; },
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
  "\n  window.__calendarTest = { parseWikipediaHistory };\n  bind();\n})();\n",
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
