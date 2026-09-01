// Browserless regression checks for the knowledge garden's safe renderer and
// for the contract between its JavaScript selectors and the HTML shell.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  return {
    value: "", textContent: "", innerHTML: "", open: false, checked: false, disabled: false,
    dataset: {}, className: "", classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, setAttribute() {}, focus() {}, close() { this.open = false; },
    showModal() { this.open = true; }, querySelector() { return element(); }, scrollIntoView() {},
  };
}

const elements = new Map();
const getElement = (selector) => {
  if (!elements.has(selector)) elements.set(selector, element());
  return elements.get(selector);
};
const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const document = {
  querySelector: getElement,
  querySelectorAll() { return []; },
  addEventListener() {},
};
const window = {
  innerWidth: 1280, setTimeout() {}, clearTimeout() {}, confirm() { return false; },
};
class HeadersMock { set() {} has() { return false; } }
const context = { console, Date, Intl, URLSearchParams, Headers: HeadersMock, localStorage: storage, document, window };

const root = path.join(__dirname, "..");
const scriptPath = path.join(root, "internal", "httpapi", "assets", "knowledge.js");
const htmlPath = path.join(root, "internal", "httpapi", "assets", "index.html");
let source = fs.readFileSync(scriptPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");
for (const match of source.matchAll(/\$\("#([a-z0-9-]+)"\)/g)) {
  if (!html.includes(`id="${match[1]}"`)) throw new Error(`missing HTML element for #${match[1]}`);
}
const instrumented = source.replace(
  /\n  bindKnowledgeEvents\(\);\r?\n\}\)\(\);\s*$/,
  "\n  window.__knowledgeTest = { renderMarkdown, graphPosition };\n  bindKnowledgeEvents();\n})();\n",
);
if (instrumented === source) throw new Error("knowledge test instrumentation point was not found");
vm.runInNewContext(instrumented, context, { filename: scriptPath });

const rendered = context.window.__knowledgeTest.renderMarkdown("## Channel\n<script>alert(1)</script>\n连接 [[Go Channel|channel]] 与 **goroutine**。");
if (!rendered.includes("&lt;script&gt;") || rendered.includes("<script>") || !rendered.includes('data-knowledge-title="Go Channel"') || !rendered.includes("<strong>goroutine</strong>")) {
  throw new Error(`unsafe or incomplete markdown rendering: ${rendered}`);
}
const center = context.window.__knowledgeTest.graphPosition(0, 8);
const satellite = context.window.__knowledgeTest.graphPosition(1, 8);
if (center.x !== 500 || center.y !== 300 || (satellite.x === center.x && satellite.y === center.y)) {
  throw new Error(`invalid graph layout: ${JSON.stringify({ center, satellite })}`);
}
console.log("knowledge UI smoke ok: selectors, safe markdown and graph layout");
