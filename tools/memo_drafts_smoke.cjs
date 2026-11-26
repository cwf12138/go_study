const assert = require('node:assert/strict'), path = require('node:path');
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
