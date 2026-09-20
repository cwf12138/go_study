const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'../internal/httpapi/assets'),nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{},handlers:{},classList:{contains:()=>false,toggle(){}},addEventListener(n,f){this.handlers[n]=f;}});return nodes.get(id);}
let token='alice',response;const ctx={document:{querySelector:node,addEventListener(){}},localStorage:{getItem:()=>token},window:{addEventListener(){},setInterval(){}},MutationObserver:class{observe(){}},Intl,AbortController,setTimeout,clearTimeout,fetch:(...args)=>response(...args)};
vm.createContext(ctx);const source=fs.readFileSync(path.join(root,'daily-card.js'),'utf8');vm.runInContext(source.replace(' sync();render();enter();',' window.test={state,run,today};sync();render();enter();'),ctx);const api=ctx.window.test;
const card={kind:'daily',date:api.today(),title:'大吉',body:'愿今日顺意。'};
const ok=data=>({ok:true,json:async()=>({data})});
(async()=>{
 response=async()=>ok({...card,body:''});await api.run();assert(!node('#daily-draw').disabled);
 let count=0;response=async()=>{count++;return ok(card);};const drawing=api.run(true);await api.run(true);await drawing;assert.equal(count,1);assert.equal(node('#daily-luck').textContent,'大吉');assert(node('#daily-draw').disabled);
 await api.run(true);assert.equal(count,1);
 await api.run();assert.equal(api.state.card.title,'大吉');
 let release;response=()=>new Promise(r=>release=r);const pending=api.run();token='bob';release(ok(card));await pending;assert.equal(api.state.card,null);
 response=async()=>{throw Error('offline');};await api.run();assert.equal(api.state.loaded,false);assert(node('#daily-draw').disabled);
 response=async()=>ok(card);await api.run();assert(api.state.loaded);assert(node('#daily-draw').disabled);
 api.state.date='2026-01-01';let method;response=async(url,options)=>{method=options.method;return ok({...card,body:''});};await api.run(true);assert.equal(method,'GET');assert(!api.state.card);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys())assert(html.includes('id="'+id.slice(1)+'"'),id);
 for(const id of ['daily-form','daily-favorites','daily-download','daily-theme','daily-reflection'])assert(!html.includes('id="'+id+'"'));
 console.log('Simple daily draw passed: once-only, restore, account isolation, failure retry, midnight recheck and minimal DOM.');
})().catch(e=>{console.error(e);process.exitCode=1;});
