// Structural checks only; browser visual verification remains separate.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../internal/httpapi/assets');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'action-studio.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, 'IDs remain unique');
for (const match of app.matchAll(/\$\("#((?:todo|planner)-[\w-]+)"\)/g)) {
  assert(ids.includes(match[1]) || app.includes(`id="${match[1]}"`), `Missing static or rendered control ${match[1]}`);
}
for (const id of ['todo-search','todo-list-name']) assert(new RegExp(`id="${id}"[^>]*aria-label=`).test(html));
assert(/class="action-calendar-viewport"[^>]*role="region"[^>]*aria-label="[^"]+"[^>]*tabindex="0"><div id="planner-calendar"/.test(html));
assert(css.includes('overflow-x:auto'));
for (const hook of ['#panel-todo','#panel-planner','max-width:1320px','max-width:760px','max-width:500px','data-theme=dark','prefers-reduced-motion:reduce',':focus-visible']) assert(css.includes(hook), `Missing ${hook}`);
assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);
for (const match of css.matchAll(/[^{}]*\.planner-block(?:[.:>\s][^{}]*)?\{([^}]+)\}/g)) {
  assert(!/(?:^|;)\s*(?:top|height|position)\s*:/.test(match[1]), 'Preserve planner time-block geometry');
}
console.log('Action presentation passed: existing controls, accessible search, scrollable week region, themes and unchanged time-block geometry.');
