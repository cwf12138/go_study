(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),panel=$('#panel-timeline');
  const kinds={task:['✓','完成任务','tasks'],todo:['☑','完成待办','todo'],focus:['◷','完成专注','focus'],book:['阅','读完书籍','literature'],memo:['▤','新建备忘录','memos']};
  let page=1,pages=0,version=0,controller;
  const month=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`};
  $('#trail-month').value=month();
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  async function load(){
    const token=localStorage.getItem('studyflow.token');if(!token)return;
    controller?.abort();const abort=new AbortController();controller=abort;const current=++version;
    const timer=setTimeout(()=>abort.abort(),25000);
    $('#trail-status').textContent='正在整理成长足迹…';$('#trail-prev').disabled=true;$('#trail-next').disabled=true;
    $('#trail-list').replaceChildren();for(const id of ['total','days','minutes'])$('#trail-'+id).textContent='—';
    try{
      const query=new URLSearchParams({month:$('#trail-month').value,kind:$('#trail-kind').value,offset:-new Date().getTimezoneOffset(),page});
      const response=await fetch('/api/v1/timeline?'+query,{signal:abort.signal,headers:{Authorization:'Bearer '+token}});
      const payload=await response.json();if(!response.ok)throw new Error(response.status===404?'请重启 Go 服务以加载成长足迹接口':payload.error?.message||'加载失败，请重试');
      if(current!==version||token!==localStorage.getItem('studyflow.token'))return;
      const data=payload.data;pages=data.pages;
      $('#trail-total').textContent=data.total;$('#trail-days').textContent=data.active_days;$('#trail-minutes').textContent=data.focus_minutes;
      $('#trail-status').textContent=data.total?'已按时间从新到旧排列。':'当前筛选下没有记录。完成一件小事，足迹就会出现在这里。';
      $('#trail-page').textContent=`第 ${page} / ${Math.max(1,pages)} 页`;
      $('#trail-list').innerHTML=data.items.map(item=>{const [icon,label,target]=kinds[item.kind];return `<article class="trail-item"><span class="trail-icon" aria-hidden="true">${icon}</span><div><small>${label}${item.minutes?' · '+item.minutes+' 分钟':''}</small><h4>${escape(item.title)}</h4><time datetime="${escape(item.at)}">${escape(new Date(item.at).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time></div><button class="quiet" type="button" data-goto="${target}">前往模块 →</button></article>`}).join('');
      $('#trail-prev').disabled=page<=1;$('#trail-next').disabled=page>=pages;
    }catch(error){if(current===version&&token===localStorage.getItem('studyflow.token'))$('#trail-status').textContent=error.name==='AbortError'?'加载超时，请点击“查看足迹”重试':error.message}
    finally{clearTimeout(timer)}
  }
  $('#trail-filter').addEventListener('submit',event=>{event.preventDefault();page=1;load()});
  $('#trail-today').addEventListener('click',()=>{$('#trail-month').value=month();page=1;load()});
  $('#trail-prev').addEventListener('click',()=>{if(page>1){page--;load()}});
  $('#trail-next').addEventListener('click',()=>{if(page<pages){page++;load()}});
  new MutationObserver(()=>{if(panel.classList.contains('active'))load()}).observe(panel,{attributes:true,attributeFilter:['class']});
  new MutationObserver(()=>{if($('#app-view').classList.contains('hidden')){version++;controller?.abort();$('#trail-list').replaceChildren()}}).observe($('#app-view'),{attributes:true,attributeFilter:['class']});
  if(panel.classList.contains('active'))load();
})();
