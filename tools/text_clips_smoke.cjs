const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='internal/httpapi/assets/',html=fs.readFileSync(root+'index.html','utf8'),core=fs.readFileSync(root+'text-clips-core.js','utf8'),source=fs.readFileSync(root+'text-clips.js','utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));for(const [,id]of source.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('tc-'+id),id);
for(const name of ['text-clips-core.js','text-clips.js','text-clips.css'])assert(html.includes('/static/'+name)&&fs.existsSync(root+name));
const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function harness(){
 let owner='alice',counter=0,lose=false,failCopy=false,defer=false,release;const rows=new Map(),nodes=new Map(),calls=[],copied=[],windowEvents={},intervals=[],appended=[];
 class Node{
  constructor(id=''){this.id=id;this.value='';this.checked=false;this.hidden=false;this.textContent='';this.innerHTML='';this.disabled=false;this.readOnly=false;this.open=false;this.dataset={};this.listeners={};this.children={};this.classList={contains:cls=>id==='panel-transfers'?cls==='active':false};}
  addEventListener(type,fn){this.listeners[type]=fn;}setAttribute(key,value){this[key]=value;}querySelectorAll(){return[];}querySelector(selector){return this.children[selector]||(this.children[selector]=new Node());}focus(){}select(){this.selected=true;}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}reportValidity(){return true;}
  setRangeText(value,start,end){this.value=this.value.slice(0,start)+value+this.value.slice(end);}reset(){for(const id of ['title','text'])E(id).value='';E('ttl').value='24';E('pinned').checked=false;}
 }
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);},E=id=>node('tc-'+id);E('board').hidden=true;E('ttl').value='24';E('sort').value='updated';
 const document={hidden:false,getElementById:node,createElement:()=>new Node(),body:{append:n=>appended.push(n)},addEventListener(){},execCommand:()=>false};
 const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
 const window={addEventListener:(type,fn)=>windowEvents[type]=fn,setInterval:fn=>intervals.push(fn)};
 const fetch=async(path,options={})=>{calls.push({path,options,owner});const user=options.headers.Authorization.slice(7),id=path.split('/')[4]?.split('?')[0],key=user+':'+id;
  if(options.method==='PUT'){
   const body=JSON.parse(options.body),old=rows.get(key);if(old&&old.revision!==body.revision){if(old.revision===body.revision+1&&old.text===body.text&&old.title===body.title&&old.pinned===body.pinned&&old.deleted===body.deleted&&old.ttl_hours===body.ttl_hours)return response(200,{data:old});return response(409,{error:{message:'conflict'}});}
   const row={...body,id,user_id:user,revision:body.revision+1,created_at:old?.created_at||new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:body.ttl_hours?old&&old.ttl_hours===body.ttl_hours&&!body.renew?old.expires_at:new Date(Date.now()+body.ttl_hours*3600000).toISOString():'0001-01-01T00:00:00Z'};delete row.renew;rows.set(key,row);if(lose){lose=false;throw Error('ack lost');}return response(200,{data:row});
  }
  if(options.method==='DELETE'){if(!rows.has(key))return response(404,{error:{message:'not found'}});rows.delete(key);return response(204,null);}
  const out=response(200,{data:[...rows.values()].filter(row=>row.user_id===user),server_time:new Date().toISOString()});if(defer){defer=false;return new Promise(r=>release=()=>r(out));}return out;
 };
 const ctx=vm.createContext({window,document,console,Date,navigator:{clipboard:{writeText:async text=>{if(failCopy)throw Error('not allowed');copied.push(text);},readText:async()=>'<b>plain text</b>'}},fetch,localStorage:{getItem:()=>owner},crypto:{randomUUID:()=>`text-test-${++counter}`},confirm:()=>true,AbortController,setTimeout:()=>1,clearTimeout(){},MutationObserver:class{observe(){}},});
 vm.runInContext(core,ctx);vm.runInContext(source,ctx);
 const fire=async(id,type='click',event={})=>{await E(id).listeners[type]?.({preventDefault(){},...event});await settle();};
 const action=(kind,id)=>fire('list','click',{target:{closest:()=>({dataset:{tcAction:kind,tcId:id}})}});
 const field=(id,value)=>{E(id).value=value;E(id).listeners.input?.();};
 return {E,rows,calls,copied,appended,C:window.DaynestTextClips,fire,field,action,
  tab:value=>fire('tabs','click',{target:{closest:()=>({dataset:{tcTab:value}})}}),
  account:value=>{owner=value;windowEvents.storage({key:'studyflow.token'});},
  set lose(value){lose=value;},set failCopy(value){failCopy=value;},set defer(value){defer=value;},release:()=>release(),intervals};
}
(async()=>{
 const h=harness(),{E,C}=h;assert.equal(h.calls.length,0,'collapsed feature must not fetch on login');
 await h.fire('toggle');assert(!E('board').hidden);assert.equal(h.calls.length,1);
 h.field('text','<script>alert(1)</script>\n收件地址');h.field('title','家庭地址');h.lose=true;await h.fire('form','submit');assert(!E('recovery').hidden);assert(E('text').readOnly);assert.equal(h.rows.size,1);assert.match(E('status').textContent,/尚未确认/);
 await h.fire('retry');assert.equal(h.rows.size,1);assert(E('recovery').hidden);assert.equal(E('text').value,'');const row=[...h.rows.values()][0];assert(E('list').innerHTML.includes('&lt;script&gt;'));assert(!E('list').innerHTML.includes('<script>'));
 await h.action('copy',row.id);assert.equal(h.copied[0],row.text);
 await h.action('edit',row.id);h.field('text','我的新文字');h.rows.set('alice:'+row.id,{...row,text:'另一台设备的新文字',revision:2});await h.fire('form','submit');assert(!E('recovery').hidden);assert.equal(E('text').value,'我的新文字');
 await h.fire('reconcile');assert(!E('conflict').hidden);assert.match(E('remote').textContent,/另一台设备/);assert.equal(E('text').value,'我的新文字');
 await h.fire('rebase');assert(E('recovery').hidden);assert.equal(E('text').value,'我的新文字');await h.fire('form','submit');assert.equal(h.rows.get('alice:'+row.id).revision,3);assert.equal(h.rows.get('alice:'+row.id).text,'我的新文字');
 await h.action('trash',row.id);await h.tab('trash');assert(E('list').innerHTML.includes('恢复并保留 1 天'));await h.action('restore',row.id);await h.tab('active');assert.equal(h.rows.get('alice:'+row.id).deleted,false);
 h.failCopy=true;await h.action('copy',row.id);assert(h.appended[0].open);assert.equal(h.appended[0].querySelector('textarea').value,'我的新文字');
 h.field('text','尚未发送的新草稿');await h.action('pin',row.id);assert.equal(E('text').value,'尚未发送的新草稿');assert(h.rows.get('alice:'+row.id).pinned);await h.fire('new');
 await h.fire('paste');assert.equal(E('text').value,'<b>plain text</b>');assert.match(E('draft-state').textContent,/未保存/);
 h.account('bob');assert.equal(E('text').value,'');assert.equal(E('list').innerHTML.includes('我的新文字'),false);assert(!h.appended[0].open);assert.equal(h.appended[0].querySelector('textarea').value,'');
 h.defer=true;const loading=h.fire('toggle');await settle();h.account('charlie');h.release();await loading;assert.equal(E('list').innerHTML.includes('我的新文字'),false);
 const sample={...row,expires_at:new Date(Date.now()-1).toISOString()};assert(C.expired(sample));assert.equal(C.select([sample]).length,0);assert.equal(C.select([sample],{tab:'expired'}).length,1);assert.equal(C.expiry({...row,ttl_hours:0,expires_at:'0001-01-01T00:00:00Z'}),'一直保留');assert.equal(C.count('🌱字'),2);assert(!C.valid({...row,ttl_hours:2}));
 const clock=Date.now();assert.match(C.expiry({...row,expires_at:new Date(clock+86400001).toISOString()},clock),/1 天/);assert.match(C.expiry({...row,expires_at:new Date(clock+7*86400000+1).toISOString()},clock),/7 天/);
 console.log('Text clips passed: lazy loading, safe text rendering, lost-ack retry, conflict review/rebase, recycle/restore, copy/paste/manual fallback, Unicode/expiry and account/stale-response cleanup. Mocked DOM/HTTP/clipboard.');
})().catch(error=>{console.error(error);process.exitCode=1;});
