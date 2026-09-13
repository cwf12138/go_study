// Presentation wiring checks. These do not replace visual browser testing.
const fs = require('node:fs'), assert = require('node:assert/strict');
const root = 'internal/httpapi/assets/';
const html = fs.readFileSync(root + 'index.html', 'utf8');
const css = fs.readFileSync(root + 'organizer-studio.css', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'document IDs remain unique');
assert.ok(html.includes('/static/organizer-studio.css?v='));
assert.ok(html.indexOf('/static/organizer-studio.css') > html.indexOf('/static/memos-refresh.css'), 'new overrides load after existing styles');
for (const id of ['memo-title', 'memo-content']) assert.match(html, new RegExp('id="' + id + '"[^>]+aria-label='));
for (const token of ['#panel-calendar', '#panel-memos', 'data-calendar-mode="day"', 'data-theme="dark"', 'prefers-reduced-motion', '.memo-workspace.memo-focused']) assert.ok(css.includes(token), `missing presentation rule ${token}`);
// New styling must preserve existing navigation/editor controls and visibility classes.
for (const id of ['memo-mobile-folders','memo-mobile-list','memo-preview-toggle','memo-save-state','memo-focus','calendar-today','calendar-prev','calendar-next','calendar-canvas','calendar-event-dialog']) assert.ok(ids.includes(id));
assert.ok(!/#panel-memos\s+\.hidden\s*\{/.test(css));
console.log('organizer presentation wiring passed: scoped styles, unique IDs, editor labels and responsive mode hooks');
