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
for (const hook of ['#panel-todo','max-width:1320px','max-width:760px','max-width:500px','data-theme=dark','prefers-reduced-motion:reduce',':focus-visible']) assert(css.includes(hook), `Missing ${hook}`);
assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);
console.log('Action presentation passed: todo controls, accessible search, and themes.');
