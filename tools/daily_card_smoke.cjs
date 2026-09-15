const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'../internal/httpapi/assets'),source=fs.readFileSync(path.join(root,'daily-card.js'),'utf8');
const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},handlers:{},disabled:false,classList:{contains:()=>false,toggle(){}},focus(){},setAttribute(){},addEventListener(n,f){this.handlers[n]=f;},reset(){node('#daily-reflection').value='';}});return nodes.get(id);}
let token='alice',response=async()=>({ok:true,json:async()=>({data:[]})});let downloaded=false;const drawn=[];
const canvas={getContext:()=>({fillRect(){},fillText(t){drawn.push(t);},measureText:t=>({width:Array.from(t).length*40})}),toBlob:fn=>fn({})};
const context={document:{querySelector:node,createElement:tag=>tag==='canvas'?canvas:{click(){downloaded=true;}}},localStorage:{getItem:()=>token},MutationObserver:class{observe(){}},window:{confirm:()=>false,setInterval(){},addEventListener(){}},Intl,AbortController,setTimeout:(fn,ms)=>ms===60000?0:setTimeout(fn,ms),clearTimeout,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},fetch:(...args)=>response(...args)};
vm.createContext(context);vm.runInContext(source.replace(' sync();render();if(panel.classList.contains',' window.test={state,render,load,request,download,draw};sync();render();if(panel.classList.contains'),context);const api=context.window.test;
(async()=>{
 const card={kind:'daily',date:'2026-09-16',title:'留白',body:'不是每一寸时间，都需要被填满。',action:'休息五分钟。',prompt:'想放下什么？',favorite:false,reflection:'SECRET'};
 api.state.card=card;api.state.favorites=[card];api.render();node('#daily-reflection').value='PRIVATE DRAFT';api.state.dirty=true;
 await api.load('2026-09-15');assert.equal(api.state.card.date,'2026-09-16');assert.equal(node('#daily-reflection').value,'PRIVATE DRAFT');
 response=async()=>({ok:true,json:async()=>({data:{...card,favorite:true}})});node('#daily-favorite').handlers.click();while(api.state.busy)await new Promise(r=>setTimeout(r,1));assert.equal(node('#daily-reflection').value,'PRIVATE DRAFT');assert(api.state.dirty);assert(api.state.card.favorite);
 node('#daily-theme').value='warm';await api.download();assert(downloaded);assert(!drawn.join('').includes('SECRET'));assert(!drawn.join('').includes('PRIVATE DRAFT'));assert(drawn.join('').includes('休息五分钟'));
 let release;response=()=>new Promise(r=>release=r);const pending=api.request('daily-card');token='bob';release({ok:true,json:async()=>({data:card})});await assert.rejects(pending,/账号已切换/);assert.equal(api.state.card,null);assert.equal(node('#daily-reflection').value,'');
 api.state.dirty=false;let draws=0;response=async()=>{draws++;return {ok:true,json:async()=>({data:{...card,sign_number:7}})}};
 const drawing=api.draw();assert.equal(api.state.phase,'shaking');await api.draw();await drawing;assert.equal(draws,1);assert.equal(api.state.phase,'ready');node('#daily-reveal').handlers.click();assert.equal(api.state.phase,'revealed');assert.equal(node('#daily-day').textContent,'07');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys())assert(html.includes(`id="${id.slice(1)}"`),id);
 console.log('Daily card passed: draft guard, favorite preserves edits, PNG privacy, stale-account isolation and DOM wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});
