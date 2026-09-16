const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'../internal/httpapi/assets'),source=fs.readFileSync(path.join(root,'keepsakes.js'),'utf8');
const nodes=new Map(),events={};
function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='#keepsake-state'?'active':'',checked:false,textContent:'',innerHTML:'',disabled:false,open:false,handlers:{},classList:{contains:()=>false,toggle(){},add(){}},querySelectorAll:()=>[],setAttribute(){},removeAttribute(){},addEventListener(n,f){this.handlers[n]=f;},focus(){},reset(){},showModal(){this.open=true;},close(){this.open=false;},reportValidity:()=>true});return nodes.get(id);}
let token='alice',response=async()=>({ok:true,json:async()=>({data:[]})});
const ctx={document:{querySelector:node,addEventListener:(n,f)=>events[n]=f},localStorage:{getItem:()=>token},MutationObserver:class{observe(){}},window:{confirm:()=>true,addEventListener(){}},crypto:{randomUUID:()=> 'new-keep-0000000001'},AbortController,setTimeout,clearTimeout,fetch:(...args)=>response(...args)};vm.createContext(ctx);
vm.runInContext(source.replace('sync();render();\n})();','window.test={state,render,filterItems,mapPoint,openEditor,request,load,payload};sync();render();\n})();'),ctx);const api=ctx.window.test;
(async()=>{
 assert(api,'instrument module');assert.equal(api.mapPoint(0,0).x,50);assert.equal(api.mapPoint(90,-180).y,0);assert.equal(api.mapPoint(-90,180).x,100);
 const place={id:'place-000000000001',kind:'place',title:'<img onerror=1>',story:'private story',status:'wish',latitude:31.23,longitude:121.47,photo:'',date:'2026-09-16',collection:'Travel',favorite:true,archived:false,revision:1,created_at:'2026-09-16T00:00:00Z'};
 api.state.items=[place,{...place,id:'archived',archived:true}];api.state.loaded=true;api.render();assert.equal(api.filterItems().length,1);assert(node('#keepsake-grid').innerHTML.includes('&lt;img'));assert(!node('#keepsake-grid').innerHTML.includes('<img onerror'));assert(node('#keepsake-map').innerHTML.includes('data-keep-select="place-000000000001"'));
 node('#keepsake-state').value='archived';api.render();assert.equal(api.filterItems()[0].id,'archived');node('#keepsake-state').value='active';node('#keepsake-search').value='unknown';assert.equal(api.filterItems().length,0);node('#keepsake-search').value='';
 api.openEditor(place);node('#keepsake-story').value='new draft';api.state.dirty=true;response=async()=>({ok:false,status:409,json:async()=>({error:{message:'conflict'}})});
 node('#keepsake-form').handlers.submit({preventDefault(){},currentTarget:node('#keepsake-form')});while(api.state.busy)await new Promise(r=>setTimeout(r,1));assert(node('#keepsake-dialog').open);assert.equal(node('#keepsake-story').value,'new draft');assert(node('#keepsake-editor-status').textContent.includes('草稿不会清空'));
 let release;response=()=>new Promise(r=>release=r);const pending=api.request();token='bob';release({ok:true,json:async()=>({data:[place]})});await assert.rejects(pending,/账号已切换/);assert.equal(api.state.items.length,0);assert.equal(api.state.editing,null);assert(!node('#keepsake-dialog').open);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys())assert(html.includes(`id="${id.slice(1)}"`),id);
 console.log('Keepsakes UI passed: coordinate projection, filtering, escaped cards, map/list wiring, conflict draft preservation and account isolation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
