const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('internal/httpapi/assets/app.js','utf8'),nodes=new Map();let app;
function node(key){if(nodes.has(key))return nodes.get(key);const n={value:'',textContent:'',innerHTML:'',disabled:false,checked:false,style:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},parentElement:{classList:{toggle(){}},setAttribute(){}},querySelector:()=>node('submit'),querySelectorAll:()=>[]};nodes.set(key,n);return n;}
const ctx={window:{setTimeout(){},clearTimeout(){},DaynestUI:{notify(){}}},document:{querySelector:node,querySelectorAll:()=>[],dispatchEvent(){}},console,Date,Intl,URLSearchParams,AbortController,Headers:class{set(){}has(){return false;}},CustomEvent:class{},localStorage:{getItem:k=>k==='studyflow.token'?app?.state.token||'':'',setItem(){},removeItem(){}}};
vm.runInNewContext(source.replace('  bootstrap();','  render=()=>{}; renderPlanner=()=>{}; window.test={state,refresh};'),ctx);app=ctx.window.test;app.state.user={id:'alice'};app.state.token='one';
const response=(data,status=200)=>({ok:status<400,status,json:async()=>({data})});
const route=path=>path==='/api/v1/focus-sessions/active'?response(null):path==='/api/v1/dashboard'?response({active_goals:2}):path.includes('/calendar?')?response({events:[]}):response([]);
async function flush(waiting, ...requests) {
 let complete=false;
 const result=Promise.all(requests).finally(()=>{complete=true;});
 for(let i=0;i<10&&!complete;i++){
   waiting.splice(0).forEach(resolve=>resolve());
   await new Promise(resolve=>setImmediate(resolve));
 }
 assert(complete,'refresh requests did not settle');
 await result;
}
(async()=>{
 let calls=[];ctx.fetch=async path=>{calls.push(path);return route(path);};await app.refresh();assert(calls.length>=9);assert(!calls.some(p=>/analytics|reviews\/weekly|goals|tasks|planner/.test(p)));calls=[];await app.refresh({background:true});assert.equal(calls.length,5);assert(!calls.some(p=>/analytics|reviews\/weekly|goals|tasks|planner|word-books|planner\/week/.test(p)));
 const waiting=[];calls=[];ctx.fetch=path=>{calls.push(path);return new Promise(resolve=>waiting.push(()=>resolve(route(path))));};const first=app.refresh({background:true}),second=app.refresh({background:true});await flush(waiting,first,second);assert.equal(calls.length,5,'background ticks must coalesce');
 calls=[];const beforeSwitch=app.refresh({background:true});app.state.currentView='moods';const afterSwitch=app.refresh({background:true}),alsoAfter=app.refresh({background:true});await flush(waiting,beforeSwitch,afterSwitch,alsoAfter);assert.equal(calls.length,9,'new page receives one follow-up batch after an in-flight old-page refresh');assert(calls.some(p=>p.includes('/moods/insights')));
 app.state.currentView='moods';calls=[];ctx.fetch=async path=>{calls.push(path);return route(path);};await app.refresh({background:true});assert(calls.some(p=>p.includes('/moods/insights')));assert(!calls.some(p=>p.includes('/reviews/weekly')));assert(!calls.some(p=>p.includes('/word-books')));
 console.log('Workflow quality passed: selective and coalesced refresh, active view catch-up, and no retired insights requests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
