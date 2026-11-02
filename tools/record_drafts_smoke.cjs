const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'../internal/httpapi/assets'),C=require(path.join(dir,'record-drafts-core.js')),S=require(path.join(dir,'draft-store.js')),Memo=require(path.join(dir,'memo-drafts-core.js'));
class Storage{constructor(){this.map=new Map();this.fail=false;}get length(){return this.map.size;}key(i){return [...this.map.keys()][i]||null;}getItem(k){return this.map.get(k)??null;}setItem(k,v){if(this.fail&&k.startsWith(C.prefix))throw Object.assign(Error('full'),{name:'QuotaExceededError'});this.map.set(k,String(v));}removeItem(k){this.map.delete(k);}}
const key='2026-11-02',owner=C.scope('http://localhost:8080','owner'),baseMood={id:'mood-original',date:key,mood:'good',note:'server mood',activities:['运动'],tags:['日常'],stress:2,energy:4,updated_at:'2026-11-02T01:00:00.000000001Z'};
const baseWeekly={id:'weekly-original',week_start:key,satisfaction:4,wins:'server wins',challenges:'server challenges',lessons:'server lessons',next_week_priorities:['server next'],updated_at:'2026-11-02T01:00:00.000000001Z'};
function node(){const classes=new Set(),events={};return{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,dataset:{},style:{},classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},contains:x=>classes.has(x),toggle(x,on){if(on===undefined)on=!classes.has(x);on?classes.add(x):classes.delete(x);return on;}},setAttribute(){},addEventListener(k,f){(events[k]||=[]).push(f);},async emit(k,e={}){for(const f of events[k]||[])await f(e);},click(){return this.emit('click');},showModal(){this.open=true;},close(){this.open=false;},reportValidity:()=>true,append(){},focus(){},querySelectorAll:()=>[],reset(){}};}
function fixture(storage=new Storage()){
 const elements=new Map(),docEvents={},notices=[],el=id=>{id=id.replace(/^#/,'');if(!elements.has(id))elements.set(id,node());return elements.get(id);};
 const choices=['awful','low','neutral','good','great'].map(m=>Object.assign(node(),{dataset:{moodChoice:m}})),activities=['学习','工作','运动','社交','休息','睡眠不足'].map(a=>Object.assign(node(),{dataset:{moodActivity:a}}));
 const tabs=['mood','weekly'].map(k=>Object.assign(node(),{dataset:{ldKind:k}}));let app;
 const query=s=>s==='[data-ld-kind]'?tabs:s.startsWith('[data-mood-choice]')?choices:s.startsWith('[data-mood-activity]')?(s.includes('.selected')?activities.filter(b=>b.classList.contains('selected')):activities):[];
 for(const kind of ['mood','weekly-reflection'])el(kind+'-form').querySelector=s=>el(kind+'-submit');
 el('mood-form').querySelectorAll=()=>['mood-value','mood-note','mood-tags','mood-stress','mood-energy'].map(el);
 el('weekly-reflection-form').querySelectorAll=()=>['weekly-satisfaction','weekly-wins','weekly-challenges','weekly-lessons','weekly-priorities'].map(el);
 el('weekly-reflection-form').reset=()=>['weekly-satisfaction','weekly-wins','weekly-challenges','weekly-lessons','weekly-priorities'].forEach(id=>el(id).value='');
 const document={getElementById:el,querySelector:el,querySelectorAll:query,createElement:node,addEventListener(k,f){(docEvents[k]||=[]).push(f);},dispatchEvent(){}};
 storage.setItem('studyflow.token','token');
 const window={location:{origin:'http://localhost:8080',hash:'#moods'},DaynestRecordDraftCore:C,DaynestUI:{notify:(...a)=>notices.push(a)},setTimeout:()=>1,clearTimeout(){},addEventListener(){},confirm:()=>true};
 window.DaynestAccount={current:()=>app?.state.user&&app.state.token===storage.getItem('studyflow.token')?{userID:app.state.user.id,token:app.state.token,server:window.location.origin}:null};
 const ctx={window,document,localStorage:storage,console,Date,Intl,URL,URLSearchParams,Headers,AbortController,Blob,CustomEvent:class{},confirm:()=>true,setTimeout:()=>1};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(dir,'record-drafts.js'),'utf8'),ctx);
 const source=fs.readFileSync(path.join(dir,'app.js'),'utf8');
 vm.runInContext(source.replace('  bootstrap();','  showView=view=>{state.currentView=view;}; window.test={state,recordDrafts,renderMoods,renderWeeklyReview,markMoodDraft,markWeeklyDraft,saveMoodEntry,saveWeeklyReflection,refreshMoods,refreshWeeklyReview,canLeaveMoodDraft,selectWeeklyWeek,leaveApp};'),ctx);
 app=window.test;app.state.user={id:'owner'};app.state.token='token';app.state.moodMonth='2026-11';app.state.moodSelectedDate=key;app.state.moodLoadedMonth='2026-11';app.state.moodEntries=[{...baseMood}];app.state.weeklyReviewWeekStart=key;
 const moods=new Map([[key,{...baseMood}]]),weekly=new Map([[key,{...baseWeekly}]]),writes=[],copies=[];let counter=0;
 const review=k=>({week_start:k,week_end:k,summary:{},previous:{},comparison:{},highlights:[],reflection:weekly.get(k)||{},reflection_saved:weekly.has(k)});
 const response=(data,status=200)=>({status,ok:status<400,json:async()=>status<400?{data}:{error:{message:'conflict'}}});
 ctx.fetch=async(url,o={})=>{
   if(o.method==='PUT'){
     const body=JSON.parse(o.body),isMood=url.includes('/moods/'),k=isMood?url.split('/').pop():body.week_start,map=isMood?moods:weekly;
     writes.push({url,body});if(body.expected_version!==C.version(map.get(k)))return response(null,409);
     const next={...(map.get(k)||{}),...body,id:map.get(k)?.id||'new-'+(++counter),updated_at:'2026-11-02T02:00:00.'+String(++counter).padStart(9,'0')+'Z',...(isMood?{date:k}:{week_start:k})};delete next.expected_version;map.set(k,next);return response(next);
   }
   if(o.method==='POST'){copies.push(JSON.parse(o.body));return response({id:'copy'});}
   if(url.includes('/moods/insights'))return response({});
   if(url.includes('/moods?'))return response([...moods.values()].filter(r=>r.date.startsWith(new URLSearchParams(url.split('?')[1]).get('month'))));
   if(url.includes('/reviews/weekly?'))return response(review(new URLSearchParams(url.split('?')[1]).get('week_start')));
   return response([]);
 };
 app.state.weeklyReview=review(key);app.renderMoods();app.renderWeeklyReview();
 const account=async()=>{for(const f of docEvents['daynest:account-ready']||[])await f({});};
 const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
 const moodEvent={preventDefault(){},currentTarget:el('mood-form')},weeklyEvent={preventDefault(){},currentTarget:el('weekly-reflection-form')};
 return{app,ctx,window,el,storage,notices,moods,weekly,writes,copies,account,settle,moodEvent,weeklyEvent,review};
}
(async()=>{
 const shared=new Storage(),f=fixture(shared);await f.account();
 f.el('mood-note').value='写到一半的心情';f.el('mood-tags').value='家人, 开心';f.app.markMoodDraft();
 f.el('weekly-wins').value='未完成的复盘';f.el('weekly-challenges').value='困难';f.el('weekly-lessons').value='经验';f.el('weekly-priorities').value='第一件\n第二件';f.app.markWeeklyDraft();
 assert.equal(C.create(shared,owner).list().records.length,2);
 const r=fixture(shared);await r.account();assert.equal(r.writes.length,0);await r.el('ld-mood-open').click();await r.settle();assert(r.el('ld-local').value.includes('写到一半的心情'));
 await r.el('ld-restore').click();assert.equal(r.el('mood-note').value,'写到一半的心情');assert(r.app.state.moodDraftRevision);assert.equal(r.writes.length,0,'restoration implicitly wrote to server');
 await r.app.saveMoodEntry(r.moodEvent);assert.equal(r.moods.get(key).note,'写到一半的心情');assert.equal(C.create(shared,owner).list().records.length,1,'recovery created orphan draft copies');
 await r.el('ld-weekly-open').click();await r.settle();await r.el('ld-restore').click();assert.equal(r.el('weekly-lessons').value,'经验');assert.equal(r.el('weekly-priorities').value,'第一件\n第二件');
 await r.app.saveWeeklyReflection(r.weeklyEvent);assert.equal(r.weekly.get(key).wins,'未完成的复盘');assert.equal(C.create(shared,owner).list().records.length,0);
 console.log('Record drafts: full mood/weekly reload recovery, metadata, original keys, manual-only commit, exact source cleanup.');
 const race=fixture();await race.account();race.el('mood-note').value='first';race.app.markMoodDraft();let finish;const deliver=race.ctx.fetch;
 race.ctx.fetch=async(u,o={})=>{if(o.method==='PUT'&&!finish)await new Promise(r=>finish=r);return deliver(u,o);};
 const saving=race.app.saveMoodEntry(race.moodEvent);race.el('mood-note').value='typed during save';race.app.markMoodDraft();finish();await saving;
 assert.equal(race.el('mood-note').value,'typed during save');assert(race.app.state.moodDraftRevision);assert.equal(C.create(race.storage,owner).list().records[0].baseVersion,C.version(race.moods.get(key)));
 await race.app.saveMoodEntry(race.moodEvent);assert.equal(race.moods.get(key).note,'typed during save');
 race.el('weekly-wins').value='weekly local';race.app.markWeeklyDraft();const originalBase=race.app.state.weeklyBase;
 race.weekly.set(key,{...baseWeekly,wins:'another device',updated_at:'2026-11-02T03:00:00Z'});await race.app.refreshWeeklyReview();assert.equal(race.el('weekly-wins').value,'weekly local');assert.equal(race.app.state.weeklyBase,originalBase,'refresh advanced an unseen baseline');
 await race.app.saveWeeklyReflection(race.weeklyEvent);assert(race.app.state.weeklyDraftRevision);assert.equal(race.weekly.get(key).wins,'another device');
 await race.el('ld-weekly-open').click();await race.settle();assert(race.el('ld-restore').disabled);assert(race.el('ld-server').value.includes('another device'));
 await race.el('ld-copy').click();assert(race.copies[0].content.includes('weekly local'));assert(C.create(race.storage,owner).list().records.length);
 console.log('Record drafts: pending edits keep latest base; background refresh cannot mask a conflict; copy keeps original.');
 const change=fixture();await change.account();change.el('mood-note').value='date one';change.app.markMoodDraft();assert(change.app.canLeaveMoodDraft());change.app.state.moodSelectedDate='2026-11-03';change.app.state.moodEntries=[];change.app.renderMoods();change.el('mood-note').value='date two';change.app.markMoodDraft();
 assert.equal(C.create(change.storage,owner).list().records.length,2,'switching date overwrote a retained draft');
 change.el('weekly-wins').value='week one';change.app.markWeeklyDraft();await change.app.selectWeeklyWeek('2026-10-26');change.el('weekly-wins').value='week two';change.app.markWeeklyDraft();assert.equal(C.create(change.storage,owner).list().records.length,4);
 change.storage.fail=true;change.el('mood-note').value='quota edit';change.app.markMoodDraft();assert(change.el('ld-mood-state').textContent.includes('空间不足'));assert(change.app.state.moodDraftRevision);change.storage.fail=false;
 change.el('ld-enabled').checked=false;await change.el('ld-enabled').emit('change');const before=C.create(change.storage,owner).list().records.length;change.el('mood-note').value='memory only';change.app.markMoodDraft();assert.equal(C.create(change.storage,owner).list().records.length,before);
 change.storage.setItem('studyflow.token','new-token');change.app.state.token='new-token';change.app.state.user={id:'another-owner'};await change.account();assert.equal(change.el('ld-list').innerHTML.includes('date one'),false);assert.equal(C.create(change.storage,owner).list().records.length,before);
 console.log('Record drafts: safe date/week detachment, quota honesty, opt-out and stable account/server isolation.');
 const unknown=fixture();await unknown.account();unknown.el('mood-note').value='accepted with lost response';unknown.app.markMoodDraft();const send=unknown.ctx.fetch;let drop=true;
 unknown.ctx.fetch=async(u,o={})=>{const result=await send(u,o);if(o.method==='PUT'&&drop){drop=false;throw Error('response lost');}return result;};await unknown.app.saveMoodEntry(unknown.moodEvent);assert(unknown.app.state.moodDraftRevision);await unknown.el('ld-mood-open').click();await unknown.settle();assert(!unknown.el('ld-restore').disabled);await unknown.el('ld-restore').click();await unknown.app.saveMoodEntry(unknown.moodEvent);assert.equal(C.create(unknown.storage,owner).list().records.length,0);
 const deleted=fixture();await deleted.account();deleted.el('mood-note').value='deleted original text';deleted.app.markMoodDraft();deleted.moods.delete(key);await deleted.el('ld-mood-open').click();await deleted.settle();assert(deleted.el('ld-restore').disabled,'deleted record was silently recreated');assert(deleted.el('ld-local').value.includes('deleted original text'));
 console.log('Record drafts: unknown outcomes preserved; matching server values require manual confirmation; deletion never auto-resurrects.');
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8'),script=fs.readFileSync(path.join(dir,'record-drafts.js'),'utf8');for(const [,id]of script.matchAll(/\$\("([^"]+)"\)/g))assert(html.includes(`id="ld-${id}"`),`missing draft element ${id}`);
 assert(html.indexOf('/static/draft-store.js')<html.indexOf('/static/record-drafts-core.js')&&html.indexOf('/static/record-drafts.js')<html.indexOf('/static/app.js'));
 assert(!C.valid({version:1,id:'bad',kind:'weekly',key:'2026-11-03'}));assert(C.equal('mood',{...baseMood,tags:'日常, 日常'},{...baseMood,tags:['日常']}));
 const budget=new Storage(),m=Memo.create(budget,owner);for(let i=0;i<40;i++)m.put({version:1,id:'memo-'+i,noteID:'memo',generation:1,savedAt:1,baseUpdatedAt:'',base:Memo.fields({}),value:Memo.fields({content:'text'})});
 assert.throws(()=>C.create(budget,owner).put({version:1,id:'over',kind:'mood',key,generation:1,savedAt:1,baseVersion:'',base:C.fields('mood'),value:C.fields('mood')}),/空间已满/);
 const sandbox={window:{},crypto:{getRandomValues:a=>{a.fill(1);return a;}},URL};vm.runInNewContext(fs.readFileSync(path.join(dir,'draft-store.js'),'utf8'),sandbox);assert(sandbox.window.DaynestDraftStore.writerID().startsWith('draft-'));
 console.log('Shared store: existing memo keys retained, global quota, invalid record rejection, LAN HTTP random ID fallback.');
})().catch(e=>{console.error(e);process.exitCode=1;});
