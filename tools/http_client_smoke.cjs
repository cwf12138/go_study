const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'internal/httpapi/assets'),{create,RequestError}=require(path.join(dir,'http-client.js'));
const response=(data,status=200)=>new Response(status===204?null:JSON.stringify({data}),{status,headers:{'Content-Type':'application/json'}});
const envelope=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(){
 let actor={token:'token-a',server:'http://localhost:8080',userID:'alice',session:1},send=async()=>response({ok:true}),events=0,calls=[];
 const timers=new Map();let timerID=0;
 const client=create({getContext:()=>actor,fetch:(url,options)=>{calls.push({url,options});return send(url,options);},setTimeout:(f,ms)=>{timers.set(++timerID,{f,ms});return timerID;},clearTimeout:id=>timers.delete(id),onUnauthorized:()=>events++});
 return {client,calls,timers,set send(f){send=f;},get actor(){return actor;},set actor(v){actor=v;},get events(){return events;},expire(){[...timers.values()][0].f();}};
}
(async()=>{
 const h=fixture(),c=h.client;
 assert.deepEqual(await c.json('/api/v1/memos'),{ok:true});assert.equal(h.calls[0].options.headers.get('Authorization'),'Bearer token-a');assert.equal(h.calls[0].options.redirect,'error');assert.equal(h.timers.size,0);
 await c.json('/api/v1/memos',{method:'POST',body:{title:'文字'},headers:{Authorization:'Bearer wrong'}});assert.equal(h.calls[1].options.headers.get('Authorization'),'Bearer token-a');assert.equal(h.calls[1].options.body,'{"title":"文字"}');
 h.send=async()=>envelope({data:null,meta:{count:0}});assert.deepEqual(await c.json('/api/v1/memos',{envelope:true}),{data:null,meta:{count:0}});
 h.send=async()=>response(null,204);assert.equal(await c.json('/api/v1/memos/id',{method:'DELETE'}),null);
 const count=h.calls.length;for(const url of ['https://example.test','//example.test','/api/v1/../private','/api/v1/%2e%2e/private','/api/v1/memos#token','/api/v1/memos\\other'])await assert.rejects(c.json(url),e=>e.kind==='invalid_request');assert.equal(h.calls.length,count,'unsafe URL received authorization');
 h.send=async()=>new Response('<h1>proxy error</h1>',{status:404});await assert.rejects(c.json('/api/v1/memos'),e=>e.status===404&&e.kind==='http'&&!e.message.includes('proxy'));
 h.send=async()=>new Response('{"data":1}garbage');await assert.rejects(c.json('/api/v1/memos',{method:'POST',body:'{}'}),e=>e.kind==='invalid_response'&&e.uncertain);
 h.send=async()=>envelope({items:[]});await assert.rejects(c.json('/api/v1/memos'),e=>e.kind==='invalid_response');
 h.send=async()=>new Response(JSON.stringify({error:{code:'invalid_state',message:'specific state'}}),{status:409});await assert.rejects(c.json('/api/v1/memos/id',{method:'PATCH',body:'{}'}),e=>e.status===409&&e.code==='invalid_state'&&!e.uncertain);
 h.send=async()=>new Response('{}',{status:503});const before=h.calls.length;await assert.rejects(c.json('/api/v1/memos',{method:'POST',body:'{}'}),e=>e.uncertain&&e.status===503);assert.equal(h.calls.length,before+1,'write retried');
 console.log('HTTP contracts: JSON/envelope/204, relative API paths, current auth header, malformed success/error, 409 and no write retry.');

 const timeout=fixture();timeout.send=()=>new Promise(()=>{});const request=timeout.client.json('/api/v1/memos',{method:'POST',body:'{}'});await settle();timeout.expire();await assert.rejects(request,e=>e.kind==='timeout'&&e.uncertain);assert.equal(timeout.timers.size,0);
 const cancelled=fixture(),parent=new AbortController();parent.abort();const early=cancelled.client.json('/api/v1/memos',{method:'POST',signal:parent.signal});await assert.rejects(early,e=>e.kind==='cancelled'&&!e.uncertain);assert.equal(cancelled.calls.length,0);
 const hanging=fixture(),abort=new AbortController();let adds=0,removes=0;
 const add=abort.signal.addEventListener.bind(abort.signal),remove=abort.signal.removeEventListener.bind(abort.signal);abort.signal.addEventListener=(...a)=>{adds++;return add(...a);};abort.signal.removeEventListener=(...a)=>{removes++;return remove(...a);};
 hanging.send=async()=>({ok:true,status:200,json:()=>new Promise(()=>{})});const reading=hanging.client.json('/api/v1/memos',{signal:abort.signal});await settle();abort.abort();await assert.rejects(reading,e=>e.kind==='cancelled');assert.equal(adds,removes);assert.equal(hanging.timers.size,0);
 const large=fixture();let bodyCancelled=false;
 large.send=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20));},cancel(){bodyCancelled=true;}}));await assert.rejects(large.client.json('/api/v1/memos',{maxBytes:10}),e=>e.kind==='too_large');assert(bodyCancelled);assert.equal(large.timers.size,0);
 console.log('HTTP lifecycle: cancellation before dispatch/during body, ignored aborts, timeout, bounded body and listener/timer cleanup.');

 const stale=fixture();let deliver;
 stale.send=()=>new Promise(r=>deliver=r);const old=stale.client.json('/api/v1/memos');stale.actor={...stale.actor,token:'token-b',userID:'bob'};deliver(response({private:'alice'}));await assert.rejects(old,e=>e.kind==='account_changed');assert.equal(stale.events,0);
 const context=stale.client.capture();stale.actor={...stale.actor,session:2};const oldCount=stale.calls.length;await assert.rejects(stale.client.json('/api/v1/memos',{context}),e=>e.kind==='account_changed');assert.equal(stale.calls.length,oldCount,'old session dispatched');
 let parse;stale.send=async()=>({ok:true,status:200,json:()=>new Promise(r=>parse=r)});const oldBody=stale.client.json('/api/v1/memos');await settle();stale.actor={...stale.actor,server:'http://another:8080'};parse({data:{private:'old server'}});await assert.rejects(oldBody,e=>e.kind==='account_changed');
 stale.send=()=>new Promise(()=>{});const cancelledOld=stale.client.json('/api/v1/memos');stale.actor={...stale.actor,session:3};stale.client.cancelStale();await assert.rejects(cancelledOld,e=>e.kind==='account_changed');
 const late401=fixture();let unauthorized;late401.send=()=>new Promise(r=>unauthorized=r);const oldAuth=late401.client.json('/api/v1/memos');late401.actor={...late401.actor,session:2};unauthorized(new Response('not json',{status:401}));await assert.rejects(oldAuth,e=>e.kind==='account_changed');assert.equal(late401.events,0);assert(!late401.client.authExpired());
 console.log('HTTP identity: account/server/session changes reject before dispatch or after body; late 401 cannot expire a new session.');

 const auth=fixture();auth.send=async()=>new Response('non-JSON authentication response',{status:401});await Promise.all([assert.rejects(auth.client.json('/api/v1/memos'),e=>e.kind==='auth'),assert.rejects(auth.client.json('/api/v1/data-center'),e=>e.status===401)]);assert.equal(auth.events,1);assert(auth.client.authExpired());const n=auth.calls.length;await assert.rejects(auth.client.json('/api/v1/memos',{method:'POST',body:'{}'}),e=>e.status===401&&!e.uncertain);assert.equal(auth.calls.length,n);
 auth.actor={...auth.actor,session:2};auth.send=async()=>response([]);assert(!auth.client.authExpired());assert.deepEqual(await auth.client.json('/api/v1/memos'),[]);
 const finishedSignal=auth.calls.at(-1).options.signal;auth.actor={...auth.actor,session:3};auth.client.cancelStale();assert(!finishedSignal.aborted,'completed request retained in active set');
 assert(new RequestError('safe') instanceof Error);
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');for(const name of ['http-client.js','auth-state.js','auth-state.css'])assert(html.includes('/static/'+name));assert(html.indexOf('/static/http-client.js')<html.indexOf('/static/data-center.js'));
 for(const name of ['memos.js','data-center.js'])assert(fs.readFileSync(path.join(dir,name),'utf8').includes('DaynestHTTP.json'));
 console.log('HTTP auth: single expiry notice, no destructive logout or repeated protected requests, renewed same-token session works.');
})().catch(e=>{console.error(e);process.exitCode=1;});
