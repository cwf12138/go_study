const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "internal/httpapi/assets/index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "internal/httpapi/assets/literature.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "internal/httpapi/assets/literature.css"), "utf8");

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const selectors = [...script.matchAll(/\$\("#([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
const missing = [...new Set(selectors.filter((id) => !ids.has(id)))];
if (missing.length) throw new Error(`literature.js references missing HTML ids: ${missing.join(", ")}`);

for (const marker of [
  'data-view="literature"', 'id="panel-literature"', 'id="ebook-reader-dialog"',
  'id="classic-reader-dialog"', '/static/literature.js?v=20260902-1',
  '/static/literature.css?v=20260902-1',
]) if (!html.includes(marker)) throw new Error(`missing HTML marker: ${marker}`);

for (const marker of [
  "/api/v1/literature/catalog", "/api/v1/literature/shelf",
  "/api/v1/literature/classics", "/api/v1/literature/classic-studies",
  "SpeechSynthesisUtterance", "function renderEBookPage", "function openClassic",
]) if (!script.includes(marker)) throw new Error(`missing script behavior: ${marker}`);

for (const marker of [
  ".literature-books-layout", ".ebook-reader-dialog", ".classic-parallel-text",
  'html[data-theme="dark"]', "@media(max-width:760px)",
]) if (!styles.includes(marker)) throw new Error(`missing responsive style: ${marker}`);

console.log(`literature UI smoke passed: ${selectors.length} selector references, ${ids.size} document ids`);
