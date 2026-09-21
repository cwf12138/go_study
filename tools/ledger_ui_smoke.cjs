const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'../internal/httpapi/assets'),nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='#ledger-archive'?'active':id==='#ledger-sort'?'newest':'',textContent:'',innerHTML:'',dataset:{},style:{},handlers:{},open:false,disabled:false,classList:{contains:()=>false,toggle(){}},addEventListener(n,f){this.handlers[n]=f;},setAttribute(){},focus(){},reset(){},showModal(){this.open=true;},close(){this.open=false;},scrollIntoView(){}});return nodes.get(id);}
let token='alice',response;
const ctx={document:{querySelector:node},localStorage:{getItem:()=>token},window:{addEventListener(){},confirm:()=>true},MutationObserver:class{observe(){}},crypto:{randomUUID:()=> 'entry-test-00001'},AbortController,setTimeout,clearTimeout,fetch:(...args)=>response(...args)};
vm.createContext(ctx);const source=fs.readFileSync(path.join(root,'ledger.js'),'utf8');vm.runInContext(source.replace(' sync();render();enter();',' window.test={state,cents,totals,filtered,render,openEditor,save,load,request,csvCell};sync();render();enter();'),ctx);const api=ctx.window.test;
const ok=data=>({ok:true,json:async()=>({data})});
(async()=>{
 assert.equal(api.cents('0.01'),1);assert.equal(api.cents('12.30'),1230);for(const v of ['-1','0','1.001','1e2','100000001','abc'])assert.throws(()=>api.cents(v));
 node('#ledger-month').value='2026-09';
 const base={id:'entry-00001',kind:'expense',amount:1230,date:'2026-09-22',category:'餐饮',account:'现金',note:'<img onerror=x>',archived:false,revision:1};
 api.state.items=[base,{...base,id:'entry-00002',kind:'income',amount:5000},{...base,id:'entry-00003',archived:true,amount:999999}];api.state.loaded=true;api.render();
 assert.equal(api.totals(api.state.items).expense,1230);assert.equal(api.totals(api.state.items).income,5000);assert.equal(api.filtered().length,2);
 assert(!node('#ledger-list').innerHTML.includes('<img'));assert(node('#ledger-list').innerHTML.includes('&lt;img'));
 api.state.day='2026-09-21';assert.equal(api.filtered().length,0);api.state.day='';
 assert(api.csvCell('=HYPERLINK("x")').startsWith('"\''));assert(api.csvCell('  +cmd').startsWith('"\''));assert.equal(api.csvCell('a"b'),'"a""b"');
 api.openEditor(null);node('#ledger-entry-kind').value='expense';node('#ledger-amount').value='1.20';node('#ledger-date').value='2026-09-22';node('#ledger-entry-category').value='餐饮';node('#ledger-entry-account').value='现金';
 response=async()=>{throw Error('offline');};await api.save({preventDefault(){}});assert(api.state.pending);assert(node('#ledger-fields').disabled);const pending=api.state.pending;
 response=async(url,opt)=>{const body=JSON.parse(opt.body);assert.equal(body.amount,120);assert(url.endsWith(pending.id));return ok({...body,id:pending.id,revision:1});};
 await api.save({preventDefault(){}});assert(!api.state.pending);assert(!node('#ledger-dialog').open);assert.equal(api.state.items.filter(v=>v.id===pending.id).length,1);
 let release;response=()=>new Promise(r=>release=r);const inflight=api.request();token='bob';release(ok([]));await assert.rejects(inflight,/账号已切换/);assert.equal(api.state.items.length,0);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys())assert(html.includes('id="'+id.slice(1)+'"'),id);
 console.log('Ledger UI passed: integer amounts, totals, filters, escaped content, CSV safety, uncertain save retry, account isolation and DOM wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});
