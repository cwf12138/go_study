(function(root,factory){'use strict';const core=factory();if(typeof module==='object'&&module.exports)module.exports=core;else root.DaynestSaveCore=core;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const families={memos:'备忘录','memo-folders':'备忘录文件夹',todos:'待办','todo-lists':'待办分类','todo-imports':'离线待办','calendar/events':'日程','calendar/event-commands':'新建日程'};
  function route(path){const clean=String(path).split('?')[0];for(const [prefix,label] of Object.entries(families)){const base='/api/v1/'+prefix;if(clean===base||clean.startsWith(base+'/'))return{label,topic:prefix,resource:clean.slice(base.length+1).split('/')[0]||''};}return null;}
  function tracked(path,method='GET'){return ['POST','PUT','PATCH','DELETE'].includes(String(method).toUpperCase())&&!!route(path);}
  const same=(a,b)=>!!a&&!!b&&a.token===b.token&&a.server===b.server&&a.userID===b.userID&&a.session===b.session;
  const validReceipt=value=>typeof value==='string'&&/^w1\.[a-f0-9]{32}\.[1-9][0-9]{0,19}\.[A-Za-z0-9_-]{43}$/.test(value);
  const labels={sending:'正在提交',waiting_snapshot:'已提交 · 等待快照',snapshot_written:'已纳入成功快照',snapshot_failed:'快照写入失败',needs_review:'结果需核对',received:'已提交 · 无快照凭据',rejected:'本次提交未确认'};
  function validResult(path,method,data,context,cores={}){
    if(!tracked(path,method))return true;
    const info=route(path);
    if(data===null)return method==='DELETE';
    if(!data||typeof data!=='object'||Array.isArray(data))return false;
    if(info.topic==='calendar/event-commands')return typeof data.created==='boolean'&&!!data.receipt&&(data.event===null||!!cores.DaynestCalendarEditorCore?.valid(data.event,context.userID));
    if(info.topic==='todo-imports')return typeof data.created==='boolean'&&!!data.receipt&&(data.todo===null||!!cores.DaynestTodoEditorCore?.valid(data.todo,context.userID));
    if(info.topic==='memos'&&path.endsWith('/actions'))return typeof data.created==='boolean'&&typeof data.matches_request==='boolean'&&!!cores.DaynestActionCore?.validContext(data.context,context.userID);
    if(typeof data.id!=='string'||data.user_id!==context.userID)return false;
    if(info.resource&&!(info.topic==='memos'&&path.endsWith('/duplicate'))&&data.id!==info.resource)return false;
    if(info.topic==='todos')return !!cores.DaynestTodoEditorCore?.valid(data,context.userID);
    if(info.topic==='calendar/events')return !!cores.DaynestCalendarEditorCore?.valid(data,context.userID);
    if(info.topic==='memos')return typeof data.content==='string'&&typeof data.title==='string'&&Number.isFinite(Date.parse(data.updated_at));
    return typeof data.name==='string';
  }
  function create({limit=60,now=()=>Date.now()}={}){
    let owner=null,rows=[],overflow=0,serial=0;
    function reset(context=null){owner=context;rows=[];overflow=0;}
    function observe(event){
      if(!tracked(event.path,event.method))return false;
      if(!same(owner,event.context)){if(event.phase!=='start')return false;reset(event.context);}
      if(event.phase==='start'){
        const info=route(event.path);
        if(rows.length>=limit){const index=rows.findIndex(row=>row.state!=='sending');if(index<0){overflow++;return true;}const old=rows.splice(index,1)[0];if(!['snapshot_written','rejected'].includes(old.state))overflow++;}
        rows.push({key:++serial,id:event.id,...info,method:event.method,startedAt:now(),state:'sending',receipt:'',uncertain:false,snapshotAt:null,checkError:false});return true;
      }
      const row=rows.find(row=>row.id===event.id);if(!row)return false;
      row.finishedAt=now();row.receipt=validReceipt(event.receipt)?event.receipt:'';row.uncertain=!!event.uncertain;
      row.state=event.accepted?(row.receipt?'waiting_snapshot':'received'):event.uncertain?'needs_review':'rejected';
      const result=event.data;
      // Keep only record identifiers; never retain titles, request bodies or replies.
      if(event.accepted){const id=result?.event?.id||result?.todo?.id||result?.context?.todo?.id||result?.id;if(typeof id==='string'&&id.length<=160){if(row.topic==='calendar/event-commands')row.topic='calendar/events';row.resource=id;}}
      return true;
    }
    function apply(context,proofs){
      if(!same(owner,context)||!Array.isArray(proofs)||proofs.length>20)return false;
      for(const proof of proofs){if(!proof||!validReceipt(proof.receipt))continue;
        for(const row of rows.filter(item=>item.receipt===proof.receipt)){
          if(!['waiting_snapshot','snapshot_failed','needs_review'].includes(row.state))continue;
          row.checkError=false;
          if(proof.state==='snapshot_written'&&Number.isFinite(Date.parse(proof.snapshot_at))){row.snapshotAt=proof.snapshot_at;if(!row.uncertain)row.state='snapshot_written';}
          else if(proof.state==='snapshot_failed'&&!row.uncertain)row.state='snapshot_failed';
          else if(proof.state==='unverifiable'){row.state='needs_review';row.uncertain=true;row.receipt='';}
          else if(proof.state!=='waiting_snapshot')row.checkError=true;
        }
      }return true;
    }
    function pending(){return rows.filter(row=>row.receipt&&!row.snapshotAt&&['waiting_snapshot','snapshot_failed','needs_review'].includes(row.state));}
    function failed(context){if(same(owner,context))for(const row of pending())row.checkError=true;}
    function summary(){
      const counts={};for(const row of rows)counts[row.state]=(counts[row.state]||0)+1;
      const state=overflow?'needs_review':['needs_review','snapshot_failed','sending','waiting_snapshot','received','rejected','snapshot_written'].find(key=>counts[key])||'idle';
      return{state,label:state==='idle'?'保存状态':labels[state],counts,overflow,total:rows.length};
    }
    return{observe,apply,failed,reset,summary,pending,rows:()=>rows.map(row=>({...row})),context:()=>owner,latest:(topic,resource)=>resource?[...rows].reverse().find(row=>row.topic===topic&&row.resource===resource):undefined};
  }
  return{create,tracked,route,same,validReceipt,validResult,labels};
});
