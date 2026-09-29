const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root='internal/httpapi/assets/',source=fs.readFileSync(root+'inventory.js','utf8'),html=fs.readFileSync(root+'index.html','utf8');
for(const match of source.matchAll(/\$\('([\w-]+)'\)/g))assert(html.includes(`id="inventory-${match[1]}"`),`missing ${match[1]}`);
for(const marker of ['data-view="inventory"','id="panel-inventory"','aria-labelledby="inventory-dialog-title"','/static/inventory.css','/static/inventory.js'])assert(html.includes(marker));
const css=fs.readFileSync(root+'inventory.css','utf8');for(const marker of ['max-width:600px','data-theme="dark"','prefers-reduced-motion:reduce',':focus-visible'])assert(css.includes(marker));
let owner='alice';const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,open:false,classList:{toggle(){}},reset(){},focus(){},showModal(){this.open=true},close(){this.open=false},querySelectorAll(){return []}});return elements.get(id)}
const context={console,Date,Intl,JSON,Math,Number,String,Object,Array,Set,Infinity,crypto,AbortController,setTimeout,clearTimeout,
  localStorage:{getItem(){return owner}},document:{getElementById:el},window:{confirm(){return true}}};
vm.runInNewContext(source.replace('  bind();','  window.test={state,price,alerts,days,day,card,filtered,render,load,open,save,action,syncAccount,csvCell,api};'),context);
const app=context.window.test,$=name=>el('inventory-'+name);
const response=(data,status=200)=>({ok:status<300,status,json:async()=>({data,error:status>=300?{message:'conflict'}:undefined})});
async function run(){
  for(const [code,text,pattern] of [
    [404,'404 page not found\n',/HTTP 404.*go run/],
    [405,'Method Not Allowed',/HTTP 405/],
    [401,'Unauthorized',/重新登录/],
    [502,'<html>Bad gateway</html>',/HTTP 502/],
    [200,'<html>Login</html>',/有效的 JSON/],
    [200,'123',/有效的 JSON/],
    [200,'null',/有效的 JSON/],
    [200,'[]',/有效的 JSON/],
  ]) {
    context.fetch=async()=>({ok:code===200,status:code,json:async()=>JSON.parse(text)});
    await assert.rejects(app.api(''),pattern);
  }
  context.fetch=async()=>({ok:false,status:404,json:async()=>({error:{code:'not_found'}})});
  await assert.rejects(app.api('/item-missing'),/记录已不存在/);
  context.fetch=async()=>({ok:true,status:200,json:async()=>{const error=new Error('aborted');error.name='AbortError';throw error}});
  await assert.rejects(app.api(''),/请求超时/);
  context.fetch=async()=>({ok:false,status:404,json:async()=>JSON.parse('404 page not found')});
  await app.load();assert.match($('status').textContent,/HTTP 404/);assert(!app.state.loaded);assert(!app.state.loading);assert(!$('reload').disabled);
  assert.equal(app.price('12.09'),1209);assert.equal(app.price(''),0);for(const value of ['-1','1.001','1e3','Infinity','100000001'])assert.throws(()=>app.price(value));
  assert.equal(app.days(app.day()),0);assert.equal(app.days(''),Infinity);
  const item={id:'item-00000001',name:'<script>private</script>',category:'数码设备',location:'desk',quantity:2,price:1209,borrower:'friend',return_on:app.day(),expires_on:'',warranty_until:'',note:'<img onerror=x>',updated_at:'2026-09-29',revision:1};
  assert.equal(app.alerts(item).length,1);assert.match(app.card(item),/&lt;script&gt;/);assert(!app.card(item).includes('<script>'));assert.match(app.card(item),/确认归还/);
  context.fetch=async()=>response([item]);await app.load();assert(app.state.loaded);assert.match($('list').innerHTML,/private/);assert.equal($('total').textContent,'1 / 2');
  $('search').value='friend';assert.equal(app.filtered().length,1);$('search').value='missing';assert.equal(app.filtered().length,0);$('search').value='';
  $('view').value='attention';assert.equal(app.filtered().length,1);$('view').value='archived';assert.equal(app.filtered().length,0);$('view').value='active';
  app.state.items=Array.from({length:13},(_,i)=>({...item,id:'item-'+i}));app.state.page=2;app.render();assert.match($('page').textContent,/2 \/ 2/);assert.equal(($('list').innerHTML.match(/<article/g)||[]).length,1);
  app.open();$('name').value='new item';$('quantity').value='1';$('price').value='2.50';const id=app.state.editing.id;
  context.fetch=async()=>{throw new Error('offline')};await app.save({preventDefault(){}});assert.equal($('name').value,'new item');assert.equal(app.state.editing.id,id);assert.match($('save-status').textContent,/草稿已保留/);assert(!app.state.busy);
  let sent,release,count=0;context.fetch=(path,options)=>{count++;sent={path,body:JSON.parse(options.body)};return new Promise(resolve=>{release=resolve})};
  const pending=app.save({preventDefault(){}});await app.save({preventDefault(){}});assert.equal(count,1);assert.equal(sent.path,'/api/v1/inventory/'+id);assert.equal(sent.body.price,250);
  release(response({...sent.body,id,revision:1,updated_at:'2026-09-29'}));await pending;assert(!$('dialog').open);assert.equal(app.state.items.filter(row=>row.id===id).length,1);
  app.state.items=[item];context.fetch=async(path,options)=>{const body=JSON.parse(options.body);assert.equal(body.borrower,'');assert.equal(body.return_on,'');return response({...body,id:item.id,revision:2})};await app.action('return',item.id);assert.equal(app.state.items[0].borrower,'');
  context.fetch=async(path,options)=>response({...JSON.parse(options.body),id:item.id,revision:3});await app.action('archive',item.id);assert(app.state.items[0].archived);
  context.fetch=async()=>response({},409);await app.action('archive',item.id);assert(app.state.items[0].archived);assert.match($('status').textContent,/conflict/);
  assert.match(app.csvCell('=SUM(A1)'),/^"'/);assert.match(app.csvCell('\t@x'),/^"'/);assert.equal(app.csvCell('a"b'),'"a""b"');
  context.fetch=()=>new Promise(resolve=>{release=resolve});const stale=app.load();owner='bob';app.syncAccount();release(response([item]));await stale;assert.equal(app.state.items.length,0);assert(!app.state.loaded);assert(!app.state.loading);
  console.log('Inventory passed: selectors/themes, money/date bounds, search/pagination, safe HTML/CSV, save retries, duplicate prevention, return/archive, conflict preservation and account isolation.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
