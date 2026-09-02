const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "internal/httpapi/assets/index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "internal/httpapi/assets/english.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "internal/httpapi/assets/english.css"), "utf8");

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const selectors = [...script.matchAll(/\$\("#([^"]+)"\)/g)].map((match) => match[1]);
const missing = [...new Set(selectors.filter((id) => !ids.has(id)))];
if (missing.length) throw new Error(`english.js references missing HTML ids: ${missing.join(", ")}`);

for (const marker of [
  'data-view="english"', 'id="panel-english"', 'id="english-reader-dialog"',
  '/static/english.js?v=20260901-7', '/static/english.css?v=20260901-7',
]) if (!html.includes(marker)) throw new Error(`missing HTML marker: ${marker}`);

for (const marker of [
  "/api/v1/english/articles", "/api/v1/english/library", "/api/v1/english/overview",
  "SpeechSynthesisUtterance", "/api/v1/word-books/", "escapeHTML(article.title)",
]) if (!script.includes(marker)) throw new Error(`missing script behavior: ${marker}`);

for (const marker of [".english-layout", ".english-article-grid", ".english-reader-dialog", "html[data-theme=\"dark\"]", "@media(max-width:720px)"])
  if (!styles.includes(marker)) throw new Error(`missing responsive style: ${marker}`);

console.log(`english UI smoke passed: ${selectors.length} selector references, ${ids.size} document ids`);
