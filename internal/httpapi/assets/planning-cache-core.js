(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./read-cache-core.js'):root.DaynestReadCacheCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.DaynestPlanningCache=api;})(typeof window==='undefined'?globalThis:window,C=>{
  'use strict';
  const MAX_BYTES=512*1024,MAX_TODOS=500,MAX_DAYS=7,MAX_ITEMS=300,ZONE='Asia/Shanghai';
  const id=v=>typeof v==='string'&&/^[\w-]{1,160}$/.test(v),text=(v,max=6000)=>typeof v==='string'&&v.length<=max;
  const fail=()=>{throw Error('安排快照数据不完整，请在线核对后再更新。');};
  function isoDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('日期格式或日期值无效。');return v;}
  function day(v){isoDate(v);if(!v.startsWith('20'))throw Error('安排日期需为 2000–2099 年的有效日期。');return v;}
  function nextDay(v){return new Date(Date.parse(day(v)+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
  function today(now=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=k=>parts.find(p=>p.type===k).value;return`${get('year')}-${get('month')}-${get('day')}`;}
  function timestamp(v){try{C.version(v);}catch(_){fail();}return v;}
  function tags(v){if(v==null)return[];if(!Array.isArray(v)||v.length>100||v.some(t=>!text(t,200)))fail();return[...v];}
  function todo(row,user){
    if(!row||!id(row.id)||row.user_id!==user||!id(row.list_id)||!text(row.title,400)||!text(row.notes,12000)||!['low','medium','high'].includes(row.priority)||!['open','completed'].includes(row.status)||!['','none','daily','weekly','monthly'].includes(row.repeat_rule))fail();
    const steps=row.steps==null?[]:row.steps;if(!Array.isArray(steps)||steps.length>100)fail();const seen=new Set();
    const safe={id:row.id,list_id:row.list_id,title:row.title,notes:row.notes,priority:row.priority,status:row.status,repeat_rule:row.repeat_rule||'none',tags:tags(row.tags),steps:steps.map(step=>{if(!step||!id(step.id)||seen.has(step.id)||!text(step.title,400)||typeof step.completed!=='boolean')fail();seen.add(step.id);return{id:step.id,title:step.title,completed:step.completed};}),created_at:timestamp(row.created_at),updated_at:timestamp(row.updated_at),due_at:row.due_at?timestamp(row.due_at):null,my_day_date:row.my_day_date?isoDate(row.my_day_date):'',completed_at:row.completed_at?timestamp(row.completed_at):null};
    return safe;
  }
  function lists(rows,user){if(!Array.isArray(rows)||rows.length>500)fail();const seen=new Set();return rows.map(row=>{if(!row||row.user_id!==user||!id(row.id)||seen.has(row.id)||!text(row.name,160))fail();seen.add(row.id);return{id:row.id,name:row.name};});}
  function rows(data,key){if(!Object.hasOwn(data,key)||data[key]!==null&&!Array.isArray(data[key]))fail();const out=data[key]||[];if(out.length>2000)throw Error('该日安排过多，未保存不完整快照。');return out;}
  function owned(row,user){if(!row||row.user_id!==user||!id(row.id))fail();}
  function project(overview,date,user){
    day(date);if(!overview||overview.start!==date||overview.end!==nextDay(date)||!Array.isArray(overview.days)||overview.days.length!==1||overview.days[0].date!==date)fail();
    const info=overview.days[0],start=Date.parse(date+'T00:00:00+08:00'),end=start+86400000,items=[],keys=new Set();
    const add=(type,row,title,{startAt=null,endAt=null,allDay=false,status='',description='',location='',key=''}={})=>{
      if(!text(title,500)||!text(description,20000)||!text(location,1000)||!text(status,100))fail();
      if(startAt)timestamp(startAt);if(endAt)timestamp(endAt);if(startAt&&endAt&&Date.parse(endAt)<=Date.parse(startAt))fail();
      const overlaps=startAt&&(endAt?Date.parse(endAt)>start&&Date.parse(startAt)<end:Date.parse(startAt)>=start&&Date.parse(startAt)<end);
      if(startAt&&!overlaps)return;
      const itemKey=C.hash(JSON.stringify([type,key||row.id||row.item_id||date,startAt,endAt]));if(keys.has(itemKey))fail();keys.add(itemKey);
      items.push({key:itemKey,type,title,status,description,location,start_at:startAt,end_at:endAt,all_day:!!allDay});
    };
    for(const row of rows(overview,'events')){owned(row,user);timestamp(row.occurrence_start);timestamp(row.occurrence_end);if(typeof row.all_day!=='boolean')fail();add('event',row,row.title,{startAt:row.occurrence_start,endAt:row.occurrence_end,allDay:row.all_day,description:row.description||'',location:row.location||'',key:row.occurrence_id||row.id});}
    for(const row of rows(overview,'plan_blocks')){owned(row,user);timestamp(row.start_at);timestamp(row.end_at);if(!['planned','in_progress','completed','skipped'].includes(row.status))fail();add('plan',row,row.title,{startAt:row.start_at,endAt:row.end_at,status:row.status,description:row.notes||''});}
    for(const row of rows(overview,'tasks')){owned(row,user);if(!row.due_at)fail();add('task',row,row.title,{startAt:row.due_at,status:row.status||'',description:row.description||''});}
    for(const row of rows(overview,'todos')){const safe=todo(row,user);if(safe.due_at)add('todo',row,safe.title,{startAt:safe.due_at,status:safe.status,description:safe.notes});else if(safe.my_day_date===date)add('todo',row,safe.title,{allDay:true,status:safe.status,description:safe.notes});else fail();}
    for(const row of rows(overview,'focus_sessions')){owned(row,user);timestamp(row.started_at);if(row.status!=='completed'||!Number.isInteger(row.actual_minutes)||row.actual_minutes<0)fail();add('focus',row,row.title_snapshot||'专注记录',{startAt:row.started_at,status:'completed',description:`已完成 ${row.actual_minutes} 分钟专注`});}
    const moods={awful:'低落',bad:'不太好',low:'不太好',neutral:'平静',good:'不错',great:'很好'};
    for(const row of rows(overview,'mood_entries')){owned(row,user);if(row.date!==date||!moods[row.mood])fail();add('mood',row,`心情 · ${moods[row.mood]}`,{allDay:true});}
    for(const row of rows(overview,'fitness_days')){if(row.date!==date||!Number.isInteger(row.completed_sessions)||row.completed_sessions<0||!Number.isInteger(row.recorded_seconds)||row.recorded_seconds<0||typeof row.manual_check_in!=='boolean')fail();add('fitness',row,'运动 · 已锻炼',{allDay:true,description:`已完成 ${row.completed_sessions} 次训练 · 记录 ${Math.round(row.recorded_seconds/60)} 分钟${row.manual_check_in?' · 已手动打卡':''}`});}
    for(const row of rows(overview,'care_entries')){if(row.date!==date||!id(row.item_id)||!['due','done'].includes(row.kind))fail();add('care',row,row.title,{allDay:true,status:row.kind,key:row.item_id+':'+row.kind});}
    if(items.length>MAX_ITEMS)throw Error('该日安排超过 300 项，未截断保存。');
    if(!text(info.lunar,200)||!text(info.solar_term||'',100)||!text(info.holiday_name||'',200))fail();
    return{date,lunar:info.lunar,solar_term:info.solar_term||'',holiday_name:info.holiday_name||'',festivals:tags(info.festivals),items:items.sort((a,b)=>(a.start_at?Date.parse(a.start_at):-Infinity)-(b.start_at?Date.parse(b.start_at):-Infinity)||a.key.localeCompare(b.key))};
  }
  function nonce(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');}
  function create(storage,server,user,now=()=>Date.now()){
    server=C.origin(server);const key=C.prefix+'planning:'+C.scope(server,user),empty=()=>({schema_version:1,server,userID:user,enabled:false,fence:nonce(),todo:null,days:[],invalidated_at:null});
    function read(){const raw=storage.getItem(key);if(!raw)return empty();if(C.bytes(raw)>MAX_BYTES)throw Error('本机安排快照超过容量限制。');const data=JSON.parse(raw);
      if(data?.schema_version!==1||data.server!==server||data.userID!==user||typeof data.enabled!=='boolean'||typeof data.fence!=='string'||!/^[a-f0-9]{32}$/.test(data.fence)||!Array.isArray(data.days)||data.days.length>MAX_DAYS)fail();
      if(data.invalidated_at)timestamp(data.invalidated_at);
      if(data.todo!==null){const t=data.todo;if(!t||!Array.isArray(t.lists)||!Array.isArray(t.items)||t.items.length>MAX_TODOS||t.time_zone!==ZONE)fail();timestamp(t.read_at);day(t.date);const seen=new Set(),ids=new Set();for(const l of t.lists){if(!id(l.id)||!text(l.name,160)||ids.has(l.id))fail();ids.add(l.id);}for(const row of t.items){const safe=todo({...row,user_id:user},user);if(seen.has(safe.id))fail();seen.add(safe.id);}}
      const dates=new Set();for(const d of data.days){day(d.date);if(dates.has(d.date)||d.time_zone!==ZONE||!Array.isArray(d.items)||d.items.length>MAX_ITEMS||!text(d.lunar,200)||!Array.isArray(d.festivals))fail();dates.add(d.date);timestamp(d.read_at);for(const item of d.items){if(!['event','plan','task','todo','focus','mood','fitness','care'].includes(item.type)||!text(item.title,500)||!text(item.description,20000)||!text(item.location,1000)||!text(item.status,100)||typeof item.all_day!=='boolean'||typeof item.key!=='string')fail();if(item.start_at)timestamp(item.start_at);if(item.end_at)timestamp(item.end_at);}}
      return data;
    }
    function write(data){const raw=JSON.stringify(data);if(C.bytes(raw)>MAX_BYTES)throw Error('安排快照超过 512 KiB，保留了此前副本，没有截断清单。');storage.setItem(key,raw);}
    function setEnabled(enabled){const data=enabled?read():empty();data.enabled=!!enabled;data.fence=nonce();write(data);return data;}
    function invalidate(){const data=read();if(!data.enabled)return;data.fence=nonce();data.todo=null;data.days=[];data.invalidated_at=new Date(now()).toISOString();write(data);}
    function commit(rawLists,rawTodos,overview,date,expectedFence){const data=read();if(!data.enabled||data.fence!==expectedFence)return{stored:false,reason:'changed'};if(!Array.isArray(rawTodos)||rawTodos.length>MAX_TODOS)throw Error('待办超过 500 项或格式不完整，未截断保存。');
      const safeLists=lists(rawLists,user),seen=new Set(),items=rawTodos.map(row=>{const value=todo(row,user);if(seen.has(value.id))fail();seen.add(value.id);return value;}),readAt=new Date(now()).toISOString(),d=project(overview,date,user);
      data.todo={items,lists:safeLists,date,time_zone:ZONE,read_at:readAt};data.days=[{...d,time_zone:ZONE,read_at:readAt},...data.days.filter(v=>v.date!==date)].sort((a,b)=>Date.parse(b.read_at)-Date.parse(a.read_at)).slice(0,MAX_DAYS);data.invalidated_at=null;if(read().fence!==expectedFence)return{stored:false,reason:'changed'};data.fence=nonce();write(data);return{stored:true};
    }
    const forget=()=>storage.removeItem(key);
    return{read,setEnabled,invalidate,commit,forget,key};
  }
  return{create,todo,project,day,nextDay,today,MAX_BYTES,MAX_TODOS,MAX_DAYS,MAX_ITEMS,ZONE};
});
