const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'../internal/httpapi/assets'),nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},style:{setProperty(){}},handlers:{},classList:{add(){},remove(){},toggle(){},contains:()=>false},addEventListener(n,f){this.handlers[n]=f;},setAttribute(){},insertAdjacentHTML(){},querySelectorAll:()=>[],querySelector:()=>null,focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();},reset(){}});return nodes.get(id);}
let token='alice',respond;
const ctx={document:{querySelector:node,querySelectorAll:()=>[]},localStorage:{getItem:k=>k==='studyflow.token'?token:null,setItem(){}},window:{setTimeout,clearTimeout,setInterval(){},addEventListener(){}},location:{hash:''},Headers:class{set(){}},Intl,URLSearchParams,requestAnimationFrame:f=>f(),fetch:(...a)=>respond(...a)};
vm.createContext(ctx);
let source=fs.readFileSync(path.join(root,'calendar.js'),'utf8').replace('      loadHistory(value);','      /* External history excluded from this interaction test. */');
source=source.replace('  bind();','  window.test={state,loadCalendar,loadDayDetail,itemsByDate,renderCalendar};\n  bind();');
vm.runInContext(source,ctx);const api=ctx.window.test;
const ok=data=>({status:200,ok:true,json:async()=>({data})});
(async()=>{
 const queue=[];respond=url=>url.includes('/days/')?Promise.resolve(ok({date:api.state.selected})):new Promise(r=>queue.push(r));
 api.state.anchor=new Date(2026,8,1);api.state.selected='2026-09-01';const old=api.loadCalendar();
 api.state.anchor=new Date(2026,9,1);api.state.selected='2026-10-01';const latest=api.loadCalendar();
 queue[1](ok({marker:'latest',events:[]}));await latest;queue[0](ok({marker:'old',events:[]}));await old;assert.equal(api.state.overview.marker,'latest');
 const detailQueue=[];respond=()=>new Promise(r=>detailQueue.push(r));api.state.selected='2026-10-02';const d1=api.loadDayDetail('2026-10-02');api.state.selected='2026-10-03';const d2=api.loadDayDetail('2026-10-03');
 detailQueue[1](ok({date:'2026-10-03'}));await d2;detailQueue[0](ok({date:'2026-10-02'}));await d1;assert.equal(api.state.detail.date,'2026-10-03');
 api.state.overview={events:[{id:'e',title:'Go meeting',occurrence_start:'2026-10-03T09:00:00',color:'#ff0000'}],tasks:[{id:'t',title:'Learn Go',due_at:'2026-10-03T10:00:00'}]};
 api.state.source='event';api.state.query='go';assert.equal([...api.itemsByDate().values()].flat().length,1);
 api.state.source='tasks';assert.equal([...api.itemsByDate().values()].flat()[0].type,'task');api.state.query='absent';assert.equal(api.itemsByDate().size,0);
 api.state.query='';api.state.source='all';api.state.view='month';api.state.anchor=new Date(2026,9,1);api.renderCalendar();assert(node('#calendar-canvas').innerHTML.includes('aria-pressed="true"'));assert(node('#calendar-canvas').innerHTML.includes('tabindex="0"'));
 let release;respond=()=>new Promise(r=>release=r);const stale=api.loadDayDetail(api.state.selected);token='bob';release(ok({date:'2026-10-03',quote:'private'}));await stale;assert.notEqual(api.state.detail?.quote,'private');
 node('#calendar-search-open').handlers.click();assert(node('#calendar-tools-dialog').open);assert(node('#calendar-search').focused);assert.equal(node('#calendar-tools-title').textContent,'搜索日程');
 node('#calendar-search').value='meeting';node('#calendar-search').handlers.input();assert.equal(api.state.query,'meeting');assert.equal(node('#calendar-search-open').dataset.filtered,'true');
 node('#calendar-tools-done').handlers.click();assert(!node('#calendar-tools-dialog').open);assert(node('#calendar-search-open').focused);assert.equal(api.state.query,'meeting');
 node('#calendar-filter-open').handlers.click();assert.equal(node('#calendar-tools-title').textContent,'筛选与日期跳转');node('#calendar-source').value='tasks';node('#calendar-source').handlers.change();assert.equal(node('#calendar-filter-open').dataset.filtered,'true');
 node('#calendar-reset-filters').handlers.click();assert.equal(api.state.query,'');assert.equal(api.state.source,'all');assert.equal(node('#calendar-filter-open').dataset.filtered,'false');
 node('#calendar-tools-close').handlers.click();assert(!node('#calendar-tools-dialog').open);assert(node('#calendar-filter-open').focused);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys()){if(id.startsWith('#'))assert(html.includes('id="'+id.slice(1)+'"'),id);}
 console.log('Calendar interactions passed: rapid navigation, stale detail rejection, source/search filtering, keyboard date hooks and account-response guard.');
})().catch(e=>{console.error(e);process.exitCode=1;});
