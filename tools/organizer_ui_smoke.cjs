// Presentation wiring checks. These do not replace visual browser testing.
const fs = require('node:fs'), assert = require('node:assert/strict');
const root = 'internal/httpapi/assets/';
const html = fs.readFileSync(root + 'index.html', 'utf8');
const css = fs.readFileSync(root + 'organizer-studio.css', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'document IDs remain unique');
assert.ok(html.includes('/static/organizer-studio.css?v='));
for (const token of ['#panel-calendar', 'data-calendar-mode="day"', 'data-theme="dark"', 'prefers-reduced-motion']) assert.ok(css.includes(token), `missing presentation rule ${token}`);
// New styling must preserve existing navigation/editor controls and visibility classes.
for (const id of ['calendar-today','calendar-prev','calendar-next','calendar-canvas','calendar-event-dialog']) assert.ok(ids.includes(id));
console.log('organizer presentation wiring passed: scoped styles, unique IDs, calendar controls and responsive mode hooks');
