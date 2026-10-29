(() => {
  'use strict';
  const C=window.DaynestTextClips,$=id=>document.getElementById('tc-'+id),panel=document.getElementById('panel-transfers'),app=document.getElementById('app-view');
  if(!C||!$('board'))return;
  const token=()=>localStorage.getItem('studyflow.token')||'',controllers=new Set();
  let owner='',epoch=0,rows=[],loaded=false,busy=false,pasteBusy=false,pending=null,editing=null,baseline='',tab='active',page=1,offset=0,remote=null;
  const now=()=>Date.now()+offset;
  const signature=()=>JSON.stringify([$('title').value,$('text').value,Number($('ttl').value),$('pinned').checked]);
  const dirty=()=>signature()!==baseline;
  const message=(text,error=false)=>{$('status').textContent=text;$('status').dataset.error=String(error);};
  let copyOpener=null;
  const copyDialog=document.createElement('dialog');copyDialog.className='tc-manual-copy';copyDialog.setAttribute('aria-labelledby','tc-copy-title');
  copyDialog.innerHTML='<h2 id="tc-copy-title">手动复制文字</h2><p>当前环境无法自动复制。文字已选中：电脑按 Ctrl/⌘ + C，手机长按后选择“复制”。</p><textarea readonly rows="7" aria-label="待复制文字"></textarea><button type="button" class="quiet">关闭</button>';
  document.body.append(copyDialog);copyDialog.querySelector('button').addEventListener('click',()=>copyDialog.close());
  copyDialog.addEventListener('close',()=>{copyDialog.querySelector('textarea').value='';const previous=copyOpener;copyOpener=null;if(previous?.isConnected)previous.focus({preventScroll:true});else if(!app.classList.contains('hidden'))$('toggle').focus({preventScroll:true});});
  function newForm(){editing=null;$('form').reset();$('title').value='';$('text').value='';$('ttl').value='24';$('pinned').checked=false;baseline=signature();}
  function reset(){epoch++;for(const c of controllers)c.abort();controllers.clear();rows=[];loaded=false;busy=false;pasteBusy=false;pending=null;remote=null;tab='active';page=1;offset=0;newForm();$('query').value='';$('sort').value='updated';$('board').hidden=true;$('toggle').setAttribute('aria-expanded','false');$('toggle').textContent='打开文字快传 ↗';copyDialog.close();copyDialog.querySelector('textarea').value='';$('list').innerHTML='';$('remote').textContent='';message('');}
  function sync(){const next=app.classList.contains('hidden')?'':token();if(next!==owner){reset();owner=next;render();}return !!owner;}
  async function request(path,options={}){
    const account=owner,generation=epoch,c=new AbortController(),timer=setTimeout(()=>c.abort(),20000);controllers.add(c);
    try{const res=await fetch('/api/v1/text-clips'+path,{...options,headers:{Authorization:'Bearer '+account,'Content-Type':'application/json'},signal:c.signal,cache:'no-store'});
      if(account!==token()||generation!==epoch||app.classList.contains('hidden'))throw Error('账号已切换');
      if(res.status===204)return null;const out=await res.json().catch(()=>null);
      if(!res.ok){const error=Error(out?.error?.message||`请求失败（${res.status}），请确认新版 Go 服务已经启动。`);error.status=res.status;throw error;}
      if(!out||!Object.hasOwn(out,'data'))throw Error('文字中转响应格式不完整');return out;
    }finally{clearTimeout(timer);controllers.delete(c);}
  }
  async function load(reconcile=false,quiet=false){
    if(!sync()||busy||pending&&!reconcile)return false;const generation=epoch;busy=true;render();
    try{const out=await request('');if(generation!==epoch)return false;if(!Array.isArray(out.data)||!out.data.every(C.valid)||!Number.isFinite(Date.parse(out.server_time)))throw Error('文字列表格式异常');
      rows=out.data;offset=Date.parse(out.server_time)-Date.now();loaded=true;if(!quiet)message('已同步。过期片段可在“已过期”中续期，不会自动删除。');return true;
    }catch(error){if(generation===epoch&&!quiet)message('同步失败：'+error.message+'；已有文字与草稿已保留。',true);return false;}
    finally{if(generation===epoch){busy=false;render();}}
  }
  function render(){
    const shown=C.select(rows,{tab,query:$('query').value,sort:$('sort').value,now:now()}),pages=Math.max(1,Math.ceil(shown.length/6));page=Math.max(1,Math.min(page,pages));
    $('list').innerHTML=shown.length?shown.slice((page-1)*6,page*6).map(row=>{
      const inactive=row.deleted||C.expired(row,now()),locked=busy||!!pending||dirty()&&editing?.id===row.id;
      const action=(kind,label,disabled=locked,cls='')=>`<button type="button" class="${cls}" data-tc-action="${kind}" data-tc-id="${row.id}" ${disabled?'disabled':''}>${label}</button>`;
      return `<article class="tc-card" data-selected="${editing?.id===row.id}"><div class="tc-card-top"><span>${row.pinned?'◆ 已置顶':'↔ 文字片段'}</span><span>${row.deleted?'回收站':C.expiry(row,now())}</span></div><h4>${C.esc(C.title(row))}</h4><p class="tc-preview">${C.esc([...row.text].slice(0,240).join(''))}</p><div class="tc-card-actions">${!inactive?action('copy','复制文字',false,'tc-copy'):''}${!row.deleted?action('edit','编辑',busy||!!pending):''}${!inactive?action('pin',row.pinned?'取消置顶':'置顶'):''}${row.deleted?action('restore','恢复并保留 1 天'):C.expired(row,now())?action('renew','续期 1 天'):''}${!row.deleted?action('trash','移入回收站'):''}${inactive?action('purge','永久清理'):''}</div></article>`;
    }).join(''):`<div class="tc-empty"><b>${!loaded?'还未读取文字':$('query').value?'没有找到匹配内容':tab==='trash'?'回收站是空的':tab==='expired'?'暂时没有过期文字':tab==='pinned'?'把常用文字留在手边':'把第一段文字送到这里'}</b>${!loaded?'点击“同步”重新连接。':tab==='active'?'地址、链接、一小段想法。写下后，在另一台设备继续。':'切换视图，或发送一段新文字。'}</div>`;
    $('count').textContent=`${shown.length} 条${$('query').value?'匹配':'文字'} · 共 ${rows.length}/100`;$('page').textContent=`${page} / ${pages}`;
    $('prev').disabled=busy||page<=1;$('next').disabled=busy||page>=pages;
    for(const button of $('tabs').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.tcTab===tab));
    $('refresh').disabled=busy||!!pending;$('save').disabled=busy||!!pending||!$('text').value.trim()||C.count($('text').value)>12000;
    $('new').disabled=busy||!!pending;$('jump').disabled=busy||!!pending;$('paste').disabled=pasteBusy||!!pending;$('draft-copy').disabled=!$('text').value;
    $('text').readOnly=!!pending;$('title').readOnly=!!pending;$('ttl').disabled=!!pending;$('pinned').disabled=!!pending;
    $('editor-heading').textContent=editing?'编辑文字片段':'发一段文字';$('save').textContent=editing?'保存修改':'发送到中转站';
    $('char-count').textContent=`${C.count($('text').value)} / 12000 字`;$('draft-state').textContent=pending?'等待确认':dirty()?'有未保存的修改':editing?'已保存':'尚未发送';
    $('expiry-hint').textContent=editing?C.expired(editing,now())?'这条文字已过期。编辑不自动续期，请在列表点击“续期 1 天”。':`当前：${C.expiry(editing,now())}。编辑与置顶不续期；只有改变有效期才重新计时。`:'从发送成功时开始计时；到期移入“已过期”，可续期或清理。';
    $('recovery').hidden=!pending;for(const id of ['retry','reconcile','abandon','rebase'])$(id).disabled=busy;
    $('conflict').hidden=!remote;$('rebase').hidden=!remote||pending?.source!=='form'||!!remote.row?.deleted;
  }
  function edit(row){if(busy||pending)return;if(dirty()&&!confirm('当前有未保存的文字，确定放弃并打开另一条吗？'))return;newForm();if(row){editing={...row};$('title').value=row.title;$('text').value=row.text;$('ttl').value=String(row.ttl_hours);$('pinned').checked=row.pinned;baseline=signature();}render();$('text').focus();}
  function accept(row){rows=rows.filter(item=>item.id!==row.id).concat(row);loaded=true;}
  function completed(op,row){
    if(op.method==='DELETE')rows=rows.filter(item=>item.id!==op.id);else accept(row);
    if(op.source==='form'||editing?.id===op.id&&!dirty())newForm();pending=null;remote=null;
    if(op.source==='form'){tab='active';page=1;$('query').value='';}
    message(op.method==='DELETE'?'文字已永久清理。':op.body.deleted?'已移入回收站，可以恢复。':op.body.renew?'已恢复为可用文字，保留 1 天。':op.source==='action'?'置顶状态已更新。':'✓ 已保存，在另一台设备同步即可找到。');
  }
  async function persist(){
    if(!pending||busy||!sync())return;const op=pending,generation=epoch;busy=true;render();
    try{const out=await request('/'+op.id+(op.method==='DELETE'?'?revision='+op.revision:''),{method:op.method||'PUT',body:op.body?JSON.stringify(op.body):undefined});
      if(generation!==epoch)return;if(op.method!=='DELETE'&&(!C.valid(out?.data)||out.data.id!==op.id))throw Error('保存结果无效');completed(op,out?.data);
    }catch(error){if(generation===epoch){if(op.method==='DELETE'&&error.status===404)completed(op);else if(error.status===400||error.status===413){pending=null;remote=null;message('未能保存：'+error.message+'。输入仍保留，请修改后重试。',true);}else message(error.status===409?'其他设备更新了这条文字。草稿仍在，请点击“核对服务器”查看新版本。':'尚未确认结果：'+error.message+'。请核对或原样重试。',true);}}
    finally{if(generation===epoch){busy=false;render();}}
  }
  async function reconcile(){
    if(!pending||busy)return;const op=pending,generation=epoch;if(!await load(true))return;if(generation!==epoch||pending!==op)return;
    const row=rows.find(r=>r.id===op.id),renewed=!op.body?.renew||row&&(!C.expired(row,now()))&&row.expires_at!==op.previousExpiry;
    if(op.method==='DELETE'&&!row||op.body&&row&&row.revision>=op.body.revision+1&&C.same(row,op.body)&&renewed){completed(op,row);render();return;}
    remote={row};$('remote').textContent=row?`${C.title(row)}\n${row.deleted?'已移入回收站 · ':''}${C.expiry(row,now())}\n\n${row.text}`:'服务器上没有这条文字。原请求可能尚未写入，或已被永久清理。';
    message('已显示服务器版本。你的草稿未被替换；确认后可基于此版本继续编辑，或结束本次重试。',true);render();
  }
  async function copy(text,opener=$('draft-copy')){
    if(!sync()||!text)return;const account=owner,generation=epoch;
    try{if(window.DaynestMobile?.copyText)await window.DaynestMobile.copyText(text);else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else throw Error('manual');
      if(account===token()&&generation===epoch)message('已复制，可粘贴到你需要的地方。');
    }catch(_){if(account!==token()||generation!==epoch)return;copyOpener=opener;copyDialog.querySelector('textarea').value=text;copyDialog.showModal();copyDialog.querySelector('textarea').focus();copyDialog.querySelector('textarea').select();
      try{if(document.execCommand?.('copy')){copyDialog.close();message('已复制，可粘贴到你需要的地方。');}}catch(_){}
    }
  }
  async function paste(){
    if(!sync()||pending||pasteBusy)return;const generation=epoch,before=signature();pasteBusy=true;render();
    try{const text=window.DaynestMobile?.readText?await window.DaynestMobile.readText():await navigator.clipboard.readText();if(generation!==epoch)return;if(before!==signature())throw Error('输入已变化，已取消粘贴；请重试。');
      const field=$('text'),start=field.selectionStart??field.value.length,end=field.selectionEnd??start,next=field.value.slice(0,start)+text+field.value.slice(end);if(C.count(next)>12000)throw Error('粘贴后超过 12000 字，请分段发送。');field.setRangeText(text,start,end,'end');field.focus();message('已粘贴，点击发送后另一台设备才能看到。');
    }catch(error){if(generation===epoch)message(error.message?.includes('12000')||error.message?.includes('输入已变化')?error.message:'无法读取剪贴板，请直接在文字框中粘贴（电脑 Ctrl/⌘ + V，手机长按粘贴）。',true);}
    finally{if(generation===epoch){pasteBusy=false;render();}}
  }
  $('toggle').addEventListener('click',()=>{if(!sync())return;const open=$('board').hidden;$('board').hidden=!open;$('toggle').setAttribute('aria-expanded',String(open));$('toggle').textContent=open?'收起文字快传 ↑':'打开文字快传 ↗';if(open)load();});
  $('form').addEventListener('submit',event=>{event.preventDefault();if(!sync()||busy||pending||!$('form').reportValidity())return;if(C.count($('text').value)>12000){message('文字最多 12000 字。',true);return;}
    pending={id:editing?.id||crypto.randomUUID(),source:'form',body:{title:$('title').value.trim(),text:$('text').value.replace(/\r\n?/g,'\n'),ttl_hours:Number($('ttl').value),pinned:$('pinned').checked,deleted:false,revision:editing?.revision||0}};persist();});
  $('list').addEventListener('click',event=>{const button=event.target.closest('[data-tc-action]');if(!button||!sync())return;const row=rows.find(r=>r.id===button.dataset.tcId);if(!row)return;const action=button.dataset.tcAction;
    if(action==='copy'){if(!row.deleted&&!C.expired(row,now()))copy(row.text,button);return;}
    if(action==='edit'){edit(row);return;}if(busy||pending||dirty()&&editing?.id===row.id)return;
    if(action==='purge'){if(!confirm('永久清理这段文字？此操作无法恢复，既有导出和备份中的副本不受影响。'))return;pending={id:row.id,method:'DELETE',revision:row.revision,source:'action'};}
    else{const body=C.values(row);if(action==='pin')body.pinned=!body.pinned;else if(action==='trash')body.deleted=true;else if(action==='restore'||action==='renew'){body.deleted=false;body.ttl_hours=24;body.renew=true;}else return;pending={id:row.id,body,source:'action',previousExpiry:row.expires_at};}persist();});
  $('tabs').addEventListener('click',event=>{const value=event.target.closest('[data-tc-tab]')?.dataset.tcTab;if(['active','pinned','expired','trash'].includes(value)){tab=value;page=1;render();}});
  $('query').addEventListener('input',()=>{page=1;render();});$('sort').addEventListener('change',()=>{page=1;render();});$('prev').addEventListener('click',()=>{page--;render();});$('next').addEventListener('click',()=>{page++;render();});
  $('new').addEventListener('click',()=>edit());$('refresh').addEventListener('click',()=>load());$('retry').addEventListener('click',persist);$('reconcile').addEventListener('click',reconcile);
  $('jump').addEventListener('click',()=>{if(busy||pending)return;if(!dirty())edit();$('editor-heading').scrollIntoView({block:'start'});$('text').focus({preventScroll:true});});
  $('rebase').addEventListener('click',()=>{if(busy||!pending||pending.source!=='form'||!remote||remote.row?.deleted)return;const row=remote.row;editing=row?{...row}:{id:pending.id,revision:0};baseline=JSON.stringify([row?.title||'',row?.text||'',row?.ttl_hours??24,row?.pinned||false]);pending=null;remote=null;message('草稿已保留。请合并所需内容，再点击保存；不会自动覆盖服务器。');render();});
  $('abandon').addEventListener('click',()=>{if(busy)return;pending=null;remote=null;message('已结束重试，当前输入仍保留。可复制草稿后重新打开服务器上的记录。');render();});
  for(const id of ['title','text','ttl','pinned'])$(id).addEventListener(id==='ttl'||id==='pinned'?'change':'input',render);
  $('draft-copy').addEventListener('click',()=>copy($('text').value));$('paste').addEventListener('click',paste);
  document.addEventListener('daynest:account-ready',sync);document.getElementById('logout').addEventListener('click',()=>{reset();owner='';});window.addEventListener('storage',event=>{if(event.key==='studyflow.token'||event.key===null)sync();});new MutationObserver(sync).observe(app,{attributes:true,attributeFilter:['class']});
  window.DaynestUI?.registerGuard?.('text-clips',()=>dirty()||!!pending||pasteBusy);window.addEventListener('beforeunload',event=>{if(dirty()||pending){event.preventDefault();event.returnValue='';}});
  window.setInterval(()=>{if(sync()&&!$('board').hidden&&!copyDialog.open&&panel.classList.contains('active')&&!document.hidden&&!busy&&!pending)load(false,true);},20000);
  newForm();sync();render();
})();
