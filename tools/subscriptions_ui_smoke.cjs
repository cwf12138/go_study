const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='internal/httpapi/assets/',html=fs.readFileSync(root+'index.html','utf8'),core=fs.readFileSync(root+'subscriptions-core.js','utf8'),script=fs.readFileSync(root+'subscriptions.js','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));for(const match of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('sub-'+match[1]),'missing '+match[1]);
let account='one',response,confirms=true;
const elements=new Map(),windowListeners={};
function el(id){assert(ids.has(id),id);if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,listeners:{},classList:{contains:()=>false},addEventListener(t,fn){this.listeners[t]=fn;},querySelectorAll:()=>[],reset(){},close(){this.open=false;},showModal(){this.open=true;},focus(){}});return elements.get(id);}
const E=id=>el('sub-'+id);
class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-11T04:00:00Z']));}}
const context=vm.createContext({window:{addEventListener:(t,fn)=>windowListeners[t]=fn,setInterval(){},setTimeout(){},clearTimeout(){}},Date:Clock,Intl,URL,AbortController,console,confirm:()=>confirms,crypto:{randomUUID:()=> 'subscription-new'},localStorage:{getItem:()=>account},document:{getElementById:el,body:{appendChild(){}},createElement:()=>({click(){},remove(){}})},MutationObserver:class{observe(){}},fetch:async(path,opts)=>response(path,opts)});
vm.runInContext(core,context);
vm.runInContext(script.replace('  window.setInterval(()=>','  window.testSubscriptions={state,load,persist,render,edit,bodyOf,filtered};window.setInterval(()=>'),context);
const C=context.window.DaynestSubscriptions,A=context.window.testSubscriptions;
const fixture=(id='sub-00000001')=>({id,user_id:'u',name:'Music',category:'影音',amount_cents:1500,cycle:'monthly',anchor_date:'2026-10-01',paid_cycles:0,last_paid_date:'',state:'active',note:'',deleted:false,revision:1,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'});
const ok=data=>({ok:true,status:200,json:async()=>({data})});
const click=id=>E(id).listeners.click();const gridAction=(action,id)=>E('grid').listeners.click({target:{closest:()=>({dataset:{action,id}})}});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
(async()=>{
  let row=fixture();assert.equal(C.due({...row,anchor_date:'2026-01-31',paid_cycles:1}),'2026-02-28');assert.equal(C.due({...row,anchor_date:'2026-01-31',paid_cycles:2}),'2026-03-31');
  assert.equal(C.due({...row,cycle:'yearly',anchor_date:'2024-02-29',paid_cycles:4}),'2028-02-29');assert.equal(C.days('2026-10-10','2026-10-11'),1);
  assert.equal(C.cents('0.01'),1);assert.equal(C.cents('29.90'),2990);assert.throws(()=>C.cents('1.005'));assert.throws(()=>C.cents('1e3'));assert.throws(()=>C.cents('1000001'));assert.throws(()=>C.due({...row,anchor_date:'2100-12-31',paid_cycles:1}));
  const weekly={...row,cycle:'weekly',anchor_date:'2026-10-11',amount_cents:100};assert.equal(C.upcoming([weekly],'2026-10-11').length,5);assert.equal(C.totals([weekly],'2026-10-11').upcoming,500);
  assert.equal(C.upcoming([{...weekly,anchor_date:'2000-01-02'}],'2026-10-11').length,5);assert.equal(C.upcoming([{...weekly,state:'paused'}],'2026-10-11').length,0);assert.equal(C.totals([{...row,deleted:true}],'2026-10-11').active,0);
  assert.equal(C.totals([row],'2026-10-11').due,1);assert.equal(C.totals([row],'2026-10-11').annual,18000);assert.equal(C.upcoming([row],'2026-10-11')[0].date,'2026-11-01');
  assert(C.csv([{...row,name:'=evil()',note:'"quoted"\nline'}]).includes("'=evil()"));assert(C.csv([row]).startsWith('\uFEFF'));
  response=async()=>ok([row]);await A.load();assert(A.state.loaded);assert.equal(E('due-count').textContent,'1 项');assert(E('grid').innerHTML.includes('2026-10-01'));
  A.state.rows=Array.from({length:23},(_,i)=>fixture('sub-'+String(i).padStart(8,'0')));A.render();assert.equal((E('grid').innerHTML.match(/class="sub-card/g)||[]).length,9);assert.equal(E('page').textContent,'1 / 3');click('next');assert.equal(E('page').textContent,'2 / 3');
  E('search').value='no match';E('search').listeners.input();assert.equal(E('page').textContent,'1 / 1');E('search').value='';A.state.rows=[{...row,name:'<img src=x onerror=alert(1)>',note:'<script>'}];A.render();assert(!E('grid').innerHTML.includes('<img'));assert(E('grid').innerHTML.includes('&lt;img'));
  A.state.rows=[row];A.edit(row);E('form').listeners.input();confirms=false;click('close');assert(E('dialog').open);confirms=true;click('close');assert(!E('dialog').open);
  // One confirmed payment advances one period, never automatically skips overdue cycles.
  let sent;response=async(path,opts)=>{sent=JSON.parse(opts.body);return ok({...row,...sent,revision:2});};gridAction('pay',row.id);await settle();assert.equal(sent.paid_cycles,1);assert.equal(sent.last_paid_date,'2026-10-11');assert.equal(C.due(A.state.rows[0]),'2026-11-01');sent=null;gridAction('pay',row.id);await settle();assert.equal(sent,null);
  // Unknown save result remains retryable with the exact original body.
  row=A.state.rows[0];const pending={id:row.id,body:{...A.bodyOf(row),note:'pending'}};response=async()=>{throw Error('offline');};await A.persist(pending);assert(A.state.pending);assert(!E('recovery').hidden);assert(E('new').disabled);
  let attempted;response=async(path,opts)=>{attempted=JSON.parse(opts.body);return ok({...row,...attempted,revision:3});};await click('retry');assert.equal(attempted.revision,2);assert.equal(attempted.note,'pending');assert(!A.state.pending);
  response=async()=>({ok:false,status:409,json:async()=>({error:{message:'conflict'}})});await A.persist({id:row.id,body:{...A.bodyOf(row),note:'stale'}});assert(A.state.pending);assert.match(E('status').textContent,/conflict/); // retain conflict draft
  A.state.pending=null;response=async()=>({ok:false,status:400,json:async()=>({error:{message:'invalid'}})});await A.persist({id:row.id,body:A.bodyOf(row)});assert(!A.state.pending);assert(!E('new').disabled);
  response=async()=>ok({bad:true});A.state.loaded=false;await A.load();assert(!A.state.loaded);assert.match(E('status').textContent,/格式异常/);
  let release;response=async()=>new Promise(resolve=>release=resolve);const old=A.load();account='two';windowListeners.storage({key:'studyflow.token'});release(ok([row]));await old;assert.equal(A.state.rows.length,0);assert(!A.state.loaded);assert.equal(E('note').value,'');assert(!E('dialog').open);
  console.log('Subscriptions passed: anchor dates/leap years, integer money, recurring forecasts, paging/escaping, payment progression, retry/conflict drafts, account isolation and dirty editor close.');
})().catch(e=>{console.error(e);process.exitCode=1;});
