const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root='internal/httpapi/assets/',source=fs.readFileSync(root+'shopping.js','utf8'),html=fs.readFileSync(root+'index.html','utf8');
for(const m of source.matchAll(/\$\('([\w-]+)'\)/g))assert(html.includes(`id="shopping-${m[1]}"`),`missing shopping-${m[1]}`);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:false,disabled:false,open:false,innerHTML:'',textContent:'',attrs:{},classList:{toggle(){}},querySelectorAll(){return []},setAttribute(k,v){this.attrs[k]=v},reset(){},focus(){},close(){this.open=false},showModal(){this.open=true}});return elements.get(id)}
let owner='alice',event=null;const context={console,Date,crypto:crypto.webcrypto,AbortController,setTimeout,clearTimeout,
 localStorage:{getItem(){return owner}},document:{getElementById:el,dispatchEvent(e){event=e}},window:{confirm(){return true}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}};
vm.runInNewContext(source.replace('  bind();','  window.test={state,parse,api,load,add,action,mutate,render,sync,showTab};'),context);const app=context.window.test,$=id=>el('shopping-'+id);
const response=(data,status=200)=>({ok:status<300,status,json:async()=>({data,error:status>=300?{message:'conflict'}:undefined})});
async function run(){
 assert.equal(app.parse('牛奶 2盒\n鸡蛋')[0].quantity,'2盒');assert.equal(app.parse('鸡蛋')[0].name,'鸡蛋');assert.throws(()=>app.parse('  '));assert.throws(()=>app.parse(Array(31).fill('x').join('\n')));
 context.fetch=async()=>({ok:false,status:404,json:async()=>JSON.parse('404 page not found')});await app.load();assert.match($('status').textContent,/go run/);assert(!app.state.loaded);
 context.fetch=async()=>response([]);await app.load();assert(app.state.loaded);
 let fail=false,posted=[];context.fetch=async(path,options)=>{const b=JSON.parse(options.body);posted.push({path,b});if(b.name==='鸡蛋'&&fail)throw new Error('offline');return response({...b,id:path.split('/').pop(),revision:b.revision+1,updated_at:'2026-10-07T00:00:00Z'})};
 $('input').value='牛奶 2盒\n鸡蛋';fail=true;await app.add($('input'));assert.equal(app.state.items.length,1);assert.equal($('input').value,'鸡蛋');assert.match($('status').textContent,/已处理 1 项/);const retryID=posted[1].path;
 fail=false;await app.add($('input'));assert.equal(posted[2].path,retryID);assert.equal(app.state.items.length,2);assert.equal($('input').value,'');
 $('input').value='牛奶 5盒';const count=posted.length;await app.add($('input'));assert.equal(posted.length,count);assert.match($('status').textContent,/未重复添加/);
 const milk=app.state.items.find(i=>i.name==='牛奶');await app.action('toggle',milk.id);assert(app.state.items.find(i=>i.id===milk.id).purchased);assert(app.state.undo);
 const undo=app.state.undo;await app.mutate({...undo.before,revision:undo.revision},{},null);assert(!app.state.items.find(i=>i.id===milk.id).purchased);
 await app.action('delete',milk.id);assert(app.state.items.find(i=>i.id===milk.id).deleted);
 $('input').value='牛奶';await app.add($('input'));assert.equal(app.state.items.filter(i=>i.name==='牛奶'&&!i.deleted).length,1);assert.notEqual(app.state.items.find(i=>i.name==='牛奶'&&!i.deleted).id,milk.id);
 const egg=app.state.items.find(i=>i.name==='鸡蛋');await app.action('toggle',egg.id);await app.action('store',egg.id);assert.equal(event.type,'daynest:shopping-store');assert.equal(event.detail.id,egg.id);
 app.state.items.push({...egg,id:'unsafe',name:'<script>alert(1)</script>',note:'<img src=x>',frequent:true,purchased:false});app.render();assert.match($('list').innerHTML,/&lt;script&gt;/);assert(!$('list').innerHTML.includes('<script>'));assert.match($('favorites').innerHTML,/&lt;script&gt;/);
 context.fetch=async()=>response({},409);await app.action('toggle',egg.id);assert(app.state.items.find(i=>i.id===egg.id).purchased);assert.match($('status').textContent,/conflict/);
 let release;context.fetch=()=>new Promise(resolve=>{release=resolve});$('input').value='纸巾';const pending=app.add($('input'));assert(app.state.busy);const before=posted.length;await app.add($('input'));assert.equal(posted.length,before);owner='bob';app.sync();release(response({id:'stale',revision:1}));await pending;assert.equal(app.state.items.length,0);assert.equal($('input').value,'');
 const css=fs.readFileSync(root+'shopping.css','utf8');for(const hook of ['max-width:600px','prefers-reduced-motion:reduce',':focus-visible','.shopping-mode','[hidden]'])assert(css.includes(hook));
 console.log('Shopping passed: DOM wiring, parsing, missing endpoint, partial retry IDs, duplicates, purchase/undo/remove/re-add, inventory handoff, escaping, conflicts and account isolation.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
