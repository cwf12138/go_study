(() => {
  'use strict';
  const $ = id => document.getElementById('bookmark-' + id);
  const panel = document.getElementById('panel-bookmarks');
  if (!panel) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { token:'', rows:[], loaded:false, loading:false, busy:false, pending:null, edit:null, view:'all', folder:'', page:1, generation:0 };
  const token = () => localStorage.getItem('studyflow.token') || '';
  function message(text, error=false, target='status') { $(target).textContent=text; $(target).classList.toggle('bookmark-error',error); }
  function sync() {
    const current=token();
    if(current!==state.token){
      state.token=current;state.rows=[];state.loaded=false;state.loading=false;state.busy=false;state.pending=null;state.edit=null;state.view='all';state.folder='';state.page=1;state.generation++;
      $('dialog').close();$('form').reset();$('search').value='';message('');message('',false,'form-status');render();
    }
    return current;
  }
  function safeURL(value) { try { const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:''; } catch { return ''; } }
  async function api(path='', body) {
    const owner=token(), controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch('/api/v1/bookmarks'+path,{method:body?'PUT':'GET',headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store'});
      const payload=await response.json().catch(()=>null);
      if(owner!==token()) throw new Error('账号已切换');
      if(!response.ok){const error=new Error(payload?.error?.message||(response.status===404?'接口不存在，请重启新版 Go 服务。':`请求失败（${response.status}）`));error.definite=response.status>=400&&response.status<500;throw error;}
      if(!payload || !('data' in payload)) throw new Error('服务响应异常，请确认后端版本');
      return payload.data;
    } finally { clearTimeout(timeout); }
  }
  function controls(){
    const locked=state.busy||!!state.pending;
    $('new').disabled=locked||!state.loaded;$('refresh').disabled=locked||state.loading;
    $('fields').disabled=locked;$('save').disabled=locked;
    $('retry').disabled=state.busy;$('reconcile').disabled=state.busy;
    $('recovery').hidden=!state.pending;
    $('export').disabled=!state.loaded;
    $('grid').querySelectorAll('button').forEach(b=>b.disabled=locked);
  }
  async function load(){
    if(!sync()){message('请先登录。',true);return;}
    if(state.loading||state.busy||state.pending)return;
    const generation=++state.generation,owner=state.token;state.loading=true;controls();message('正在整理收藏架…');
    try{const rows=await api();if(generation!==state.generation||owner!==token())return;if(!Array.isArray(rows))throw new Error('收藏数据格式异常');state.rows=rows;state.loaded=true;render();message(`已同步 ${rows.filter(r=>!r.deleted).length} 条收藏。`);}
    catch(error){if(generation===state.generation&&owner===token())message(error.name==='AbortError'?'加载超时，请重试。':error.message,true);}
    finally{if(generation===state.generation){state.loading=false;controls();}}
  }
  function filtered(){
    const q=$('search').value.trim().toLocaleLowerCase();
    return state.rows.filter(r=>(state.view==='trash'?r.deleted:!r.deleted)&&(!state.folder||r.folder===state.folder)&&(state.view!=='unread'||!r.read)&&(state.view!=='pinned'||r.pinned)&&(!q||`${r.title} ${r.url} ${r.note} ${r.folder}`.toLocaleLowerCase().includes(q))).sort((a,b)=>{
      if(a.pinned!==b.pinned)return a.pinned?-1:1;
      if($('sort').value==='title')return a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id);
      const diff=Date.parse(a.created_at)-Date.parse(b.created_at);return ($('sort').value==='oldest'?diff:-diff)||a.id.localeCompare(b.id);
    });
  }
  function render(){
    const normal=state.rows.filter(r=>!r.deleted),views=[['all','全部收藏',normal.length],['pinned','★ 置顶常用',normal.filter(r=>r.pinned).length],['unread','◷ 稍后读',normal.filter(r=>!r.read).length],['trash','回收站',state.rows.filter(r=>r.deleted).length]];
    $('views').innerHTML=views.map(([key,label,count])=>`<button type="button" data-view="${key}" class="${state.view===key?'active':''}" aria-pressed="${state.view===key}"><span>${label}</span><b>${count}</b></button>`).join('');
    const folders=[...new Set(state.rows.filter(r=>state.view==='trash'?r.deleted:!r.deleted).map(r=>r.folder))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    $('folders').innerHTML=`<button type="button" data-folder="" class="${!state.folder?'active':''}"><span>所有文件夹</span></button>`+folders.map(f=>`<button type="button" data-folder="${escape(f)}" class="${state.folder===f?'active':''}"><span>▱ ${escape(f)}</span></button>`).join('');
    $('folder-options').innerHTML=[...new Set(normal.map(r=>r.folder))].map(f=>`<option value="${escape(f)}"></option>`).join('');
    const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/12));state.page=Math.max(1,Math.min(pages,state.page));
    $('heading').textContent=state.folder||views.find(v=>v[0]===state.view)[1];$('count').textContent=`${rows.length} 条 · 置顶优先`;
    $('grid').innerHTML=rows.slice((state.page-1)*12,state.page*12).map(card).join('')||`<div class="bookmark-empty"><b aria-hidden="true">▱</b><h4>${!state.loaded?'收藏架准备好了':state.view==='trash'?'回收站空空的':'给好内容留个位置'}</h4><p>${!state.loaded?'登录后加载收藏；加载失败可点击刷新。':state.view==='all'&&!$('search').value&&!state.folder?'点击“收藏一个链接”，从常用的网站开始。':'这里还没有匹配的收藏，试试其他筛选。'}</p></div>`;
    $('page').textContent=`${state.page} / ${pages}`;$('prev').disabled=state.page===1;$('next').disabled=state.page===pages;controls();
  }
  function card(row){
    const url=safeURL(row.url),host=url?new URL(url).hostname:'无效链接',date=new Date(row.created_at).toLocaleDateString('zh-CN');
    const action=(key,label)=>`<button type="button" data-action="${key}" data-id="${escape(row.id)}">${label}</button>`;
    return `<article class="bookmark-card"><div class="bookmark-card-top"><b class="bookmark-monogram" aria-hidden="true">${escape(host[0].toUpperCase())}</b><span title="${escape(host)}">${escape(host)}</span>${row.pinned?'<b class="bookmark-pin" aria-label="已置顶">★</b>':''}</div><h4>${url?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" title="在新标签页打开">${escape(row.title)} ↗</a>`:escape(row.title)}</h4><p class="bookmark-card-note">${escape(row.note||'把时间留给值得重访的内容。')}</p><div class="bookmark-card-meta"><span>${escape(row.folder)}</span><span>${row.read?'已读':'待读'} · ${escape(date)}</span></div><footer>${row.deleted?action('restore','恢复收藏'):action('edit','编辑')+action('pin',row.pinned?'取消置顶':'置顶')+action('read',row.read?'设为待读':'标记已读')+action('copy','复制链接')+action('trash','移入回收站')}</footer></article>`;
  }
  function edit(row=null){
    if(!sync()||state.busy||state.pending||!state.loaded)return;
    state.edit=row;$('form').reset();$('url').value=row?.url||'';$('title').value=row?.title||'';$('folder').value=row?.folder||state.folder||'';$('note').value=row?.note||'';$('pinned').checked=!!row?.pinned;$('read').checked=!!row?.read;
    $('editor-title').textContent=row?'编辑收藏':'收藏一个链接';message('',false,'form-status');controls();$('dialog').showModal();$('url').focus();
  }
  function bodyOf(row){return {url:row.url,title:row.title,folder:row.folder,note:row.note,pinned:row.pinned,read:row.read,deleted:row.deleted,revision:row.revision};}
  async function persist(request){
    if(!sync()||state.busy)return;
    if(request&&state.pending)return;
    if(request)state.pending=request;
    if(!state.pending)return;
    const pending=state.pending,owner=state.token,generation=++state.generation;state.busy=true;state.loading=false;controls();message('正在保存…');message('正在保存…',false,'form-status');
    try{
      const row=await api('/'+encodeURIComponent(pending.id),pending.body);
      if(owner!==token()||generation!==state.generation)return;
      if(!row?.id||!Number.isInteger(row.revision))throw new Error('保存响应异常');
      state.rows=state.rows.filter(r=>r.id!==row.id).concat(row);state.pending=null;$('dialog').close();render();message(row.deleted?'已移入回收站，可随时恢复。':'已保存收藏。');
    }catch(error){
      if(owner!==token()||generation!==state.generation)return;
      if(error.definite)state.pending=null;
      const text=error.name==='AbortError'?'保存超时，结果尚未确认。':error.message;
      message(text,true);message(text+(state.pending?' 请关闭弹窗，在收藏页原样重试。':''),true,'form-status');
    }finally{if(generation===state.generation){state.busy=false;controls();}}
  }
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportHTML(){
    if(!sync()||!state.loaded)return;
    const rows=filtered().filter(r=>safeURL(r.url));
    if(!rows.length){message('当前筛选下没有可导出的链接。');return;}
    const content='<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Daynest 收藏</TITLE>\n<H1>Daynest 收藏</H1>\n<DL><p>\n'+rows.map(r=>`<DT><A HREF="${escape(safeURL(r.url))}">${escape(r.title)}</A>\n<DD>${escape(r.note)}`).join('\n')+'\n</DL><p>';
    download('Daynest-收藏.html',content,'text/html;charset=utf-8');message(`已导出当前筛选下 ${rows.length} 条链接，可导入浏览器书签。`);
  }
  $('form').addEventListener('submit',event=>{
    event.preventDefault();if(state.busy||state.pending)return;
    if(!state.token||state.token!==token()){sync();message('账号已变化，请重新添加。',true);return;}
    let url=$('url').value.trim();if(!url.includes('://'))url='https://'+url;
    if(!safeURL(url)){message('请填写 HTTP/HTTPS 网址，且不要包含用户名或密码。',true,'form-status');return;}
    persist({id:state.edit?.id||crypto.randomUUID(),body:{url,title:$('title').value,folder:$('folder').value,note:$('note').value,pinned:$('pinned').checked,read:$('read').checked,deleted:false,revision:state.edit?.revision||0}});
  });
  $('new').addEventListener('click',()=>edit());$('close').addEventListener('click',()=>$('dialog').close());
  $('dialog').addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
  $('refresh').addEventListener('click',load);$('export').addEventListener('click',exportHTML);
  $('retry').addEventListener('click',()=>persist(null));
  $('draft').addEventListener('click',()=>{if(sync()&&state.pending)download('收藏草稿.json',JSON.stringify(state.pending,null,2),'application/json');});
  $('reconcile').addEventListener('click',()=>{if(state.busy)return;if(confirm('请先导出需要保留的草稿。重新核对将放弃本地待确认请求，并加载服务器记录。')){state.pending=null;$('dialog').close();load();}});
  for(const id of ['search','sort'])$(id).addEventListener(id==='search'?'input':'change',()=>{state.page=1;render();});
  $('views').addEventListener('click',event=>{const button=event.target.closest('[data-view]');if(button){state.view=button.dataset.view;state.folder='';state.page=1;render();}});
  $('folders').addEventListener('click',event=>{const button=event.target.closest('[data-folder]');if(button){state.folder=button.dataset.folder;state.page=1;render();}});
  $('prev').addEventListener('click',()=>{state.page--;render();});$('next').addEventListener('click',()=>{state.page++;render();});
  $('grid').addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button||!sync()||state.busy||state.pending)return;
    const row=state.rows.find(r=>r.id===button.dataset.id);if(!row)return;
    const action=button.dataset.action;
    if(action==='edit'){edit(row);return;}
    if(action==='copy'){try{await navigator.clipboard.writeText(row.url);message('链接已复制。');}catch{message('复制失败，请在编辑窗口中选中网址手动复制。',true);}return;}
    const body=bodyOf(row);if(action==='pin')body.pinned=!body.pinned;else if(action==='read')body.read=!body.read;else if(action==='trash')body.deleted=true;else if(action==='restore')body.deleted=false;else return;
    persist({id:row.id,body});
  });
  document.querySelector('[data-view="bookmarks"]')?.addEventListener('click',load);
  new MutationObserver(()=>{sync();if(panel.classList.contains('active')&&!state.loaded)load();}).observe(panel,{attributes:true,attributeFilter:['class']});
  window.addEventListener('storage',event=>{if(event.key==='studyflow.token'){sync();if(panel.classList.contains('active'))load();}});
  render();if(panel.classList.contains('active'))load();
})();
