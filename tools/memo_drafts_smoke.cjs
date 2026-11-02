const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'internal/httpapi/assets');
const C = require(path.join(dir, 'memo-drafts-core.js'));
class Storage {
  constructor() { this.map = new Map(); this.fail = false; }
  get length() { return this.map.size; } key(i) { return [...this.map.keys()][i] || null; }
  getItem(k) { return this.map.get(k) ?? null; }
  setItem(k, v) { if (this.fail && k.startsWith(C.prefix)) throw Object.assign(Error('full'), {name:'QuotaExceededError'}); this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
const storage = new Storage(), owner = C.scope('http://localhost:8080/', 'owner'), other = C.scope('http://localhost:8080', 'other');
const value = {title:'Draft <img onerror=alert(1)>',content:'未完成的长文字',folder_id:'',tags:['生活'],color:'mint'};
const note = {id:'memo-1',...value,content:'Server original',updated_at:'2026-11-02T01:00:00.000000001Z',created_at:'2026-11-01T00:00:00Z'};
const record = (id, generation=1) => ({version:1,id,noteID:note.id,generation,savedAt:Date.now(),baseUpdatedAt:note.updated_at,base:C.fields(note),value:{...value}});
const store = C.create(storage, owner), foreign = C.create(storage, other);
store.put(record('a')); store.put(record('b')); foreign.put(record('c'));
assert.equal(store.list().records.length, 2); assert.equal(foreign.list().records.length, 1);
const old = store.list().records.find(r=>r.id==='a'); store.put({...old,generation:2}); store.remove(old);
assert.equal(store.list().records.find(r=>r.id==='a').generation,2,'old save deleted a newer draft');
storage.setItem(C.prefix+owner+':broken','{invalid'); assert.equal(store.list().damaged,1);
store.clear(); assert.equal(store.list().records.length,0); assert.equal(foreign.list().records.length,1);
assert.equal(C.scope('http://user:pass@localhost','owner'),''); assert.equal(C.scope('file:///private','owner'),'');
assert.equal(C.scope('http://localhost:8080','owner'),owner); assert.notEqual(C.scope('http://another:8080','owner'),owner);
assert(C.accepted({...value,content:'text  \n',tags:[' Tag ','tag']},{...value,content:'text',tags:['tag']}));
assert(!C.equal(value,{...value,content:'different'}));
assert(!C.accepted({...value,title:''},{...value,title:'Unrelated title'}),'empty-title intent was discarded');
const interleaved=record('interleaved');store.put(interleaved);
const originalGet=storage.getItem.bind(storage);let inject=true;
storage.getItem=k=>{const result=originalGet(k);if(inject&&k.endsWith(':interleaved:1')){inject=false;store.put({...interleaved,generation:2,value:{...value,content:'new edit during cleanup'}});}return result;};
store.remove(interleaved);storage.getItem=originalGet;
assert.equal(store.list().records.find(r=>r.id==='interleaved').value.content,'new edit during cleanup');
store.remove(store.list().records.find(r=>r.id==='interleaved'));
for(let i=0;i<39;i++)store.put(record('budget-'+i));
assert.throws(()=>store.put(record('over-budget')),/空间已满/); assert.equal(store.list().records.length,39);
store.clear();
storage.fail=true;assert.throws(()=>store.put(record('quota')),/full/); storage.fail=false;
console.log('Draft storage passed: scope isolation, compare-and-delete, corruption retention, bounded quota, no eviction, normalization.');

function element() {
  const events = {}, classes = new Set();
  return {value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,dataset:{},events,
    classList:{add(...n){n.forEach(x=>classes.add(x));},remove(...n){n.forEach(x=>classes.delete(x));},contains:n=>classes.has(n),toggle(n,on){if(on===undefined)on=!classes.has(n);on?classes.add(n):classes.delete(n);return on;}},
    addEventListener(k,f){(events[k]||=[]).push(f);},setAttribute(){},focus(){},select(){},showModal(){this.open=true;},close(){this.open=false;(events.close||[]).forEach(f=>f({}));},
    async emit(k, event={}){for(const f of events[k]||[])await f(event);},click(){return this.emit('click');}};
}
function fixture(shared=storage, userID='owner', server='http://localhost:8080', late=false) {
  shared.setItem('studyflow.token','test-token');
  const elements=new Map(), documentEvents={}, windowEvents={};
  const el=k=>{k=k.startsWith('#')?k.slice(1):k;if(!elements.has(k))elements.set(k,element());return elements.get(k);};
  const document={getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:element,
    addEventListener(k,f){(documentEvents[k]||=[]).push(f);}};
  const window={DaynestMemoDrafts:C,DaynestMobile:{getConnectionInfo:()=>({server})},setTimeout:()=>1,clearTimeout(){},addEventListener(k,f){(windowEvents[k]||=[]).push(f);},confirm:()=>true};
  if(late){window.DaynestAccount={current:()=>({userID,token:'test-token',server})};el('panel-memos').classList.add('active');}
  const ctx={console,Date,Intl,URL,URLSearchParams,AbortController,Headers,Blob,crypto,CustomEvent:class{},localStorage:shared,location:{origin:server},document,window,confirm:()=>true,setTimeout:()=>1,clearTimeout(){}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(dir,'http-client.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(dir,'memo-drafts.js'),'utf8'),ctx);
  const script=fs.readFileSync(path.join(dir,'memos.js'),'utf8');
  vm.runInContext(script.replace('\n  bindEvents();\n})();','\n  window.__test = {state, selectMemo, markDirty, saveCurrent, syncAccount, patchAction};\n  bindEvents();\n})();'),ctx);
  const api=window.__test; let current={...note}, writes=[], copies=[];
  const response=data=>({status:200,ok:true,json:async()=>({data})});
  ctx.fetch=async(url,options={})=>{
    if(options.method==='PATCH'){
      const body=JSON.parse(options.body);writes.push(body);
      if(body.expected_updated_at!==current.updated_at)return {status:409,ok:false,json:async()=>({error:{code:'invalid_state'}})};
      current={...current,...body,updated_at:'2026-11-02T02:00:00.'+String(writes.length).padStart(9,'0')+'Z'};delete current.expected_updated_at;
      return response(current);
    }
    if(options.method==='POST') {const payload=JSON.parse(options.body);copies.push(payload);return response({...current,...payload,id:'copy-'+copies.length});}
    return response(url==='/api/v1/memos/'+note.id?current:url.includes('/overview')?{}:[]);
  };
  async function account(id=userID) {for(const f of documentEvents['daynest:account-ready']||[])await f({detail:{userID:id}});}
  const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
  return {ctx,api,el,window,shared,account,settle,writes,copies,setRemote:n=>current={...n},getRemote:()=>current};
}

(async()=>{
  const shared=new Storage(), first=fixture(shared);await first.account();await first.api.selectMemo(note.id);
  first.el('memo-content').value=value.content;first.api.markDirty();
  assert.equal(C.create(shared,owner).list().records.length,1);
  // Refresh creates a fresh writer and waits for the same account to be verified.
  const reloaded=fixture(shared);await reloaded.account();
  assert.equal(reloaded.writes.length,0,'loading replayed an offline write');
  await reloaded.el('memo-drafts-open').click();await reloaded.settle();
  assert.equal(reloaded.el('memo-drafts-text').value,value.content);assert(!reloaded.el('memo-drafts-restore').disabled);
  assert(reloaded.el('memo-drafts-list').innerHTML.includes('&lt;img'),'draft title was not escaped');
  await reloaded.el('memo-drafts-restore').click();
  assert.equal(reloaded.el('memo-content').value,value.content);assert(reloaded.api.state.manualSave);
  assert.equal(await reloaded.api.saveCurrent({quiet:true}),false,'navigation implicitly submitted recovered text');
  assert.equal(reloaded.writes.length,0);
  assert(await reloaded.api.saveCurrent());assert.equal(C.create(shared,owner).list().records.length,0,'saved recovery left source drafts');
  console.log('Draft recovery passed: reload, escaped preview, manual confirmation, successful-save cleanup.');

  const a=fixture(shared), b=fixture(shared);await a.account();await b.account();
  a.setRemote(note);b.setRemote(note);await a.api.selectMemo(note.id);await b.api.selectMemo(note.id);
  a.el('memo-content').value='tab A';a.api.markDirty();b.el('memo-content').value='tab B';b.api.markDirty();
  assert.equal(C.create(shared,owner).list().records.length,2,'tabs overwrote a shared record key');
  await a.api.saveCurrent();assert.equal(C.create(shared,owner).list().records[0].value.content,'tab B','one tab deleted another tab draft');
  b.setRemote({...note,content:'remote change',updated_at:'2026-11-02T03:00:00Z'});
  assert.equal(await b.api.saveCurrent(),false);assert(b.api.state.dirty&&b.api.state.manualSave);
  await b.el('memo-drafts-open').click();await b.settle();
  assert(b.el('memo-drafts-restore').disabled,'conflicting content allowed direct restoration');
  assert.equal(b.el('memo-drafts-server-text').value,'remote change');
  await b.el('memo-drafts-copy').click();assert.equal(b.copies[0].content,'tab B');assert.equal(b.getRemote().content,'remote change');
  console.log('Draft conflict passed: independent writers, atomic conflict UI, separate copy preserves remote.');

  const race=fixture(new Storage());await race.account();await race.api.selectMemo(note.id);
  race.el('memo-content').value='first';race.api.markDirty();
  const normal=race.ctx.fetch;let release;race.ctx.fetch=async(u,o={})=>{if(o.method==='PATCH'&&!release)await new Promise(r=>release=r);return normal(u,o);};
  const pending=race.api.saveCurrent({quiet:true});race.el('memo-content').value='latest while pending';race.api.markDirty();
  assert.equal(C.create(race.shared,owner).list().records[0].value.content,'latest while pending');release();await pending;
  assert.equal(race.writes.length,2);assert.equal(race.getRemote().content,'latest while pending');assert.equal(C.create(race.shared,owner).list().records.length,0);
  race.shared.fail=true;race.el('memo-content').value='quota text';race.api.markDirty();assert(race.api.state.dirty);assert(race.el('memo-drafts-local-state').textContent.includes('空间不足'));
  race.shared.fail=false;race.api.markDirty();const oldScopeCount=C.create(race.shared,owner).list().records.length;
  race.shared.setItem('studyflow.token','new-token');await race.account('another-owner');
  assert.equal(race.el('memo-content').value,'');assert.equal(race.el('memo-drafts-list').innerHTML.includes('quota text'),false);assert.equal(C.create(race.shared,owner).list().records.length,oldScopeCount);
  await race.account('owner');assert(race.el('memo-drafts-list').innerHTML.includes('quota text'),'token renewal lost stable account scope');
  race.window.DaynestMobile.getConnectionInfo=()=>({server:'http://another:8080'});race.api.syncAccount();assert(!race.el('memo-drafts-list').innerHTML.includes('quota text'));
  assert(![...race.shared.map.keys()].some(k=>k.includes('test-token')||k.includes('new-token')));
  console.log('Draft race/error passed: pending edits, quota honesty, account and server changes, stable token renewal.');

  const disabled=fixture(new Storage());await disabled.account();await disabled.api.selectMemo(note.id);
  disabled.el('memo-drafts-enabled').checked=false;await disabled.el('memo-drafts-enabled').emit('change');disabled.el('memo-content').value='memory only';disabled.api.markDirty();
  assert.equal(C.create(disabled.shared,owner).list().records.length,0);assert(disabled.api.state.dirty);
  console.log('Draft opt-out passed: no persistence, editor and unsaved guard retained.');
  const unknown=fixture(new Storage());await unknown.account();await unknown.api.selectMemo(note.id);
  unknown.el('memo-content').value='accepted but response lost';unknown.api.markDirty();
  const deliver=unknown.ctx.fetch;let drop=true;
  unknown.ctx.fetch=async(u,o={})=>{const response=await deliver(u,o);if(o.method==='PATCH'&&drop){drop=false;throw Error('response lost');}return response;};
  assert.equal(await unknown.api.saveCurrent(),false);assert.equal(unknown.getRemote().content,'accepted but response lost');
  assert(C.create(unknown.shared,owner).list().records.length,'unknown outcome discarded draft');
  assert.equal(await unknown.api.saveCurrent(),false,'stale version should conflict after response loss');
  await unknown.el('memo-drafts-open').click();await unknown.settle();assert.equal(unknown.el('memo-drafts-restore').textContent,'打开并核对');
  await unknown.el('memo-drafts-restore').click();assert(!unknown.api.state.dirty);assert.equal(C.create(unknown.shared,owner).list().records.length,0);
  const stale=fixture(new Storage());await stale.account();await stale.api.selectMemo(note.id);
  stale.el('memo-content').value='old account pending';stale.api.markDirty();let rejectOld;
  stale.ctx.fetch=()=>new Promise((_r,reject)=>rejectOld=reject);const oldSave=stale.api.saveCurrent();
  stale.shared.setItem('studyflow.token','new-account-token');await stale.account('new-owner');
  stale.el('memo-save-state').innerHTML='new account status';rejectOld(Error('old account failure'));await oldSave;
  assert.equal(stale.el('memo-save-state').innerHTML,'new account status','old account failure replaced new status');
  assert(!stale.api.state.dirty&&!stale.api.state.saving);
  console.log('Draft unknown-outcome and stale response passed: retained text, server comparison, account epoch protection.');
  const late=fixture(new Storage(),'owner','http://localhost:8080',true);await late.settle();
  assert.equal(late.el('memo-drafts-open').disabled,false,'late script missed the verified account');
  assert(late.api.state.initialized,'late memo script failed to initialize its visible panel');
  console.log('Draft late-subscriber passed: fast authenticated startup initializes drafts and list without replaying global account events.');
  const lan=fixture(new Storage());await lan.account();await lan.api.selectMemo(note.id);
  lan.ctx.crypto={getRandomValues:values=>crypto.getRandomValues(values)};
  lan.el('memo-content').value='LAN HTTP edit';lan.api.markDirty();
  assert(C.create(lan.shared,owner).list().records[0].id.startsWith('draft-'));
  assert(await lan.api.saveCurrent());assert.equal(lan.getRemote().content,'LAN HTTP edit');
  console.log('Draft LAN HTTP passed: secure random ID fallback without randomUUID; saving remains available.');
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  for(const name of ['memo-drafts.js','memo-drafts-core.js']){const script=fs.readFileSync(path.join(dir,name),'utf8');for(const [,id] of script.matchAll(/\$\("([^"]+)"\)/g))assert(html.includes(`id="memo-drafts-${id}"`),`Missing draft element ${id}`);}
})().catch(e=>{console.error(e);process.exitCode=1;});
