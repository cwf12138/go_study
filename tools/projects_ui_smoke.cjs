// Retirement regression: the UI is gone, while historical data remains exportable.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = 'internal/httpapi/assets/';
const html = fs.readFileSync(root + 'index.html', 'utf8');
for (const marker of ['data-view="projects"', 'data-goto="projects"', 'id="panel-projects"', 'id="project-dialog"', 'id="project-card-dialog"', '/static/projects.js', '/static/projects.css']) {
  assert(!html.includes(marker), 'retired UI marker remains: ' + marker);
}
assert(!fs.existsSync(root + 'projects.js'));
assert(!fs.existsSync(root + 'projects.css'));
const elements = new Map();
function el(selector) {
  if (selector === '#panel-projects') return null;
  if (!elements.has(selector)) elements.set(selector, {textContent:'',classList:{contains(){return false;},toggle(){},remove(){}},setAttribute(){}});
  return elements.get(selector);
}
const ctx = {Date, Intl, URLSearchParams, localStorage:{getItem(){return '';}}, document:{querySelector:el,querySelectorAll(){return [];}},window:{}};
const script = fs.readFileSync(root + 'app.js','utf8');
vm.runInNewContext(script.replace('  bootstrap();','  window.test = {showView,state};'),ctx);
ctx.window.test.showView('projects');
assert.equal(ctx.window.test.state.currentView,'dashboard');
assert.equal(el('#page-title').textContent,'今天');
for (const filename of ['internal/store/memory.go','internal/service/exports.go']) {
  assert(fs.readFileSync(filename,'utf8').includes('json:"projects"'), 'history/export field lost: ' + filename);
}
console.log('Projects retirement passed: no UI/assets/entry points, old navigation redirects home, snapshot and export fields retained.');
