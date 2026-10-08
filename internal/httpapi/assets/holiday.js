(() => {
  'use strict';
  const $=id=>document.getElementById('holiday-'+id),app=document.getElementById('app-view');
  if(!$('trigger')||!app)return;
  const token=()=>localStorage.getItem('studyflow.token')||'';
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const state={token:'',epoch:0,day:'',checked:0,data:null,busy:false,controller:null};
  const active=()=>!!token()&&!app.classList.contains('hidden')&&!document.hidden;
  const status=text=>$('status').textContent=text;
  function render(message=''){
    const next=state.data?.next,current=state.data?.current;
    $('name').textContent=next?'距'+next.name:'下个节假日';
    $('days').textContent=next?String(next.days_until):'—';
    $('caption').textContent=message||(next?(next.confirmed?next.start_date.slice(5).replace('-','月')+'日开始放假':'节日当天 · 调休待更新'):'暂无节假日数据');
    $('detail-name').textContent=next?next.name:'下个节假日';
    $('detail-days').textContent=next?`还有 ${next.days_until} 天`:'—';
    $('detail-dates').textContent=next?(next.confirmed?`${next.start_date} 至 ${next.end_date} · 共 ${next.duration} 天假期`:`${next.start_date} · 节日当天，非已确认放假首日`):'';
    $('current').textContent=current?(current.confirmed?`正在 ${current.name} 假期中，至 ${current.end_date}。`:`今天是${current.name}；调休安排尚未收录。`):'';
    $('source').hidden=true;$('source').removeAttribute('href');
    if(next?.confirmed&&next.source_url){
      try{const url=new URL(next.source_url);if(url.protocol==='https:'&&!url.username&&!url.password&&['www.beijing.gov.cn','www.gov.cn'].includes(url.hostname)){$('source').href=url.href;$('source').hidden=false;}}catch{}
    }
    $('retry').disabled=state.busy;$('retry').textContent=state.busy?'正在更新…':'刷新';
    $('trigger').setAttribute('aria-label',next?`距离${next.name}${next.confirmed?'放假首日':'节日当天'}还有 ${next.days_until} 天，点击查看详情`:'节假日倒计时，'+(message||'点击查看详情'));
  }
  function reset(){state.controller?.abort();state.epoch++;Object.assign(state,{token:token(),day:'',checked:0,data:null,busy:false,controller:null});if($('dialog').open)$('dialog').close();status('');render('正在查看假期…');}
  function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
  function validHoliday(value){return value===null||value&&typeof value.name==='string'&&value.name.length>0&&value.name.length<60&&validDate(value.start_date)&&validDate(value.end_date)&&value.end_date>=value.start_date&&Number.isInteger(value.days_until)&&value.days_until>=0&&value.days_until<=370&&typeof value.confirmed==='boolean'&&Number.isInteger(value.duration)&&(value.confirmed?value.duration>0&&value.duration<=31:value.duration===0);}
  async function refresh(force=false){
    if(token()!==state.token)reset();
    if(!active()||state.busy)return;
    const day=today(),changed=state.day!==day;
    if(!force&&!changed&&Date.now()-state.checked<(state.data?900000:60000))return;
    if(changed)state.data=null;
    const epoch=++state.epoch,account=state.token,controller=new AbortController();state.controller=controller;state.busy=true;render(state.data?'':'正在查看假期…');
    const timeout=window.setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch('/api/v1/holidays/next',{headers:{Authorization:'Bearer '+account},signal:controller.signal});
      const payload=await response.json().catch(()=>null);
      if(!response.ok)throw Error(response.status===404?'节假日接口尚未加载，请重启 Go 服务后刷新页面。':response.status===401?'登录已过期，请重新登录。':'节假日请求失败，请稍后重试。');
      const data=payload?.data;
      if(!data||!validDate(data.today)||data.timezone!=='Asia/Shanghai'||!validHoliday(data.next)||!validHoliday(data.current))throw Error('节假日数据不完整，请更新服务后重试。');
      if(epoch!==state.epoch||account!==token())return;
      state.data=data;
      status(data.next?(data.next.confirmed?'已核实放假安排 · 按北京时间计算。':`尚未收录该年的官方调休安排（已核实至 ${data.schedule_through} 年），当前只倒计时到节日当天。`):'当前日期暂无可用节假日数据，请检查服务器时间。');
    }catch(error){
      if(epoch!==state.epoch||account!==token())return;
      state.data=null;status(error.name==='AbortError'?'请求超时，请点击刷新重试。':error.message);
    }finally{
      window.clearTimeout(timeout);
      if(epoch===state.epoch&&account===token()){state.busy=false;state.day=day;state.checked=Date.now();state.controller=null;render(state.data?'':'暂不可用 · 点击重试');}
    }
  }
  $('trigger').addEventListener('click',()=>{if(!active())return;$('dialog').showModal();refresh();});
  $('close').addEventListener('click',()=>$('dialog').close());
  $('retry').addEventListener('click',()=>refresh(true));
  new MutationObserver(()=>{if(token()!==state.token)reset();refresh();}).observe(app,{attributes:true,attributeFilter:['class']});
  document.getElementById('logout').addEventListener('click',reset);
  document.addEventListener('visibilitychange',()=>refresh());
  window.addEventListener('focus',()=>refresh());
  window.addEventListener('storage',e=>{if(e.key==='studyflow.token'){reset();refresh();}});
  window.addEventListener('pagehide',()=>state.controller?.abort());
  window.setInterval(()=>refresh(),60000);
  reset();refresh();
})();
