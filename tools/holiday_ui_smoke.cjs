const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='internal/httpapi/assets/',html=fs.readFileSync(root+'index.html','utf8'),script=fs.readFileSync(root+'holiday.js','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('holiday-'+m[1]),'missing DOM '+m[1]);
assert(!html.includes('id="toolkit-dates"'));assert(!html.includes('id="toolkit-tab-dates"'));
assert(html.includes('id="topbar-glance"'));assert(fs.readFileSync(root+'weather.js','utf8').includes('glance.prepend(widget)'));
assert(!fs.readFileSync(root+'toolkit-pocket.js','utf8').includes('dateInputs'));
for(const asset of ['holiday.js','holiday.css'])assert(html.includes('/static/'+asset)&&fs.existsSync(root+asset));
const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
let now=Date.parse('2026-10-09T04:00:00Z'),account='one',body,status=200,deferred=false;
const requests=[],pending=[],elements=new Map(),listeners={},windowListeners={},timers=new Set(),intervals=[];
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
function el(id){assert(ids.has(id),id);if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,open:false,listeners:{},classList:{contains:()=>false},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(type,fn){this.listeners[type]=fn;},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);}
const E=id=>el('holiday-'+id);
function data(confirmed=false){return {data:{today:'2026-10-09',timezone:'Asia/Shanghai',schedule_through:2026,current:null,next:{name:'元旦',start_date:'2027-01-01',end_date:'2027-01-01',confirmed,duration:confirmed?1:0,days_until:84,source_url:confirmed?'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html':''}}};}
body=data();
const context=vm.createContext({Date:Clock,Intl,URL,AbortController,console,localStorage:{getItem:()=>account},document:{hidden:false,getElementById:el,addEventListener:(type,fn)=>listeners[type]=fn},MutationObserver:class{observe(){}},window:{addEventListener:(type,fn)=>windowListeners[type]=fn,setInterval:fn=>intervals.push(fn),setTimeout(fn){timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn)},fetch:async(path,options)=>{requests.push({path,options});if(deferred)return new Promise(resolve=>pending.push(resolve));return {ok:status===200,status,json:async()=>body};}});
vm.runInContext(script,context);
(async()=>{
  await settle();assert.equal(requests.length,1);assert.equal(E('days').textContent,'84');assert.match(E('caption').textContent,/调休待更新/);assert(E('source').hidden);assert.equal(timers.size,0);
  E('trigger').listeners.click();assert(E('dialog').open);assert.equal(requests.length,1);E('close').listeners.click();assert(!E('dialog').open);
  body=data(true);body.data.next.source_url='javascript:alert(1)';await E('retry').listeners.click();assert(E('source').hidden);
  body=data(true);await E('retry').listeners.click();assert(!E('source').hidden);assert.match(E('detail-dates').textContent,/共 1 天/);
  status=404;await E('retry').listeners.click();assert.match(E('status').textContent,/重启 Go/);assert.equal(E('days').textContent,'—');assert(!E('retry').disabled);
  status=200;body={data:{}};await E('retry').listeners.click();assert.match(E('status').textContent,/数据不完整/);
  body=data();await E('retry').listeners.click();const count=requests.length;listeners.visibilitychange();await settle();assert.equal(requests.length,count);
  now=Date.parse('2026-10-09T16:00:00Z');body.data.today='2026-10-10';body.data.next.days_until=83;listeners.visibilitychange();await settle();assert.equal(E('days').textContent,'83');assert.equal(requests.length,count+1);
  deferred=true;const oldRequest=E('retry').listeners.click();account='two';windowListeners.storage({key:'studyflow.token'});assert(requests.at(-2).options.signal.aborted);
  pending[0]({ok:true,status:200,json:async()=>data(true)});await oldRequest;assert.equal(E('days').textContent,'—');
  pending[1]({ok:true,status:200,json:async()=>data()});await settle();assert.equal(E('days').textContent,'84');assert(E('source').hidden);assert.equal(requests.at(-1).options.headers.Authorization,'Bearer two');
  account='';windowListeners.storage({key:'studyflow.token'});assert.equal(E('days').textContent,'—');assert(!E('dialog').open);assert.equal(timers.size,0);
  console.log('Holiday UI passed: integration/removal, fallback and official labels, safe links, retry/404/malformed response, Beijing midnight, request caching, abort and stale-account isolation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
