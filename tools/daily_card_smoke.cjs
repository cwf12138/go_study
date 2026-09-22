const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'../internal/httpapi/assets'),nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{},handlers:{},classList:{contains:()=>false,toggle(){}},addEventListener(n,f){this.handlers[n]=f;},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},getBoundingClientRect(){return {left:100,right:500,top:100,bottom:600};}});return nodes.get(id);}
let token='',response;const ctx={document:{querySelector:node,addEventListener(){}},localStorage:{getItem:()=>token},window:{addEventListener(){},setInterval(){}},MutationObserver:class{observe(){}},Intl,AbortController,setTimeout,clearTimeout,fetch:(...args)=>response(...args)};
vm.createContext(ctx);const source=fs.readFileSync(path.join(root,'daily-card.js'),'utf8');vm.runInContext(source.replace(' sync();render();enter();',' window.test={state,run,today};sync();render();enter();'),ctx);const api=ctx.window.test;
const card={kind:'daily',date:api.today(),title:'大吉',body:'愿今日顺意。'};
const ok=data=>({ok:true,json:async()=>({data})});
(async()=>{
 assert(!node('#daily-dialog').open);token='alice';
 response=async()=>ok({...card,body:''});await api.run();assert(!node('#daily-draw').disabled);
 let count=0;response=async()=>{count++;return ok(card);};const drawing=api.run(true);await api.run(true);await drawing;assert.equal(count,1);assert.equal(node('#daily-luck').textContent,'大吉');assert(node('#daily-draw').disabled);assert.equal(node('#daily-trigger-label').textContent,'今日签 · 大吉');
 node('#daily-trigger').handlers.click();assert(node('#daily-dialog').open);assert.equal(count,1);node('#daily-close').handlers.click();assert(!node('#daily-dialog').open);
 node('#daily-trigger').handlers.click();const backdrop={target:node('#daily-dialog'),clientX:10,clientY:10};node('#daily-dialog').handlers.pointerdown(backdrop);node('#daily-dialog').handlers.click(backdrop);assert(!node('#daily-dialog').open);
 await api.run(true);assert.equal(count,1);
 await api.run();assert.equal(api.state.card.title,'大吉');
 let release;response=()=>new Promise(r=>release=r);const pending=api.run();token='bob';release(ok(card));await pending;assert.equal(api.state.card,null);assert.equal(node('#daily-trigger-label').textContent,'今日签');assert(!node('#daily-dialog').open);
 response=async()=>{throw Error('offline');};await api.run();assert.equal(api.state.loaded,false);assert(node('#daily-draw').disabled);
 response=async()=>ok(card);await api.run();assert(api.state.loaded);assert(node('#daily-draw').disabled);
 api.state.date='2026-01-01';let method;response=async(url,options)=>{method=options.method;return ok({...card,body:''});};await api.run(true);assert.equal(method,'GET');assert(!api.state.card);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys())assert(html.includes('id="'+id.slice(1)+'"'),id);
 assert(!html.includes('id="panel-daily"'));assert(!html.includes('data-view="daily"'));
 for(const id of ['daily-form','daily-favorites','daily-download','daily-theme','daily-reflection'])assert(!html.includes('id="'+id+'"'));
 console.log('Simple daily draw passed: once-only, restore, account isolation, failure retry, midnight recheck and minimal DOM.');
})().catch(e=>{console.error(e);process.exitCode=1;});
