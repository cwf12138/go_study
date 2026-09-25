const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = 'internal/httpapi/assets/';
const html = fs.readFileSync(root+'index.html','utf8');
assert(html.includes('<title>日常 · Daynest</title>'));
for (const name of ['今天','记录','成长','探索']) assert(html.includes(`role="group" aria-label="${name}"`));
assert(!html.includes('id="panel-knowledge"') && !html.includes('/static/knowledge.js'));
for (const match of html.matchAll(/(?:src|href)="\/static\/([^"?]+)(?:\?[^" ]*)?"/g)) assert(fs.existsSync(root+match[1]), `missing asset ${match[1]}`);
const navs = [...html.matchAll(/class="nav-link[^"]*"[^>]*data-view="([^"]+)"/g)].map(m=>m[1]);
assert.equal(navs.length,18); for (const name of navs) assert(html.includes(`id="panel-${name}"`));
const elements = new Map();
function el(key) { if (!elements.has(key)) elements.set(key,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{toggle(){},remove(){}},parentElement:{classList:{toggle(){}}}}); return elements.get(key); }
const context = {Date,Intl,URLSearchParams,AbortController,Headers:class{set(){}has(){return false}},console,
  localStorage:{getItem(){return ''}},document:{querySelector:el,querySelectorAll(){return []}},window:{setTimeout(){},clearTimeout(){}}};
const source=fs.readFileSync(root+'app.js','utf8');
vm.runInNewContext(source.replace('  bootstrap();','  window.test={state,renderToday,saveTodayNote,localDateKey,showView};'),context);
const app=context.window.test, today=app.localDateKey(new Date());
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
const button={disabled:false},event={preventDefault(){},currentTarget:{querySelector(){return button}}};
async function run() {
  let calls=0;
  context.fetch=async()=>{calls++;throw new Error('offline')};
  el('#today-note').value='   ';await app.saveTodayNote(event);assert.equal(calls,0);
  el('#today-note').value='a thought';await app.saveTodayNote(event);assert.equal(el('#today-note').value,'a thought');assert.match(el('#today-note-status').textContent,/保存失败/);assert(!button.disabled);
  let release, body;
  context.fetch=(_,options)=>{body=JSON.parse(options.body);return new Promise(resolve=>{release=resolve})};
  const pending=app.saveTodayNote(event);assert(button.disabled);
  await app.saveTodayNote(event);assert.equal(body.content,'a thought');
  el('#today-note').value='keep typing';release({ok:true,status:200,json:async()=>({data:{id:'memo'}})});await pending;
  assert.equal(el('#today-note').value,'keep typing');assert.match(el('#today-note-status').textContent,/已存入/);
  const stale=app.saveTodayNote(event);app.state.token='two';el('#today-note-status').textContent='new account';
  release({ok:true,status:200,json:async()=>({data:{id:'old'}})});await stale;assert.equal(el('#today-note-status').textContent,'new account');
  const css=fs.readFileSync(root+'daynest.css','utf8');for(const hook of ['max-width:650px','prefers-reduced-motion:reduce','var(--paper)','overflow-y:auto'])assert(css.includes(hook));
  console.log('Daynest passed: navigation/assets, real daily data, completed/overdue filtering, escaping, failure states, quick-note retry, duplicate prevention, in-flight edits and account isolation.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
