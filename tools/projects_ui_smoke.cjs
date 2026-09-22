const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'../internal/httpapi/assets'),nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{},dataset:{},handlers:{},classList:{toggle(){},contains:()=>false},addEventListener(n,f){this.handlers[n]=f;},reset(){},focus(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);}
let token='alice',response,uuid=0;
const ctx={document:{querySelector:node,querySelectorAll:()=>[]},window:{addEventListener(){},confirm:()=>true},localStorage:{getItem:()=>token},crypto:{randomUUID:()=> 'uuid-card-'+(++uuid)},MutationObserver:class{observe(){}},AbortController,setTimeout,clearTimeout,fetch:(...a)=>response(...a)};
vm.createContext(ctx);let source=fs.readFileSync(path.join(root,'projects.js'),'utf8').replace(' sync();render();enter();',' window.test={state,render,checksOf,templateCards,visibleCards,activeCards,persist,request,changeCard};sync();render();enter();');vm.runInContext(source,ctx);const api=ctx.window.test;
const ok=data=>({ok:true,json:async()=>({data})});
(async()=>{
 assert.equal(api.checksOf('[x] Done\nNext')[0].done,true);assert.throws(()=>api.checksOf('[x]'));assert.throws(()=>api.checksOf(Array(21).fill('one').join('\n')));
 assert.equal(api.templateCards('travel').length,4);assert.equal(new Set(api.templateCards('launch').map(c=>c.id)).size,4);
 const card={id:'card-00000001',title:'<img src=x>',description:'text',status:'todo',priority:'high',due:'2026-01-01',checks:[{title:'step',done:false}],archived:false};
 const p={id:'project-00000001',title:'My project',description:'',color:'#537e78',archived:false,cards:[card],revision:1};
 api.state.items=[p];api.state.loaded=true;api.state.selected=p.id;api.render();assert(!node('#project-board').innerHTML.includes('<img'));assert(node('#project-board').innerHTML.includes('&lt;img'));
 node('#project-search').value='absent';assert.equal(api.visibleCards(p).length,0);node('#project-search').value='';
 response=async()=>{throw Error('offline');};node('#project-card-dialog').open=true;await api.persist({...p,title:'updated'},'project-card-dialog');assert(api.state.pending);assert(!node('#project-card-dialog').open);
 const pending=api.state.pending;response=async(url,opt)=>{assert.equal(JSON.parse(opt.body).title,'updated');assert(url.endsWith(pending.id));return ok({...p,title:'updated',revision:2});};await api.persist(null);assert(!api.state.pending);assert.equal(api.state.items.length,1);assert.equal(api.state.items[0].revision,2);
 response=async(url,opt)=>ok({...api.state.items[0],...JSON.parse(opt.body),revision:3});await api.changeCard(card.id,c=>c.status='doing');assert.equal(api.state.items[0].cards[0].status,'doing');
 api.state.items[0].archived=true;let calls=0;response=async()=>{calls++;return ok(p);};await api.changeCard(card.id,c=>c.status='done');assert.equal(calls,0);
 let release;response=()=>new Promise(r=>release=r);const stale=api.request();token='bob';release(ok([p]));await assert.rejects(stale,/账号已切换/);assert.equal(api.state.items.length,0);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys())assert(html.includes('id="'+id.slice(1)+'"'),id);
 console.log('Projects UI passed: templates, checklist limits, escaping, filtering, save retry, card movement, archive guard, account isolation and DOM wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});
