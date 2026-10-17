(() => {
  'use strict';
  const category={strength:'力量',cardio:'有氧 / 步行',mobility:'舒展 / 活动'},equipment={none:'无需器械',chair:'稳固椅子 / 墙面',dumbbell:'轻量负重'};
  const moves={
    walk:{name:'舒适步行',mode:'time',target:180,sets:1,rest_seconds:30,instruction:'在安全、平坦的空间，以适合自己的节奏行走。需要时减速或停止；计时只是参考，不代表实际步数。'},
    march:{name:'轻松原地踏步',mode:'time',target:60,sets:1,rest_seconds:30,instruction:'附近留出空间，缓慢交替抬脚，保持自然呼吸。若站立不稳请停止，不强求幅度。'},
    chair:{name:'坐下再起立',mode:'reps',target:5,sets:1,rest_seconds:45,instruction:'使用无轮、不滑动的稳固椅子。双脚稳稳落地，在舒适范围内缓慢站起和坐下，必要时借助手臂。'},
    wall:{name:'墙壁俯卧撑',mode:'reps',target:5,sets:2,rest_seconds:45,instruction:'面向稳固墙面，双手置于胸前高度，背部保持自然平直，缓慢屈肘靠近墙面再推回。距离与幅度按能力调整，不憋气。'},
    calf:{name:'扶椅提踵',mode:'reps',target:5,sets:1,rest_seconds:30,instruction:'扶住稳固椅背，缓慢抬起脚跟，再控制着放下。以平衡和舒适为前提，避免快速弹动。'},
    side:{name:'扶椅侧抬腿',mode:'reps',target:5,sets:1,rest_seconds:30,instruction:'扶住稳固支撑，身体保持正直，小幅向侧面抬腿再放回。左右各按舒适程度完成，不侧倾或追求高度。'},
    shoulders:{name:'轻柔肩部活动',mode:'time',target:30,sets:1,rest_seconds:15,instruction:'坐稳或站稳，肩部在舒适范围内缓慢活动，避免用力甩动。不适时立即停止。'},
    ankles:{name:'坐姿踝部活动',mode:'time',target:30,sets:1,rest_seconds:15,instruction:'坐在稳固椅子上，缓慢交替抬起脚尖和脚跟，保持舒适范围，不强压或憋气。'},
    curl:{name:'轻量手臂弯举',mode:'reps',target:5,sets:2,rest_seconds:45,instruction:'选择可轻松控制的负重，手臂靠近身体，缓慢屈肘再放回。可坐姿完成；不要摆动身体或忍痛增加重量。'}
  };
  const clone=v=>JSON.parse(JSON.stringify(v));
  const build=(key,override={})=>({...moves[key],...override,done:0,skipped:0});
  const templates=[
    {id:'fit-template-start',title:'从动一动开始',category:'strength',equipment:'chair',note:'轻量入门示例，按自身能力减少动作或组数。',moves:[build('walk',{target:120}),build('chair'),build('wall',{sets:1}),build('calf'),build('shoulders')]},
    {id:'fit-template-break',title:'给久坐一个间隙',category:'mobility',equipment:'chair',note:'短时活动示例，不是针对疼痛的康复训练。',moves:[build('ankles'),build('shoulders'),build('walk',{target:120,rest_seconds:0})]},
    {id:'fit-template-walk',title:'一小段舒适步行',category:'cardio',equipment:'none',note:'强度和时长由自己选择，注意环境与天气，不做步数或热量推算。',moves:[build('walk',{target:120,rest_seconds:0}),build('walk',{target:480,rest_seconds:0}),build('walk',{target:60,rest_seconds:0})]},
    {id:'fit-template-lower',title:'稳稳练一练下肢',category:'strength',equipment:'chair',note:'稳固支撑优先；可先另存并缩减组数，不追求动作幅度。',moves:[build('march'),build('chair',{sets:2}),build('calf',{sets:2}),build('side'),build('walk',{target:60,rest_seconds:0})]},
    {id:'fit-template-upper',title:'轻量上肢练习',category:'strength',equipment:'dumbbell',note:'需要可安全控制的轻量负重及稳固墙面，可按能力调整。',moves:[build('march'),build('shoulders'),build('wall'),build('curl'),build('walk',{target:60,rest_seconds:0})]}
  ];
  function today(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
  function shift(date,n){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function validDay(date){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&date>='2000-01-01'&&date<='2100-12-31'&&!Number.isNaN(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}
  function week(date){const weekday=new Date(date+'T00:00:00Z').getUTCDay();const monday=shift(date,-((weekday+6)%7));return Array.from({length:7},(_,i)=>shift(monday,i));}
  function liveDelta(row,now){return row.state==='active'?Math.max(0,Math.floor((now-Date.parse(row.running_since))/1000))||0:0;}
  function elapsed(row,now=Date.now()){return Math.min(86400,row.elapsed_seconds+liveDelta(row,now));}
  function remaining(row,now=Date.now()){return Math.max(0,row.remaining_seconds-liveDelta(row,now));}
  function clock(seconds){const n=Math.max(0,Math.floor(seconds));return n>=3600?`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
  function progress(row){return row.moves.reduce((a,m)=>({done:a.done+m.done,skipped:a.skipped+m.skipped,total:a.total+m.sets}),{done:0,skipped:0,total:0});}
  function estimate(row){return Math.max(1,Math.ceil(row.moves.reduce((sum,m)=>sum+m.sets*((m.mode==='time'?m.target:m.target*4)+m.rest_seconds),0)/60));}
  function records(rows){return rows.filter(r=>!r.deleted&&(r.kind==='log'||r.kind==='session'&&['completed','stopped'].includes(r.state)));}
  function summary(rows,day){const days=week(day),logs=records(rows).filter(r=>days.includes(r.date)),done=logs.filter(r=>r.state==='completed');return {days,logs,minutes:Math.floor(logs.reduce((n,r)=>n+r.elapsed_seconds,0)/60),sessions:done.length,activeDays:new Set(logs.filter(r=>r.elapsed_seconds>0||progress(r).done>0).map(r=>r.date)).size,sets:logs.reduce((n,r)=>n+progress(r).done,0)};}
  function csv(rows){const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const data=[['日期','训练','类型','状态','记录秒数（含休息）','完成组','跳过组','自评1–5','备注'],...records(rows).map(r=>[r.date,r.title,category[r.category],r.state,r.elapsed_seconds,progress(r).done,progress(r).skipped,r.effort||'',r.note])];return '\uFEFF'+data.map(r=>r.map(cell).join(',')).join('\r\n');}
  window.DaynestFitness=Object.freeze({templates,moves,clone,build,category,equipment,today,shift,validDay,week,elapsed,remaining,clock,progress,estimate,records,summary,csv});
})();
