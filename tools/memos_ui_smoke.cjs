// Browserless regression checks for memo selectors, safe Markdown rendering,
// checklist interactions and the responsive visual shell.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "internal/httpapi/assets/index.html"), "utf8");
const scriptPath = path.join(root, "internal/httpapi/assets/memos.js");
const script = fs.readFileSync(scriptPath, "utf8");
const styles = fs.readFileSync(path.join(root, "internal/httpapi/assets/memos.css"), "utf8");

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const duplicateIDs = [...ids].filter((id) => (html.match(new RegExp(`id="${id}"`, "g")) || []).length > 1);
if (duplicateIDs.length) throw new Error(`duplicate HTML ids: ${duplicateIDs.join(", ")}`);
const selectors = [...script.matchAll(/\$\("#([^"]+)"\)/g)].map((match) => match[1]);
const missing = [...new Set(selectors.filter((id) => !ids.has(id)))];
if (missing.length) throw new Error(`memos.js references missing HTML ids: ${missing.join(", ")}`);

for (const marker of ['data-view="memos"', 'id="panel-memos"', 'id="memo-editor"', '/static/memos.js?v=20260904-2', '/static/memos.css?v=20260904-1']) {
  if (!html.includes(marker)) throw new Error(`missing HTML marker: ${marker}`);
}
for (const marker of ["/api/v1/memo-folders", "/api/v1/memos/overview", "/restore", "/duplicate", "/permanent", "saveCurrent", "renderMarkdown"]) {
  if (!script.includes(marker)) throw new Error(`missing memo behavior: ${marker}`);
}
for (const marker of [".memo-workspace", ".memo-note-card", ".memo-editor-pane", ':root[data-theme="dark"]', "@media(max-width:700px)"]) {
  if (!styles.includes(marker)) throw new Error(`missing memo style: ${marker}`);
}

function element() {
  return {
    value: "", textContent: "", innerHTML: "", disabled: false, open: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, focus() {}, select() {}, close() {}, showModal() {},
  };
}
const elements = new Map();
const getElement = (selector) => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
const document = { querySelector: getElement, querySelectorAll() { return []; }, addEventListener() {}, createElement() { return element(); } };
const window = { setTimeout() {}, clearTimeout() {}, addEventListener() {}, confirm() { return false; }, prompt() { return null; } };
class HeadersMock { set() {} }
class BlobMock {}
const context = { console, Date, Intl, URL, URLSearchParams, Headers: HeadersMock, Blob: BlobMock, localStorage: { getItem() { return ""; } }, document, window };
const instrumented = script.replace("\n  bindEvents();\n})();", "\n  window.__memoTest = { renderMarkdown };\n  bindEvents();\n})();");
if (instrumented === script) throw new Error("memo test instrumentation point was not found");
vm.runInNewContext(instrumented, context, { filename: scriptPath });
const rendered = context.window.__memoTest.renderMarkdown("# 清单\n- [x] 完成 <script>alert(1)</script>\n- [ ] 继续 **学习**");
if (!rendered.includes("&lt;script&gt;") || rendered.includes("<script>") || !rendered.includes('data-memo-check-line="1"') || !rendered.includes("<strong>学习</strong>")) {
  throw new Error(`unsafe or incomplete memo rendering: ${rendered}`);
}
console.log(`memo UI smoke passed: ${selectors.length} selectors, ${ids.size} document ids`);
