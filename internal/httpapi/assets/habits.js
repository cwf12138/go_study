(() => {
  'use strict';
  const $ = selector => document.querySelector(selector), panel = $('#panel-habits');
  const state = { items: [], selected: '', month: '', busy: false, loaded: false, epoch: 0 };
  const controllers = new Set();
  const icons = { read: '▤', listen: '♫', write: '✎', move: '↗', water: '☀' };
  const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const localMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
  const current = () => state.items.find(item => item.id === state.selected);
  async function request(path, options={}) {
    const token=localStorage.getItem('studyflow.token'), epoch=state.epoch;
    if(!token) throw new Error('请先登录。');
    const controller=new AbortController(); controllers.add(controller); const timer=setTimeout(()=>controller.abort(),25000);
    try {
      const response=await fetch('/api/v1/habits'+path,{...options,signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
      const payload=await response.json();
      if(epoch!==state.epoch || token!==localStorage.getItem('studyflow.token')) throw new Error('账号已切换，旧请求结果已忽略。');
      if(!response.ok) throw new Error(response.status===404 ? '未找到习惯或接口。新增功能后请重启 Go 服务。' : payload.error?.message || '请求失败，请重试。');
      return payload.data;
    } catch(error) {
      if(error.name==='AbortError') throw new Error('请求超时或已取消，请刷新确认记录后重试。');
      if(error instanceof TypeError) throw new Error('无法连接服务，请检查网络后刷新确认。');
      if(error instanceof SyntaxError) throw new Error('服务返回了无效数据，请重启服务后重试。');
      throw error;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function run(action, message) {
    if(state.busy) return;
    const epoch=state.epoch; state.busy=true; render(); $('#habit-status').textContent='正在同步…';
    try { await action(); if(epoch===state.epoch) $('#habit-status').textContent=message; }
    catch(error) { if(epoch===state.epoch) $('#habit-status').textContent=error.message; }
    finally { if(epoch===state.epoch) { state.busy=false; render(); } }
  }
  function load() {
    if(!localStorage.getItem('studyflow.token'))return;
    return run(async()=>{ const items=await request(''); if(!Array.isArray(items))throw new Error('习惯列表格式不正确。'); state.items=items;state.loaded=true; },'记录已同步。各习惯按其固定时区计算今天。');
  }
  function replace(item) { state.items=state.items.map(h=>h.id===item.id?item:h); }
  function check(id,date,checked) {
    return run(async()=>replace(await request('/'+encodeURIComponent(id)+'/checkins/'+date,{method:'PUT',body:JSON.stringify({checked})})),checked?'已记下这一天的小小进步。':'已撤销打卡，记录和统计已更新。');
  }
  function monthCells(h, month) {
    const [year,m]=month.split('-').map(Number), first=new Date(year,m-1,1), count=new Date(year,m,0).getDate();
    const leading=(first.getDay()+6)%7, checks=new Set(h?.checkins || []), cells=[];
    for(let i=0;i<leading;i++)cells.push('<span aria-hidden="true"></span>');
    for(let day=1;day<=count;day++) {
      const date=`${month}-${String(day).padStart(2,'0')}`, checked=checks.has(date), disabled=!h||h.archived||date<h.start_date||date>h.today||state.busy;
      cells.push(`<button type="button" data-habit-date="${date}" aria-label="${date}，${checked?'已打卡':'未打卡'}" aria-pressed="${checked}" ${date===h?.today?'aria-current="date"':''} ${disabled?'disabled':''}>${day}<small aria-hidden="true">${checked?'✓':'·'}</small></button>`);
    }
    return cells.join('');
  }
  function render() {
    const archived=$('#habit-filter').value==='archived', visible=state.items.filter(h=>h.archived===archived), active=state.items.filter(h=>!h.archived);
    if(!visible.some(h=>h.id===state.selected))state.selected=visible[0]?.id || '';
    const h=current(); if(!state.month)state.month=h?.today.slice(0,7)||localMonth();
    $('#habit-active-count').textContent=state.loaded?active.length:'—';
    $('#habit-today-count').textContent=state.loaded?active.filter(h=>h.checkins.includes(h.today)).length:'—';
    $('#habit-best-count').textContent=state.loaded?Math.max(0,...active.map(h=>h.longest_streak))+' 天':'—';
    $('#habit-list').innerHTML=visible.length?visible.map(item=>{
      const done=item.checkins.includes(item.today);
      return `<article class="habit-card ${item.id===state.selected?'selected':''}"><button class="habit-select" type="button" data-habit-select="${escape(item.id)}" aria-pressed="${item.id===state.selected}"><span aria-hidden="true">${icons[item.icon]||'❀'}</span><span><strong>${escape(item.title)}</strong><small>${escape(item.description||'每天一点点，慢慢成为习惯。')}</small></span></button><div class="habit-card-bottom"><span>连续 ${item.current_streak} 天</span>${!item.archived?`<button class="habit-check ${done?'done':''}" type="button" data-habit-check="${escape(item.id)}" aria-pressed="${done}" ${state.busy?'disabled':''}>${done?'✓ 已打卡 · 撤销':'＋ 今日打卡'}</button>`:''}<button class="text-button" type="button" data-habit-archive="${escape(item.id)}" ${state.busy?'disabled':''}>${item.archived?'恢复':'归档'}</button></div></article>`;
    }).join(''):`<div class="habit-empty">${!state.loaded?'记录尚未加载，请点击刷新。':archived?'归档的习惯会保留在这里。':'还没有习惯。先从一件容易做到的小事开始。'}</div>`;
    $('#habit-detail-title').textContent=h?.title||'选择一个习惯';
    $('#habit-detail-meta').textContent=h?`${h.time_zone} · 今天 ${h.today} · ${h.archived?'已归档，只读':'创建于 '+h.start_date}`:'在左侧创建习惯，开始记录。';
    $('#habit-month-label').textContent=state.month.replace('-',' 年 ')+' 月';
    $('#habit-calendar').innerHTML=monthCells(h,state.month);
    $('#habit-detail-stats').innerHTML=h?`<span>本月 <b>${h.checkins.filter(d=>d.startsWith(state.month)).length}</b> 天</span><span>累计 <b>${h.total}</b> 天</span><span>最长连续 <b>${h.longest_streak}</b> 天</span>`:'';
    $('#habit-reload').disabled=state.busy;
    $('#habit-form').querySelectorAll('input,textarea,select,button').forEach(field=>{field.disabled=state.busy;});
  }
  function shiftMonth(amount) { const [y,m]=state.month.split('-').map(Number); const d=new Date(y,m-1+amount,1);if(d.getFullYear()<1900||d.getFullYear()>9999)return;state.month=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;render(); }
  function reset() { state.epoch++;controllers.forEach(c=>c.abort());state.items=[];state.selected='';state.month='';state.loaded=false;state.busy=false;$('#habit-form').reset();$('#habit-status').textContent='等待加载';render(); }
  function bind() {
    $('#habit-reload').addEventListener('click',load);
    $('#habit-filter').addEventListener('change',render);
    $('#habit-prev').addEventListener('click',()=>shiftMonth(-1));$('#habit-next').addEventListener('click',()=>shiftMonth(1));
    $('#habit-current-month').addEventListener('click',()=>{state.month=current()?.today.slice(0,7)||localMonth();render();});
    $('#habit-form').addEventListener('submit',event=>{
      event.preventDefault(); if(state.busy||!event.currentTarget.reportValidity())return;
      const payload={title:$('#habit-title').value,description:$('#habit-description').value,icon:$('#habit-icon').value,time_zone:$('#habit-zone').value};
      run(async()=>{const h=await request('',{method:'POST',body:JSON.stringify(payload)});state.items.push(h);state.selected=h.id;state.month=h.today.slice(0,7);$('#habit-filter').value='active';$('#habit-form').reset();state.loaded=true;},'习惯已创建。从今天开始，慢慢来。');
    });
    panel.addEventListener('click',event=>{
      const selected=event.target.closest('[data-habit-select]');if(selected){state.selected=selected.dataset.habitSelect;state.month=current()?.today.slice(0,7)||localMonth();render();return;}
      const button=event.target.closest('[data-habit-check]');if(button){const h=state.items.find(h=>h.id===button.dataset.habitCheck);if(h)check(h.id,h.today,!h.checkins.includes(h.today));return;}
      const day=event.target.closest('[data-habit-date]');if(day&&!day.disabled){const h=current();if(h)check(h.id,day.dataset.habitDate,!h.checkins.includes(day.dataset.habitDate));return;}
      const archive=event.target.closest('[data-habit-archive]');if(archive){const h=state.items.find(h=>h.id===archive.dataset.habitArchive);if(h)run(async()=>replace(await request('/'+h.id+'/archive',{method:'PATCH',body:JSON.stringify({archived:!h.archived})})),h.archived?'习惯已恢复。':'已归档，历史打卡已保留。');}
    });
    new MutationObserver(()=>{if(panel.classList.contains('active'))load();}).observe(panel,{attributes:true,attributeFilter:['class']});
    new MutationObserver(()=>{if($('#app-view').classList.contains('hidden'))reset();}).observe($('#app-view'),{attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&panel.classList.contains('active'))load();});
    window.setInterval(()=>{if(!document.hidden&&panel.classList.contains('active'))load();},60000);
    render();if(panel.classList.contains('active'))load();
  }
  bind();
})();
