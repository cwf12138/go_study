const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'../internal/httpapi/assets');
const source=fs.readFileSync(path.join(root,'idea-lab.js'),'utf8');
const nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,handlers:{},classList:{contains:()=>false},querySelectorAll:()=>[],setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},focus(){},reset(){for(const id of ['#lab-one','#lab-two','#lab-three'])node(id).value='';},reportValidity:()=>true});return nodes.get(id);}
let token='alice',fetcher=async()=>({ok:true,json:async()=>({data:[]})}),posts=0,patches=0,saved=null,failOnce=true;
const context={document:{querySelector:node},localStorage:{getItem:()=>token},window:{addEventListener(){},confirm:()=>true},MutationObserver:class{observe(){}},AbortController,setTimeout,clearTimeout,crypto:{randomUUID:()=> 'test-unique-id'},fetch:(...args)=>fetcher(...args)};
vm.createContext(context);
vm.runInContext(source.replace('  syncAccount();render();','  window.test={state,drawNotes,start,content,request,run,syncAccount};syncAccount();render();'),context);
const api=context.window.test;
(async()=>{
 const notes=[{id:'a',title:'<img>',snippet:'<script>',tags:[]},{id:'b',title:'Go',tags:[]},{id:'c',title:'practice',tags:['灵感实验']}];
 const pair=api.drawNotes(notes,2);assert.equal(new Set(pair.map(n=>n.id)).size,2);assert(!pair.some(n=>n.id==='c'));
 assert.throws(()=>api.drawNotes([],2));
 api.start('theme',notes.slice(0,2));assert(!node('#lab-sources').innerHTML.includes('<img>'));assert(node('#lab-sources').innerHTML.includes('&lt;img&gt;'));
 for(const id of ['one','two','three'])node('#lab-'+id).value='answer '+id;
 assert(api.content().includes('[[Go]]'));
 fetcher=async(url,opt)=>{
   if(opt.method==='POST'){posts++;saved={id:'saved',title:JSON.parse(opt.body).title};if(failOnce){failOnce=false;throw Error('network lost after commit');}}
   if(opt.method==='PATCH'){patches++;return {ok:true,json:async()=>({data:{note:saved}})};}
   return {ok:true,json:async()=>({data:saved?[saved]:[]})};
 };
 const submit=()=>node('#lab-form').handlers.submit({preventDefault(){},currentTarget:node('#lab-form')});
 submit();while(api.state.busy)await new Promise(r=>setTimeout(r,1));
 assert(api.state.dirty);assert.equal(node('#lab-one').value,'answer one');
 submit();while(api.state.busy)await new Promise(r=>setTimeout(r,1));
 assert.equal(posts,1);assert.equal(patches,1);assert.equal(api.state.noteID,'saved');assert(!api.state.dirty);
 let release;fetcher=()=>new Promise(resolve=>release=resolve);
 const pending=api.request();token='bob';release({ok:true,json:async()=>({data:notes})});await assert.rejects(pending,/账号已切换/);
 assert.equal(api.state.topic,'');assert.equal(node('#lab-one').value,'');assert.equal(api.state.sources.length,0);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const id of nodes.keys())assert(html.includes(`id="${id.slice(1)}"`),id);
 console.log('Idea Lab passed: distinct draws, practice exclusion, escaped sources, wiki links, uncertain-save recovery, draft preservation and account isolation.');
})().catch(err=>{console.error(err);process.exitCode=1;});
