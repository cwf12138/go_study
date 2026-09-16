(() => {
 'use strict';
 const $=s=>document.querySelector(s),panel=$('#panel-explore');
 const state={token:'',epoch:0,items:[],tab:'letter',page:1,busy:false,loaded:false,pending:{},drafts:{}};
 const controllers=new Set();
 const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const date=v=>new Date(v).toLocaleString('zh-CN',{hour12:false});
 const status=v=>{$('#explore-status').textContent=v;};
 function sync(){const token=localStorage.getItem('studyflow.token')||'';if(token===state.token)return;state.epoch++;controllers.forEach(c=>c.abort());Object.assign(state,{token,items:[],page:1,busy:false,loaded:false,pending:{},drafts:{}});$('#explore-letter-form').reset();$('#explore-challenge-form').reset();status('账号已更新，等待加载。');render();}
 async function request(path='',options={}){
  const token=state.token,epoch=state.epoch;if(!token)throw Error('请先登录');
  if(token!==(localStorage.getItem('studyflow.token')||'')){sync();throw Error('账号已切换');}
  const c=new AbortController();controllers.add(c);const timer=setTimeout(()=>c.abort(),20000);
  try{const r=await fetch('/api/v1/explore'+path,{...options,signal:c.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});const p=await r.json();if(epoch!==state.epoch||token!==(localStorage.getItem('studyflow.token')||'')){sync();throw Error('账号已切换');}if(!r.ok){const error=Error(r.status===404?'探索接口未找到，请重启更新后的 Go 服务。':p.error?.message||'请求失败');error.httpStatus=r.status;throw error;}return p.data;}finally{clearTimeout(timer);controllers.delete(c);}
 }
 async function run(action){sync();if(state.busy)return;const epoch=state.epoch;state.busy=true;render();try{await action();}catch(e){if(epoch===state.epoch)status('未完成：'+(e.name==='AbortError'?'请求超时，请刷新核对或重试。':e.message)+' 草稿仍保留。');}finally{if(epoch===state.epoch){state.busy=false;render();}}}
 function upsert(item){state.items=[item,...state.items.filter(v=>v.id!==item.id)];}
 function render(){
  panel.querySelectorAll('[data-explore-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.exploreTab===state.tab)));
  const keepsake=state.tab==='place'||state.tab==='exhibit';
  $('#keepsake-workspace').classList.toggle('hidden',!keepsake);panel.querySelector('.explore-layout').classList.toggle('hidden',keepsake);$('#explore-status').classList.toggle('hidden',keepsake);$('#explore-refresh').classList.toggle('hidden',keepsake);
  if(keepsake){document.dispatchEvent(new CustomEvent('studyflow:keepsakes',{detail:state.tab}));return;}
  ['letter','challenge'].forEach(kind=>{const form=$('#explore-'+kind+'-form');form.classList.toggle('hidden',state.tab!==kind);form.querySelectorAll('input,textarea,select').forEach(f=>f.disabled=state.busy||!!state.pending[kind]);form.querySelector('button[type=submit]').disabled=state.busy;form.querySelector('button[type=submit]').textContent=state.pending[kind]?'重试上次提交':kind==='letter'?'封存这封信':'拆开生活盲盒';});
  $('#explore-refresh').disabled=state.busy;$('#explore-list-title').textContent=state.tab==='letter'?'我的时光信件':'我的生活小冒险';
  const filter=$('#explore-filter').value;const items=state.items.filter(e=>e.kind===state.tab).filter(e=>filter==='all'||(filter==='done')===(e.kind==='letter'?!e.locked:!!e.completed_at));
  const pages=Math.max(1,Math.ceil(items.length/6));state.page=Math.min(state.page,pages);$('#explore-page').textContent=`${state.page} / ${pages} · ${items.length} 条`;$('#explore-prev').disabled=state.page<=1;$('#explore-next').disabled=state.page>=pages;
  $('#explore-list').innerHTML=items.slice((state.page-1)*6,state.page*6).map(e=>e.kind==='letter'?`<article class="explore-letter ${e.locked?'sealed':''}"><div class="explore-record-meta"><span>${e.locked?'✉ 等待开启':'✉ 已解锁'} · ${esc(e.mood)}</span><time>${date(e.created_at)}</time></div><h4>${esc(e.title)}</h4><p class="explore-note">${date(e.unlock_at)} 解锁（当前设备时间）</p>${e.locked?'<div class="explore-seal">寄给未来，静候时光。</div>':`<details><summary>打开这封信</summary><p class="explore-letter-body">${esc(e.body)}</p></details>`}</article>`:`<article class="explore-challenge"><div class="explore-record-meta"><span>${e.completed_at?'✓ 已完成':'✦ 待体验'} · ${e.minutes} 分钟 · ${e.budget?e.budget+' 元以内':'免费'}</span><span>${e.place==='indoor'?'室内':'户外'}</span></div><h4>${esc(e.title)}</h4><p>${esc(e.body)}</p>${e.completed_at?`<p class="explore-note">完成于 ${date(e.completed_at)}</p><p class="explore-letter-body">${esc(e.reflection||'没有留下感受，也是一段小经历。')}</p>`:`<form data-explore-complete="${esc(e.id)}"><label>留一点感受（可选）<textarea maxlength="3000" rows="2" data-explore-reflection="${esc(e.id)}" ${state.busy?'disabled':''}>${esc(state.drafts[e.id]||'')}</textarea></label><button class="quiet" type="submit" ${state.busy?'disabled':''}>我体验过了 ✓</button></form>`}</article>`).join('')||`<div class="explore-empty">${!state.loaded?'记录尚未加载，请刷新。':state.tab==='letter'?'这里还没有符合条件的信件。写下第一封，留给未来一个惊喜。':'这里还没有符合条件的挑战。拆开一个盲盒，从一件小事开始。'}</div>`;
 }
 function load(){return run(async()=>{status('正在核对探索记录…');const items=await request();if(!Array.isArray(items))throw Error('记录格式无效');state.items=items;state.loaded=true;for(const kind of ['letter','challenge']){if(state.pending[kind]&&items.some(e=>e.id===state.pending[kind].id)){delete state.pending[kind];$('#explore-'+kind+'-form').reset();}}status('记录已同步；解锁时间由服务端判定。');});}
 function create(kind,event){event.preventDefault();sync();if(state.busy)return;const form=event.currentTarget;if(!state.pending[kind]&&!form.reportValidity())return;
  if(!state.pending[kind]){
   if(kind==='letter'){
    const unlock=new Date($('#explore-unlock').value);if(!Number.isFinite(unlock.getTime())||unlock<=new Date()){status('请选择未来的解锁时间。');return;}
    if(!window.confirm('封存后不能修改，到约定时间才能阅读正文。确认寄给未来的自己？'))return;
    state.pending[kind]={id:crypto.randomUUID(),title:$('#explore-title').value,body:$('#explore-body').value,mood:$('#explore-mood').value,unlock_at:unlock.toISOString()};
   }else state.pending[kind]={id:crypto.randomUUID(),minutes:Number($('#explore-minutes').value),budget:Number($('#explore-budget').value),place:$('#explore-place').value};
  }
  run(async()=>{status('正在保存，请稍候…');let item;try{item=await request('/'+kind,{method:'POST',body:JSON.stringify(state.pending[kind])});}catch(error){if([400,401,403,404,409].includes(error.httpStatus))delete state.pending[kind];throw error;}upsert(item);delete state.pending[kind];form.reset();state.page=1;$('#explore-filter').value='all';status(kind==='letter'?'已封存。让时间替你保管这份期待。':'盲盒已拆开。按自己的节奏体验就好。');});
 }
 $('#explore-letter-form').addEventListener('submit',e=>create('letter',e));$('#explore-challenge-form').addEventListener('submit',e=>create('challenge',e));
 $('#explore-refresh').addEventListener('click',load);$('#explore-filter').addEventListener('change',()=>{state.page=1;render();});
 $('#explore-prev').addEventListener('click',()=>{state.page=Math.max(1,state.page-1);render();});$('#explore-next').addEventListener('click',()=>{state.page++;render();});
 panel.querySelectorAll('[data-explore-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.exploreTab;state.page=1;render();}));
 $('#explore-list').addEventListener('input',e=>{if(e.target.dataset.exploreReflection)state.drafts[e.target.dataset.exploreReflection]=e.target.value;});
 $('#explore-list').addEventListener('submit',e=>{const form=e.target.closest('[data-explore-complete]');if(!form)return;e.preventDefault();const id=form.dataset.exploreComplete;run(async()=>{const item=await request('/'+encodeURIComponent(id)+'/completion',{method:'PUT',body:JSON.stringify({reflection:state.drafts[id]||''})});upsert(item);delete state.drafts[id];status('已记下这次体验。');});});
 new MutationObserver(()=>{sync();if(panel.classList.contains('active')&&state.token)load();}).observe(panel,{attributes:true,attributeFilter:['class']});
 new MutationObserver(sync).observe($('#app-view'),{attributes:true,attributeFilter:['class']});window.addEventListener('storage',e=>{if(e.key==='studyflow.token'){sync();if(panel.classList.contains('active')&&state.token)load();}});
 window.addEventListener('beforeunload',e=>{if($('#explore-body').value||Object.values(state.drafts).some(Boolean)||Object.keys(state.pending).length){e.preventDefault();e.returnValue='';}});
 window.setInterval(()=>{if(!document.hidden&&panel.classList.contains('active')&&!state.busy&&state.items.some(e=>e.locked&&new Date(e.unlock_at)<=new Date()))load();},60000);
 sync();render();if(panel.classList.contains('active')&&state.token)load();
})();
