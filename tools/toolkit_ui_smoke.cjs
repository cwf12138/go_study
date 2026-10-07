const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='internal/httpapi/assets/';
const html=fs.readFileSync(root+'index.html','utf8'),script=fs.readFileSync(root+'toolkit.js','utf8'),core=fs.readFileSync(root+'toolkit-core.js','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('toolkit-'+m[1]),'missing DOM '+m[1]);
for(const id of ['timer-hours','timer-minutes','timer-seconds','timer-name','timer-sound','unit-value','unit-from','unit-to'])assert(ids.has('toolkit-'+id));
assert(html.indexOf('/static/toolkit-core.js')<html.indexOf('/static/toolkit.js'));
assert(!/\beval\s*\(|new Function\s*\(/.test(core));
const css=fs.readFileSync(root+'toolkit.css','utf8');for(const marker of ['prefers-reduced-motion','data-theme="dark"','max-width:760px','focus-visible','[hidden]'])assert(css.includes(marker));
let now=1000000,subject='user-one';const store=new Map();
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function harness(){
  const elements=new Map();
  function el(id){if(!elements.has(id))elements.set(id,{id,value:'',checked:false,disabled:false,hidden:false,textContent:'',innerHTML:'',dataset:{},listeners:{},style:{setProperty(){}},classList:{contains(){return id==='panel-toolkit';}},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(k,v){this[k]=v;},focus(){},querySelectorAll(selector){if(id==='panel-toolkit'&&selector==='[data-tool]')return ['calc','timer','watch','convert'].map(name=>{const b=el('toolkit-tab-'+name);b.dataset.tool=name;return b;});return[];}});return elements.get(id);}
  el('toolkit-unit-value').value='1';
  const window={setInterval(){}};
  const context=vm.createContext({window,Date:Clock,Intl,console,confirm:()=>true,atob:v=>Buffer.from(v,'base64').toString(),localStorage:{getItem:()=>subject?'x.'+Buffer.from(JSON.stringify({sub:subject})).toString('base64url')+'.x':''},sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},navigator:{clipboard:{writeText:async()=>{}}},MutationObserver:class{observe(){}},document:{getElementById:el,querySelector:()=>({click(){}}),addEventListener(){}},});
  window.addEventListener=()=>{};
  vm.runInContext(core,context);
  vm.runInContext(script.replace("  sync();units(true);selectTool('calc');window.setInterval(tick,100);","  window.testToolkit={get data(){return data;},evaluate,timerToggle,timerReset,watchToggle,lap,tick,sync,selectTool,units};sync();units(true);selectTool('calc');window.setInterval(tick,100);"),context);
  return {context,el,C:window.DaynestToolkit,api:window.testToolkit};
}
const {C,api,el}=harness();
for(const [expression,value] of [['2+3*4',14],['(2+3)*4',20],['-2*-3',6],['.1+.2',.3],['200×10%',20],['100+10%',100.1],['1e3/2',500],['-(3+4)',-7]])assert.equal(C.calculate(expression),value,expression);
for(const expression of ['1/0','1+','alert(1)','2**3','1..2','()','2(3)','Infinity','1e999'])assert.throws(()=>C.calculate(expression),expression);
assert.equal(C.convert(1,'length','mile','m'),1609.344);assert.equal(C.convert(1,'mass','lb','g'),453.59237);assert.equal(C.convert(0,'temperature','c','f'),32);assert.equal(C.convert(32,'temperature','f','c'),0);assert.equal(C.convert(0,'temperature','k','c'),-273.15);assert.equal(C.convert(1,'volume','m3','l'),1000);assert.equal(C.convert(1,'area','ha','m2'),10000);assert.equal(C.convert(2,'time','hour','minute'),120);
assert.throws(()=>C.convert(-274,'temperature','c','f'));assert.throws(()=>C.convert('','length','m','km'));assert.throws(()=>C.convert('oops','length','m','km'));
assert.equal(C.duration(3661123,true),'01:01:01.12');
el('toolkit-expression').value='2+3';api.evaluate();assert.equal(el('toolkit-result').textContent,'5');assert.equal(api.data.history.length,1);
el('toolkit-timer-hours').value='0';el('toolkit-timer-minutes').value='0';el('toolkit-timer-seconds').value='10';api.timerToggle();assert(api.data.timer.running);assert(el('toolkit-timer-fields').disabled);
now+=3000;api.timerToggle();assert.equal(api.data.timer.remaining,7000);assert(!api.data.timer.running);
now+=5000;api.timerToggle();now+=2000;api.tick();assert.equal(el('toolkit-timer-display').textContent,'00:00:05');
api.selectTool('calc');assert(el('toolkit-timer').hidden);assert(!el('toolkit-running').hidden);
const refreshed=harness();assert(refreshed.api.data.timer.running);assert.equal(refreshed.api.data.history.length,1);
now+=6000;refreshed.api.tick();assert(refreshed.api.data.timer.finished);assert.equal(refreshed.el('toolkit-timer-display').textContent,'00:00:00');assert.match(refreshed.el('toolkit-running-message').textContent,/时间到了/);
refreshed.api.timerReset();assert.equal(refreshed.el('toolkit-running').hidden,true);
api.watchToggle();now+=1250;api.lap();assert.equal(api.data.watch.laps[0],1250);now+=1000;api.watchToggle();assert.equal(api.data.watch.elapsed,2250);now+=5000;api.watchToggle();now+=750;api.lap();assert.equal(api.data.watch.laps[1],3000);
el('toolkit-unit-value').value='invalid';api.units();assert(el('toolkit-unit-copy').disabled);
subject='user-two';api.sync();assert.equal(api.data.history.length,0);assert.equal(api.data.watch.laps.length,0);assert(!api.data.timer.running);assert(!store.has('daynest.toolkit.session.v1.user-one'));
const bad=C.restore({history:[{expression:'x',result:Infinity}],timer:{total:-1},watch:{running:true,elapsed:-1}},now);assert.equal(bad.history.length,0);assert.equal(bad.timer.total,300000);assert.equal(bad.watch.elapsed,0);
const expired=C.restore({timer:{total:1000,remaining:1000,running:true,end:now-1}},now);assert(expired.timer.finished);assert(!expired.timer.running);assert.equal(expired.timer.remaining,0);
el('toolkit-timer-hours').value='24';el('toolkit-timer-minutes').value='1';el('toolkit-timer-seconds').value='0';api.timerToggle();assert(!api.data.timer.running);assert.match(el('toolkit-timer-feedback').textContent,/24 小时/);
el('toolkit-timer-hours').value='0';el('toolkit-timer-minutes').value='0';api.timerToggle();assert(!api.data.timer.running);
for(let i=0;i<25;i++){el('toolkit-expression').value=String(i)+'+1';api.evaluate();}assert.equal(api.data.history.length,20);
const storageFailure=harness();storageFailure.context.sessionStorage.setItem=()=>{throw Error('storage denied');};storageFailure.el('toolkit-expression').value='3*4';storageFailure.api.evaluate();assert.equal(storageFailure.el('toolkit-result').textContent,'12');assert.match(storageFailure.el('toolkit-storage-status').textContent,/无法保存/);
subject='';api.sync();assert(el('toolkit-timer-toggle').disabled);assert(el('toolkit-running').hidden);
console.log('Toolkit passed: arithmetic/unsafe input, six unit categories, timer pause/resume/expiry/refresh, stopwatch laps, tabs, history and account isolation.');
