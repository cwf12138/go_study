const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'internal/httpapi/assets/index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'internal/httpapi/assets/bookmarks.js'),'utf8');
const styles=fs.readFileSync(path.join(root,'internal/httpapi/assets/bookmarks.css'),'utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has('bookmark-'+m[1]),'missing '+m[1]);
for(const id of ['search','sort'])assert.ok(ids.has('bookmark-'+id));
for(const marker of ['data-view="bookmarks"','/static/bookmarks.js?v=20261011-2','/static/bookmarks.css?v=20261007-1'])assert.ok(html.includes(marker));
for(const marker of ['prefers-reduced-motion','data-theme="dark"','max-width:640px','focus-visible'])assert.ok(styles.includes(marker));
const nodes=new Map();
function node(id){
  if(!nodes.has(id))nodes.set(id,{value:id==='bookmark-sort'?'newest':'',checked:false,disabled:false,hidden:false,innerHTML:'',textContent:'',open:false,events:{},
    classList:{toggle(){},contains(){return false;}},querySelectorAll(){return[];},close(){this.open=false;},showModal(){this.open=true;},reset(){},focus(){},
    addEventListener(type,fn){this.events[type]=fn;}});
  return nodes.get(id);
}
let owner='alice',failure=false,puts=[],status=200,allowClose=true;
const windowEvents={},observers=[];
const sample={id:'bookmark-01',url:'https://example.com/',title:'Example',folder:'工具',note:'Useful',revision:1,pinned:false,read:false,deleted:false,created_at:'2026-10-07T00:00:00Z'};
let responseRows=[sample];
const ctx=vm.createContext({URL,Blob:global.Blob,AbortController,Date,console,localStorage:{getItem:()=>owner},setTimeout:()=>1,clearTimeout(){},confirm:()=>allowClose,crypto:{randomUUID:()=> 'bookmark-new'},navigator:{},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},
  window:{addEventListener(type,fn){windowEvents[type]=fn;}},document:{getElementById:node,querySelector:()=>node('nav')},
  fetch:async(url,options)=>{
    if(options.method==='PUT'){puts.push({url,body:JSON.parse(options.body)});if(failure)throw new Error('network disconnected');return{ok:status===200,status,json:async()=>({data:{...sample,...JSON.parse(options.body),id:url.split('/').pop(),revision:JSON.parse(options.body).revision+1},error:{message:'save rejected'}})};}
    return{ok:true,json:async()=>({data:responseRows})};
  }
});
vm.runInContext(script.replace("  render();if(panel.classList.contains('active'))load();","  globalThis.testing={state,load,persist,render,filtered,safeURL,sync,edit,newID};"),ctx);
(async()=>{
  const t=ctx.testing;
  await t.load();assert.equal(t.state.rows.length,1);assert.equal(node('bookmark-new').disabled,false);
  responseRows=[null];await t.load();assert.equal(t.state.rows.length,1);assert.match(node('bookmark-status').textContent,/格式异常/);responseRows=[sample];
  delete ctx.crypto.randomUUID;ctx.crypto.getRandomValues=bytes=>bytes.fill(7);assert.match(t.newID(),/^bookmark-[0-9a-f]{32}$/);
  delete ctx.crypto.getRandomValues;assert.throws(()=>t.newID(),/无法生成/);ctx.crypto.randomUUID=()=> 'bookmark-new';
  t.edit();assert.equal(node('bookmark-dialog').open,true);
  node('bookmark-form').events.input();allowClose=false;node('bookmark-close').events.click();assert.equal(node('bookmark-dialog').open,true);
  let blocked=false;node('bookmark-dialog').events.cancel({preventDefault(){blocked=true;}});assert(blocked);
  blocked=false;windowEvents.beforeunload({preventDefault(){blocked=true;}});assert(blocked);
  allowClose=true;node('bookmark-close').events.click();assert.equal(node('bookmark-dialog').open,false);t.edit();
  const request={id:'bookmark-new',body:{...sample,revision:0}};
  failure=true;await t.persist(request);assert.ok(t.state.pending);assert.equal(node('bookmark-new').disabled,true);assert.equal(node('bookmark-recovery').hidden,false);
  failure=false;await t.persist(null);assert.equal(t.state.pending,null);assert.deepEqual(puts[0],puts[1]);assert.equal(t.state.rows.length,2);assert.equal(node('bookmark-dialog').open,false);
  status=409;await t.persist({id:sample.id,body:{...sample}});assert.ok(t.state.pending,'conflict retains exportable draft');
  node('bookmark-close').events.click();assert.ok(t.state.pending,'closing does not lose conflicted request');
  status=400;await t.persist(null);assert.equal(t.state.pending,null,'validation failure unlocks correction');status=200;
  t.state.rows=Array.from({length:25},(_,i)=>({...sample,id:'bookmark-'+i,title:'Link '+i,pinned:i===24,read:i%2===0}));
  t.render();assert.equal((node('bookmark-grid').innerHTML.match(/class="bookmark-card"/g)||[]).length,12);assert.match(node('bookmark-page').textContent,/1 \/ 3/);assert.equal(t.filtered()[0].id,'bookmark-24');
  t.state.view='unread';t.render();assert.equal(t.filtered().length,12);
  node('bookmark-search').value='not found';t.render();assert.equal(t.filtered().length,0);assert.equal(node('bookmark-next').disabled,true);
  node('bookmark-search').value='';t.state.view='all';t.state.rows=[{...sample,title:'<script>alert(1)</script>',note:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)'}];t.render();
  assert.ok(!node('bookmark-grid').innerHTML.includes('<script>'));assert.ok(!node('bookmark-grid').innerHTML.includes('href="javascript:'));assert.equal(t.safeURL('https://user:password@example.com'),'');
  owner='bob';observers.at(-1)();assert.equal(t.state.rows.length,0);assert.equal(t.state.pending,null);assert.equal(node('bookmark-dialog').open,false);
  await t.load();node('logout').events.click();assert.equal(t.state.rows.length,0);assert.equal(node('bookmark-new').disabled,true);
  console.log('bookmarks UI passed: selectors, load, modal, uncertain-save retry, pagination, filters, URL/XSS protection, account reset');
})().catch(err=>{console.error(err);process.exitCode=1;});
