const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'../internal/httpapi/assets');const source=fs.readFileSync(path.join(root,'explore.js'),'utf8');
const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='#explore-filter'?'all':'',textContent:'',innerHTML:'',disabled:false,handlers:{},classList:{contains:()=>false,toggle(){}},querySelectorAll:()=>[],querySelector:()=>({}),setAttribute(){},addEventListener(n,f){this.handlers[n]=f;},reset(){},reportValidity:()=>true});return nodes.get(id);}
let token='alice',response=async()=>({ok:true,json:async()=>({data:[]})});
const ctx={document:{querySelector:node},localStorage:{getItem:()=>token},MutationObserver:class{observe(){}},window:{addEventListener(){},setInterval(){},confirm:()=>true},crypto:{randomUUID:()=> 'new-challenge-00000001'},AbortController,setTimeout,clearTimeout,fetch:(...a)=>response(...a)};vm.createContext(ctx);
vm.runInContext(source.replace(' sync();render();if(panel.classList.contains',' window.test={state,render,request,load,create,sync};sync();render();if(panel.classList.contains'),ctx);
const api=ctx.window.test;
(async()=>{
 api.state.items=[{id:'a',kind:'letter',title:'<img>',mood:'calm',body:'SECRET',locked:true,created_at:new Date().toISOString(),unlock_at:new Date().toISOString()}];api.render();
 assert(!node('#explore-list').innerHTML.includes('SECRET'));assert(node('#explore-list').innerHTML.includes('&lt;img&gt;'));
 api.state.items[0].locked=false;api.render();assert(node('#explore-list').innerHTML.includes('SECRET'));
 api.state.tab='challenge';node('#explore-minutes').value='15';node('#explore-budget').value='0';node('#explore-place').value='indoor';
 response=async()=>{throw Error('offline');};api.create('challenge',{preventDefault(){},currentTarget:node('#explore-challenge-form')});while(api.state.busy)await new Promise(r=>setTimeout(r,1));assert(api.state.pending.challenge);const id=api.state.pending.challenge.id;
 response=async(url,options)=>{assert.equal(JSON.parse(options.body).id,id);return {ok:true,json:async()=>({data:{id,kind:'challenge',title:'x',body:'body'}})};};api.create('challenge',{preventDefault(){},currentTarget:node('#explore-challenge-form')});while(api.state.busy)await new Promise(r=>setTimeout(r,1));assert(!api.state.pending.challenge);assert.equal(api.state.items.filter(e=>e.id===id).length,1);
 let release;response=()=>new Promise(r=>release=r);const pending=api.request();token='bob';release({ok:true,json:async()=>({data:[]})});await assert.rejects(pending,/账号已切换/);assert.equal(api.state.items.length,0);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys())assert(html.includes(`id="${id.slice(1)}"`),id);
 console.log('Explore UI passed: locked letter concealment, escaping, failed submit/retry, account isolation and DOM wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});
