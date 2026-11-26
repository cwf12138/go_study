const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = 'internal/httpapi/assets/';
const html = fs.readFileSync(root+'index.html','utf8');
assert(html.includes('<title>日常 · Daynest</title>'));
for (const name of ['今天','记录','成长']) assert(html.includes(`role="group" aria-label="${name}"`));
assert(!html.includes('id="panel-knowledge"') && !html.includes('/static/knowledge.js'));
for (const match of html.matchAll(/(?:src|href)="\/static\/([^"?]+)(?:\?[^" ]*)?"/g)) assert(fs.existsSync(root+match[1]), `missing asset ${match[1]}`);
const navs = [...html.matchAll(/class="nav-link[^"]*"[^>]*data-view="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(navs).size,14); assert(!navs.includes('transfers')); assert(!navs.includes('whiteboards')); assert(!navs.includes('splits')); assert(navs.includes('fitness')); assert(!navs.includes('bookmarks')); assert(navs.includes('toolkit')); assert(navs.includes('subscriptions')); assert(navs.includes('meals')); assert(!navs.includes('projects')); assert(!navs.includes('travel')); for (const name of navs) assert(html.includes(`id="panel-${name}"`));
for (const view of ['insights','goals','tasks','planner','explore','care','memos','inventory']) {
  assert(!navs.includes(view) && !html.includes('id="panel-'+view+'"'));
}
assert.match(html, /data-goto="todo">查看待办/);
const elements = new Map();
function el(key) { if (!elements.has(key)) elements.set(key,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{toggle(){},remove(){}},parentElement:{classList:{toggle(){}}}}); return elements.get(key); }
const context = {Date,Intl,URLSearchParams,AbortController,Headers:class{set(){}has(){return false}},console,
  localStorage:{getItem(){return ''}},document:{querySelector:el,querySelectorAll(){return []}},window:{setTimeout(){},clearTimeout(){}}};
const source=fs.readFileSync(root+'app.js','utf8');
vm.runInNewContext(source.replace('  bootstrap();','  window.test={state,renderToday,localDateKey,showView};'),context);
const app=context.window.test, today=app.localDateKey(new Date());
context.localStorage.getItem=key=>key==='studyflow.token'?app.state.token:'';
app.state.token='one';app.state.todos=[
  {id:'1',title:'today',status:'pending',my_day_date:today},
  {id:'2',title:'finished',status:'completed',my_day_date:today},
  {id:'3',title:'<img src=x onerror=x>',status:'pending',due_at:'2020-01-01T00:00:00Z'},
  {id:'4',title:'future',status:'pending',due_at:'2099-01-01T00:00:00Z'},
];
app.state.todayCalendarDate=today; app.state.todayCalendar={events:[{title:'<script>x</script>',occurrence_start:new Date().toISOString(),all_day:true}],plan_blocks:[]};
app.renderToday();
assert.match(el('#today-todos').innerHTML,/today/); assert(!el('#today-todos').innerHTML.includes('finished'));assert(!el('#today-todos').innerHTML.includes('future'));
assert.match(el('#today-todos').innerHTML,/&lt;img/);assert.match(el('#today-todos').innerHTML,/已逾期/);
assert.match(el('#today-agenda').innerHTML,/&lt;script/);assert.match(el('#today-agenda').innerHTML,/全天/);
app.state.todayCalendarError=true;app.state.todayTodosError=true;app.renderToday();
assert.match(el('#today-agenda').innerHTML,/暂未加载成功/);assert.match(el('#today-todos').innerHTML,/暂未加载成功/);
const css=fs.readFileSync(root+'daynest.css','utf8');
for(const hook of ['max-width:650px','prefers-reduced-motion:reduce','var(--paper)','overflow-y:auto'])assert(css.includes(hook));
assert(!html.includes('today-note-form'));
console.log('Daynest passed: navigation, retired pages, daily data, todo filtering, escaping and failure states.');
