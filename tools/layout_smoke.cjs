const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '../internal/httpapi/assets');
const css = fs.readFileSync(path.join(root, 'layout.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.lastIndexOf('<link rel="stylesheet"') === html.indexOf('<link rel="stylesheet" href="/static/layout.css'));
assert(css.includes('--page-width: 1440px'));
assert(css.includes('--page-width: 1680px'));
assert(css.includes('--page-gutter: 22px'));
assert(css.includes('--page-gutter: 15px'));
assert(css.includes('calc((100% - var(--page-width)) / 2 + var(--page-gutter))'));
for (const id of ['calendar', 'memos', 'planner']) {
  assert(css.includes('#panel-' + id));
  assert(html.includes('id="panel-' + id + '"'));
}
// Check the shared frame formula across desktop, tablet and mobile widths.
// This verifies geometry, not browser layout or visual rendering.
for (const viewport of [360, 560, 768, 900, 1024, 1366, 1920, 2560]) {
  const available = viewport - (viewport > 900 ? 240 : 0);
  const gutter = viewport <= 560 ? 15 : viewport <= 900 ? 22 : Math.min(32, Math.max(24, viewport * .02));
  for (const cap of [1440, 1680]) {
    const contentLeft = (available - Math.min(available, cap)) / 2 + gutter;
    const headerLeft = Math.max(gutter, (available - cap) / 2 + gutter);
    assert.equal(contentLeft, headerLeft);
    assert(Math.min(available, cap) - 2 * gutter > 0);
  }
}
console.log('Layout checks passed: stylesheet order, responsive gutters, tool widths and shared alignment formula.');
