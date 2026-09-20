(() => {
 'use strict';
 const $=s=>document.querySelector(s),panel=$('#panel-daily');
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const state={token:'',epoch:0,card:null,busy:false,loaded:false,date:today()},controllers=new Set();
 const status=t=>$('#daily-status').textContent=t;
 function render(){
  $('#daily-date-label').textContent=state.date.replaceAll('-',' / ');
  $('#daily-luck').textContent=state.card?.title||'签';
  $('#daily-message').textContent=state.card?.body||'轻点下方，为今天抽一支签。';
  $('#daily-slip').dataset.drawn=String(!!state.card);
  $('#daily-draw').disabled=state.busy||!state.loaded||!!state.card;
  $('#daily-draw').textContent=state.busy?'请稍候…':state.card?'今日已抽 · 明天再来':'抽取今日签';
  $('#daily-retry').classList.toggle('hidden',state.loaded||state.busy);
 }
 function sync(){
  const token=localStorage.getItem('studyflow.token')||'';
  if(token===state.token)return;
  controllers.forEach(c=>c.abort());state.epoch++;
  Object.assign(state,{token,card:null,busy:false,loaded:false,date:today()});
  status('正在查看今日签…');render();
 }
 async function request(draw){
  const epoch=state.epoch,token=state.token,c=new AbortController();controllers.add(c);
  const timeout=setTimeout(()=>c.abort(),20000);
  try{
   if(!token)throw Error('请先登录');
   const r=await fetch('/api/v1/daily-card'+(draw?'/draw':''),{method:draw?'POST':'GET',headers:{Authorization:'Bearer '+token},signal:c.signal});
   const data=await r.json();
   if(epoch!==state.epoch||token!==localStorage.getItem('studyflow.token')){sync();throw Error('账号已切换');}
   if(!r.ok)throw Error(data.error?.message||'请求失败');
   if(data.data?.kind!=='daily'||!/^\d{4}-\d{2}-\d{2}$/.test(data.data.date)||draw&&!data.data.body)throw Error('签文数据不完整，请重试');
   return data.data;
  }finally{clearTimeout(timeout);controllers.delete(c);}
 }
 async function run(draw=false){
  sync();if(state.busy)return;
  // Recheck at midnight before allowing a new draw.
  if(draw&&state.date!==today()){state.card=null;state.loaded=false;draw=false;}
  if(draw&&(!state.loaded||state.card))return;
  const epoch=state.epoch;state.busy=true;status(draw?'正在抽取今日签…':'正在查看今日签…');render();
  try{const card=await request(draw);if(epoch!==state.epoch)return;state.card=card.body?card:null;state.date=card.date;state.loaded=true;status(card.body?'今日签已保存，刷新不会重新抽取。':'每天只抽一次，点一下就好。');}
  catch(e){if(epoch===state.epoch){state.loaded=false;status(e.name==='AbortError'?'请求超时，请重新加载核对结果。':'未完成：'+e.message+'。请重新加载。');}}
  finally{if(epoch===state.epoch){state.busy=false;render();}}
 }
 $('#daily-draw').addEventListener('click',()=>run(true));
 $('#daily-retry').addEventListener('click',()=>run());
 function enter(){sync();if(panel.classList.contains('active')&&state.token&&(!state.loaded||state.date!==today()))run();}
 new MutationObserver(enter).observe(panel,{attributes:true,attributeFilter:['class']});
 new MutationObserver(sync).observe($('#app-view'),{attributes:true,attributeFilter:['class']});
 window.addEventListener('storage',e=>{if(e.key==='studyflow.token')enter();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)enter();});
 window.setInterval(()=>{if(!document.hidden)enter();},60000);
 sync();render();enter();
})();
