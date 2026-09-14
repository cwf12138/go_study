const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '../internal/httpapi/assets');
const source = fs.readFileSync(path.join(root, 'english-reading.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'english-reading.css'), 'utf8');
function setup(saved, blocked = false) {
  let change, property, stored;
  const select = {value:'22', addEventListener(event, fn){assert.equal(event,'change');change=fn;}};
  const status = {textContent:''};
  const dialog = {style:{setProperty(name, value){assert.equal(name,'--english-reading-size');property=value;}}};
  vm.runInNewContext(source, {
    document:{querySelector:s=>({'#english-reading-size':select,'#english-reader-dialog':dialog,'#english-type-status':status}[s])},
    localStorage:{getItem(){if(blocked)throw Error('blocked');return saved;},setItem(key,value){if(blocked)throw Error('blocked');stored={key,value};}}
  });
  return {select,status,change:()=>change(),property:()=>property,stored:()=>stored};
}
for (const [saved, expected] of [[null,'22'],['26','26'],['18','18'],['99','22'],['22px; color:red','22']]) {
  const env=setup(saved);assert.equal(env.property(),expected+'px');assert.equal(env.select.value,expected);
  env.select.value='26';env.change();assert.equal(env.property(),'26px');assert.equal(env.stored().value,'26');
}
const blocked=setup(null,true);blocked.select.value='18';blocked.change();assert.equal(blocked.property(),'18px');assert(blocked.status.textContent.includes('无法保存'));
assert(/id="english-reader-dialog"[^>]*aria-labelledby="english-reader-title"/.test(html));
assert(/id="english-reader-summary"[^>]*lang="en"/.test(html));
assert(/id="english-search"[^>]*aria-label=/.test(html));
assert(css.includes('font-size:var(--english-reading-size,22px)'));
assert(css.includes('white-space:pre-wrap'));
assert(/\.english-featured-open\{position:static/.test(css));
for(const hook of ['max-width:1000px','max-width:720px','data-theme=dark','prefers-reduced-motion:reduce',':focus-visible'])assert(css.includes(hook));
assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);
console.log('English readability passed: font selection, persistence, invalid values, unavailable storage, accessible controls and responsive style hooks.');
