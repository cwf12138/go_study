// Structural presentation checks; not a substitute for browser visual QA.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../internal/httpapi/assets');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'growth-studio.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'DOM IDs must remain unique');
for (const id of ['goal-form','goal-title','goal-description','goal-deadline','goal-status-filter','goal-sort','goal-order','goals-list','goals-pagination']) {
  assert(ids.includes(id), `Preserve existing control: ${id}`);
}
assert(!html.includes('/static/knowledge.css'));
assert(!ids.includes('panel-knowledge'));
assert(app.includes('data-goal-swipe-card') && app.includes('data-goal-delete'));
for(const hook of ['#panel-goals','#panel-knowledge','max-width:1280px','max-width:820px','max-width:560px','prefers-reduced-motion:reduce','data-theme=dark',':focus-visible']) assert(css.includes(hook), `Missing style safeguard ${hook}`);
assert(!css.includes('transform:'), 'Do not override the existing goal delete reveal transform');
assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);
console.log('Growth presentation passed: controls, unique IDs, accessibility labels, responsive/theme hooks and preserved delete animation.');
