/* No real notifications, user records or network: deterministic browser harness. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
process.env.TZ='Asia/Shanghai';
const root='internal/httpapi/assets/',html=fs.readFileSync(root+'index.html','utf8'),core=fs.readFileSync(root+'gentle-reminders-core.js','utf8'),script=fs.readFileSync(root+'gentle-reminders.js','utf8'),css=fs.readFileSync(root+'gentle-reminders.css','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for(const [,id]of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('gr-'+id),'missing DOM '+id);
for(const f of ['gentle-reminders-core.js','gentle-reminders.js','gentle-reminders.css'])assert(html.includes('/static/'+f));
assert(html.indexOf('/static/gentle-reminders-core.js')<html.indexOf('/static/gentle-reminders.js'));
assert(!html.includes('data-view="gentle-reminders"'),'reminders should not add a sidebar page');
for(const marker of ['prefers-reduced-motion','data-theme="dark"','max-width:760px','focus-visible','[hidden]'])assert(css.includes(marker));
assert(!/\beval\s*\(|new Function\s*\(|\bfetch\s*\(/.test(core+script));
assert(fs.readFileSync(root+'app.js','utf8').includes('daynest:focus-changed'));
let now=Date.parse('2026-10-22T10:00:00+08:00'),permissionRequests=0;
const store=new Map(),sent=[],lockQueues=new Map(),key=id=>'daynest.gentle-reminders.v1.'+id;
const jwt=id=>'x.'+Buffer.from(JSON.stringify({sub:id})).toString('base64url')+'.x';
store.set('studyflow.token',jwt('alice'));
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
class Notice{static permission='granted';static async requestPermission(){permissionRequests++;return this.permission;}constructor(title,options){this.title=title;this.options=options;this.closed=false;sent.push(this);}close(){this.closed=true;}}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
function browser({withLocks=true}={}){
  const nodes=new Map(),events={},winEvents={},observers=[];let focused=true;
  const doc={hidden:false,activeElement:null,hasFocus:()=>focused,contains:()=>true,getElementById:node,addEventListener(k,f){(events[k]??=[]).push(f);}};
  function node(id){if(nodes.has(id))return nodes.get(id);const match=html.match(new RegExp('<[^>]*\\bid="'+id+'"[^>]*>')),tag=match?.[0]||'',classes=new Set((tag.match(/class="([^"]+)"/)?.[1]||'').split(/\s+/));
    const n={id,value:tag.match(/\bvalue="([^"]*)"/)?.[1]||'',checked:/\bchecked\b/.test(tag),hidden:/\bhidden\b/.test(tag),disabled:/\bdisabled\b/.test(tag),textContent:'',innerHTML:'',open:false,style:{},dataset:{},handlers:{},contains:()=>false,classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},setAttribute(k,v){this[k]=v;},addEventListener(k,f){(this.handlers[k]??=[]).push(f);},close(){this.open=false;},showModal(){this.open=true;},focus(){doc.activeElement=this;}};
    if(id==='gr-snooze-minutes')n.value='5';nodes.set(id,n);return n;}
  node('app-view').classList.remove('hidden');
  const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const navigator={locks:withLocks?{request(name,fn){const result=(lockQueues.get(name)||Promise.resolve()).catch(()=>{}).then(fn);lockQueues.set(name,result);return result;}}:undefined};
  const win={isSecureContext:true,setInterval(){},focus(){focused=true;},addEventListener(k,f){(winEvents[k]??=[]).push(f);}};
  const ctx=vm.createContext({console,Date:Clock,Intl,Number,JSON,Math,window:win,document:doc,navigator,localStorage,Notification:Notice,atob:x=>Buffer.from(x,'base64').toString(),confirm:()=>true,MutationObserver:class{constructor(f){observers.push(f);}observe(){} }});
  vm.runInContext(core,ctx);
  vm.runInContext(script.replace('  formFromData(); sync(); render(); tick(); window.setInterval(tick,1000);','  window.testing={get data(){return data;},get owner(){return owner;},get dirty(){return dirty;},read,act,tick,sync,render,open,signedOut,transaction}; formFromData(); sync(); render(); tick(); window.setInterval(tick,1000);'),ctx);
  return {C:win.DaynestReminders,A:win.testing,node,doc,events,winEvents,ctx,focus:v=>{focused=v;},fire:async(id,event='click',arg={})=>{for(const f of node(id).handlers[event]||[])await f({preventDefault(){},target:{closest:()=>null},...arg});await settle();},storage:async k=>{for(const f of winEvents.storage||[])f({key:k});await settle();}};
}
(async()=>{
 const b=browser();await settle();const {C,A}=b,M=C.MINUTE,start=now;
 assert(!A.data.running);assert.equal(permissionRequests,0);assert.equal(store.get(key('alice')),undefined);
 assert.throws(()=>C.parse('{broken'));
 assert.throws(()=>C.parse(JSON.stringify({...C.fresh(),history:[{kind:'x',at:now}]})));
 for(const minutes of [0,4,181,5.2,NaN,Infinity]){const s=C.fresh();s.channels.water.minutes=minutes;assert.throws(()=>C.validateSettings(s));}
 let s=C.fresh();s.window={enabled:true,start:'22:00',end:'07:00'};
 assert(C.inWindow(s,Date.parse('2026-10-22T23:00:00+08:00')));assert(C.inWindow(s,Date.parse('2026-10-23T06:59:00+08:00')));assert(!C.inWindow(s,Date.parse('2026-10-23T07:00:00+08:00')));
 s.window.start='24:00';assert.throws(()=>C.validateSettings(s));s.window.start=s.window.end;assert.throws(()=>C.validateSettings(s));
 await A.act('start');assert(A.data.running);assert.equal(A.data.channels.water.dueAt,start+45*M);
 now+=12*M;await A.act('pause');assert(!A.data.running);assert.equal(A.data.channels.water.remaining,33*M);
 now+=120*M;await A.act('start');assert.equal(A.data.channels.water.dueAt,now+33*M);
 const refreshed=browser();await settle();assert.equal(refreshed.A.data.channels.water.dueAt,A.data.channels.water.dueAt);
 now+=33*M;store.set('studyflow.focus',JSON.stringify({userID:'alice',status:'running',phase:'focus_first',phaseStartedAt:new Clock().toISOString(),phaseRemainingSeconds:1500}));
 await A.tick();assert(A.data.channels.water.pendingAt);assert(b.node('gr-nudge').hidden,'focus should defer nudge');assert(!A.data.channels.water.notified);
 const f=JSON.parse(store.get('studyflow.focus'));assert(C.focusBlocked(f,'alice',now));assert(!C.focusBlocked(f,'bob',now));assert(!C.focusBlocked({...f,status:'paused'},'alice',now));assert(!C.focusBlocked({...f,phase:'break'},'alice',now));assert(!C.focusBlocked(f,'alice',now+25*M));
 store.set('studyflow.focus',JSON.stringify({...f,phase:'break'}));await A.tick();assert(!b.node('gr-nudge').hidden);assert(A.data.channels.water.notified);assert.equal(sent.length,0,'foreground should not send OS notification');
 const cycle=A.data.channels.water.cycle;await A.act('snooze','water',cycle);assert.equal(A.data.history.length,0);assert.equal(A.data.channels.water.dueAt,now+5*M);assert(!A.data.channels.water.pendingAt);
 now+=5*M;await A.tick();const doneCycle=A.data.channels.water.cycle;
 await Promise.all([A.act('done','water',doneCycle),refreshed.A.act('done','water',doneCycle)]);await A.tick();assert.equal(A.data.history.length,1,'same cycle must not double count across tabs');assert.equal(A.data.channels.water.dueAt,now+45*M);
 await A.act('done','water',A.data.channels.water.cycle);assert.equal(A.data.history.length,1,'accidental manual double click must not double count');
 const oldDue=A.data.channels.water.dueAt, cfg=JSON.parse(JSON.stringify(A.data));cfg.deferFocus=false;
 assert(await A.transaction((s,t)=>C.change(s,{type:'settings',settings:cfg,configRevision:s.configRevision},t)));assert.equal(A.data.channels.water.dueAt,oldDue,'unmodified intervals must not restart');
 const waterDue=A.data.channels.water.dueAt;const changed=JSON.parse(JSON.stringify(A.data));changed.channels.move.minutes=90;
 assert(await A.transaction((s,t)=>C.change(s,{type:'settings',settings:changed,configRevision:s.configRevision},t)));assert.equal(A.data.channels.water.dueAt,waterDue);assert.equal(A.data.channels.move.dueAt,now+90*M);
 assert.equal(await A.transaction((s,t)=>C.change(s,{type:'settings',settings:cfg,configRevision:0},t)),false,'stale settings must not overwrite');
 b.node('gr-water-minutes').value='35';await b.fire('gr-form','input');assert(A.dirty);await b.fire('gr-toggle');assert(!A.data.running,'pause should work even with unsaved draft');assert(A.dirty);
 await b.fire('gr-toggle');assert(b.node('gr-error').textContent.includes('先保存'));assert(!A.data.running);
 b.node('gr-snooze-minutes').value='10';await b.fire('gr-form','submit');assert(!A.dirty);assert.equal(A.data.channels.water.minutes,35);assert.equal(A.data.snoozeMinutes,10);await A.act('start');
 // Both due after a long suspension: only one pending item per channel, never a backlog.
 now+=10*24*60*M;await A.tick();assert.equal(A.data.history.length,0);assert(A.data.channels.water.pendingAt&&A.data.channels.move.pendingAt);
 const pendingAt=A.data.channels.water.pendingAt;await A.tick();assert.equal(A.data.channels.water.pendingAt,pendingAt);assert.equal(sent.length,0);
 await A.act('skip','water',A.data.channels.water.cycle);assert.equal(A.data.history.length,0);assert(!A.data.channels.water.pendingAt);
 // Local quiet hours suppress, but don't fake a completion or silently lose a due reminder.
 let quiet=JSON.parse(JSON.stringify(A.data));quiet.window={enabled:true,start:'00:00',end:'00:01'};
 await A.transaction((s,t)=>C.change(s,{type:'settings',settings:quiet,configRevision:s.configRevision},t));await A.tick();assert(b.node('gr-nudge').hidden);assert(A.data.channels.move.pendingAt);
 quiet.window.enabled=false;quiet.notifications=true;
 await A.transaction((s,t)=>C.change(s,{type:'settings',settings:quiet,configRevision:s.configRevision},t));
 await A.act('skip','move',A.data.channels.move.cycle);b.doc.hidden=true;refreshed.doc.hidden=true;now+=95*M;
 await Promise.all([A.tick(),refreshed.A.tick()]);assert.equal(sent.length,2,'one OS notice per channel across tabs');assert(sent.every(n=>n.options.silent));
 await Promise.all([A.tick(),refreshed.A.tick()]);assert.equal(sent.length,2,'no repeat notifications for pending reminders');
 // User logout synchronously marks a stop, invalidates queues and scrubs private UI.
 const beforeLogout=now;A.signedOut();store.delete('studyflow.token');assert.equal(A.owner,'');assert(b.node('gr-nudge').hidden);assert.equal(b.node('gr-history-list').innerHTML,'<li class="gr-empty">今天还没有记录。不用追求次数，照顾好自己就好。</li>');assert(sent.every(n=>n.closed));
 now+=24*60*M;store.set('studyflow.token',jwt('alice'));A.sync();assert(!A.data.running);assert.equal(A.data.channels.water.remaining,Math.max(0,waterDue-beforeLogout));
 await A.act('start');assert(!store.has(key('alice')+'.stopped'));assert(A.data.running);
 // Another account never inherits the first account's settings or history.
 store.set('studyflow.token',jwt('bob'));A.sync();assert.equal(A.owner,'bob');assert(!A.data.running);assert.equal(A.data.channels.water.minutes,45);assert.equal(A.data.history.length,0);
 const late=A.act('start');store.set('studyflow.token',jwt('charlie'));A.sync();await late;assert.equal(store.get(key('bob')),undefined,'queued old-account mutation must not persist');
 // Corrupt local data is not overwritten automatically; reset is explicit and scoped.
 store.set(key('charlie'),'{broken');await A.tick();assert(b.node('gr-nudge').hidden);assert.equal(store.get(key('charlie')),'{broken');assert(b.node('gr-toggle').disabled);
 await b.fire('gr-reset');assert.equal(store.get(key('charlie')),undefined);assert(!b.node('gr-toggle').disabled);assert(store.has(key('alice')),'reset must not delete another account');
 // No Web Locks: foreground-only fallback, no system notifications or auto permission.
 const fallback=browser({withLocks:false});await settle();assert(fallback.node('gr-notifications').disabled);await fallback.A.act('start');fallback.doc.hidden=true;now+=60*M;await fallback.A.tick();assert.equal(sent.length,2);
 assert.equal(permissionRequests,0);
 console.log('Gentle reminders passed: assets/DOM, opt-in, intervals, pause/resume/refresh, focus/break integration, snooze/skip, serialized cross-tab acknowledgement and delivery, settings conflict protection, quiet hours/cross-midnight, sleep recovery, local-day retention, account isolation/logout/late writes, corruption fail-closed/reset and foreground fallback.');
})().catch(e=>{console.error(e);process.exitCode=1;});
