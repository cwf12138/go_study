(() => {
  'use strict';
  const H=window.DaynestHTTP,C=window.DaynestActionCore;
  const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let generation=0,owner=null,busy=false,currentContext=null,source=null,returnFocus=null;
  const dialog=document.createElement('dialog');dialog.id='action-dialog';dialog.className='action-dialog';dialog.setAttribute('aria-labelledby','action-title');
  dialog.innerHTML='<header><div><span class="action-eyebrow">CONNECTED ACTIONS</span><h2 id="action-title">行动关联</h2></div><button type="button" data-action-close aria-label="关闭行动关联">×</button></header><div id="action-body"></div><p id="action-status" role="status" aria-live="polite"></p>';
  document.body.append(dialog);
  const banner=document.createElement('button');banner.type='button';banner.className='action-pending';banner.hidden=true;banner.textContent='有操作待确认 · 点击核对';document.body.append(banner);
  const current=()=>owner&&H.current(owner);
  function contract(valid,uncertain=false){if(!valid){const error=Error('服务返回的行动数据不完整，请核对连接及后端版本。');error.kind='protocol';error.uncertain=uncertain;throw error;}}
  const store=()=>C.commands(localStorage,H.capture());
  function notify(message,error=false){if(window.DaynestUI?.notify)window.DaynestUI.notify(message,error?'error':'success');}
  function status(message,error=false){$('#action-status').textContent=message;$('#action-status').classList.toggle('error',error);}
  function refreshBanner(){try{const c=H.capture();banner.hidden=!c.userID||!c.token||!Object.keys(C.commands(localStorage,c).read()).length;}catch(_){banner.hidden=!window.DaynestAccount?.current?.();banner.textContent='操作记录需要检查 · 点击查看';}}
  function changed(){document.dispatchEvent(new CustomEvent('daynest:actions-changed'));refreshBanner();}
  function begin(title){generation++;owner=H.capture();source=null;currentContext=null;returnFocus=document.activeElement;$('#action-title').textContent=title;$('#action-body').innerHTML='<p class="action-muted">正在读取…</p>';status('');if(!dialog.open)dialog.showModal();return generation;}
  function close(){if(busy)return;generation++;dialog.close();returnFocus?.focus?.();}
  function goto(view){document.querySelector(`.nav-link[data-view="${view}"]`)?.click();}
  function setBusy(value){busy=value;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=value);}
  function describe(error){return error.uncertain?'服务端可能已处理。本机保留了原始操作，可在“待确认操作”中核对或原样重试。':error.message;}
  async function dispatch(kind,command,{retry=false}={}){
    const context=H.capture(),commands=C.commands(localStorage,context);
    if(!retry)commands.put(kind,command);
    refreshBanner();
    try{const data=await H.json(command.path,{method:'POST',body:command.body,context});if(!H.current(context))throw Error('账号或服务已变化，请在原账号核对结果。');contract(kind==='focus'?C.validFocus(data,context.userID):typeof data?.created==='boolean'&&typeof data.matches_request==='boolean'&&C.validContext(data.context,context.userID),true);commands.remove(kind);changed();return data;}
    catch(error){if(H.current(context)&&!error.uncertain&&error.kind!=='context'&&error.status>=400)commands.remove(kind);refreshBanner();throw error;}
  }
  async function openMemo(note,start,end){
    if(busy)return;
    const anchor=C.anchor(note,start,end),version=begin('把记录变成行动');source={note,anchor};
    $('#action-body').innerHTML=`<p class="action-muted">${anchor.anchor_kind==='title'?'以备忘录标题为来源':'以选中内容所在的完整一行为来源'}。同一来源只关联一个待办。关联会保留标题和这一行的引用，删除原文后仍可回查。</p><blockquote>${esc(anchor.anchor_text)}</blockquote><form id="action-create-form"><label>待办名称<input id="action-todo-title" maxlength="200" required value="${esc([...anchor.anchor_text].slice(0,200).join(''))}"></label><div class="action-fields"><label>优先级<select id="action-priority"><option value="medium">普通</option><option value="high">重要</option><option value="low">低</option></select></label><label>截止日期<input id="action-due" type="date"></label></div><label class="action-check"><input id="action-myday" type="checkbox" checked>加入今天</label><button class="primary" type="submit">创建并关联待办 ↗</button></form><section class="action-history"><h3>这篇备忘录的行动</h3><div id="action-links">正在读取关联…</div></section>`;
    try{const links=await H.json(`/api/v1/memos/${note.id}/actions`,{context:owner});if(version!==generation||!current())return;contract(Array.isArray(links)&&links.every(link=>C.validLink(link,owner.userID)&&link.memo_id===note.id));
      $('#action-links').innerHTML=links.length?links.map(link=>`<button type="button" data-action-link="${esc(link.id)}">${esc(link.anchor_text)}<span>查看关联 →</span></button>`).join(''):'<p class="action-muted">尚未关联。创建后可从待办和日历回到这里。</p>';
    }catch(error){if(version===generation&&current())$('#action-links').textContent=error.message;}
  }
  function renderContext(data){
    currentContext=data;const t=data.todo,l=data.link,s=data.source;
    $('#action-title').textContent=t?.title||'这项待办已删除';
    $('#action-body').innerHTML=`<div class="action-flow"><span>记录</span><i>→</i><span>待办</span><i>→</i><span>专注</span><i>→</i><span>日历</span></div><div class="action-summary"><span class="action-badge">${t?(t.status==='completed'?'已完成':'待处理'):'保留历史'}</span><strong>${data.completed_minutes} <small>分钟已完成专注</small></strong></div>${l?`<section class="action-source"><h3>来自备忘录 · ${esc(s?.title||l.memo_title)}</h3><blockquote>${esc(l.anchor_text)}</blockquote><p class="action-muted">${s?.deleted?'原备忘录已删除，保留创建时的引用。':s?.changed?'原备忘录已修改；上方为创建待办时的引用。':'原始内容已关联，可随时回查。'}</p>${!s?.deleted?'<button type="button" class="quiet" data-action-source>打开原备忘录 ↗</button>':''}</section>`:'<p class="action-muted">这是一项独立待办，可在这里查看专注记录。</p>'}<div class="action-controls">${t?.status==='open'?'<button type="button" class="primary" data-action-focus>为它安排专注 ↗</button>':''}${t?'<button type="button" class="quiet" data-action-todo>查看待办</button>':''}</div><p class="action-muted">专注只记录投入时间。请在待办清单中明确勾选完成；备忘录的勾选状态保持独立。</p><section class="action-history"><h3>最近的专注</h3>${data.sessions.length?data.sessions.map(item=>`<div class="action-session"><span>${esc(new Date(item.started_at).toLocaleString('zh-CN'))}</span><b>${item.status==='completed'?`${item.actual_minutes} 分钟`:item.status==='abandoned'?'已结束（未完成）':item.status==='paused'?'已暂停':'进行中'}</b></div>`).join(''):'<p class="action-muted">还没有专注记录，从一小段时间开始。</p>'}</section>`;
  }
  async function openContext(path){if(busy)return;const version=begin('行动详情');try{const data=await H.json(path,{context:owner});if(version===generation&&current()){contract(C.validContext(data,owner.userID));renderContext(data);}}catch(error){if(version===generation&&current())status(error.message,true);}}
  async function recovery(){if(busy)return;begin('核对待确认操作');let commands;try{commands=store().read();}catch(error){status(error.message,true);return;}
    $('#action-body').innerHTML=Object.entries(commands).map(([kind,c])=>`<section class="action-recovery"><h3>${kind==='link'?'备忘录关联待办':'开启待办专注'}</h3><p>${esc(c.body.title||c.body.todo_id)}</p><p class="action-muted">${esc(new Date(c.createdAt).toLocaleString('zh-CN'))} · 保留了原始参数，尚未确认结果。</p><div class="action-controls"><button type="button" class="primary" data-action-check="${kind}">核对结果</button><button type="button" class="quiet" data-action-retry="${kind}">原样重试</button><button type="button" class="quiet" data-action-forget="${kind}">移除本机追踪</button></div></section>`).join('')||'<p class="action-muted">当前没有待确认操作。</p>';}
  async function check(kind,retry){
    const context=owner,version=generation,commands=C.commands(localStorage,context),command=commands.read()[kind];if(!command)return recovery();setBusy(true);status('正在核对…');
    try{let result;if(retry)result=await dispatch(kind,command,{retry:true});else if(kind==='link'){
        const links=await H.json(command.path,{context});if(version!==generation||!H.current(context))return;contract(Array.isArray(links)&&links.every(link=>C.validLink(link,context.userID)));const link=links.find(l=>l.anchor_kind===command.body.anchor_kind&&l.anchor_text===C.normalize(command.body.anchor_text));
        if(!link){status('暂未查到关联。可以原样重试；不要改写原始参数后重新创建。');return;}
        result={context:await H.json(`/api/v1/action-links/${link.id}`,{context})};
      }else{result=await H.json(`/api/v1/focus-sessions/requests/${command.body.request_id}`,{context});}
      if(version!==generation||!H.current(context))return;contract(kind==='link'?C.validContext(result.context,context.userID):C.validFocus(result,context.userID));commands.remove(kind);changed();if(kind==='link')renderContext(result.context);else{document.dispatchEvent(new CustomEvent('daynest:todo-focus-recovered',{detail:result}));setBusy(false);await recovery();status('已确认会话，计时状态已同步。');}
    }catch(error){if(version===generation&&H.current(context))status(error.status===404?'暂未查到会话。可使用同一操作原样重试。':describe(error),true);}finally{if(version===generation)setBusy(false);}
  }
  dialog.addEventListener('submit',async event=>{if(event.target.id!=='action-create-form')return;event.preventDefault();if(busy||!current()||!source)return;
    const day=new Date(),today=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    const due=$('#action-due').value;const command={path:`/api/v1/memos/${source.note.id}/actions`,createdAt:Date.now(),body:{...source.anchor,expected_updated_at:source.note.updated_at,title:$('#action-todo-title').value.trim(),priority:$('#action-priority').value,due_at:due?new Date(due+'T23:59:00').toISOString():null,my_day_date:$('#action-myday').checked?today:''}};
    const version=generation;setBusy(true);status('正在创建关联…');try{const result=await dispatch('link',command);if(version===generation&&current()){renderContext(result.context);status(result.created?'待办已创建，下一步可以开始专注。':result.matches_request?'已找到原先创建的待办，没有重复创建。':'这段内容已有关联，本次设置未修改原待办。');}}catch(error){if(version===generation&&current())status(describe(error),true);}finally{if(version===generation)setBusy(false);}
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||busy)return;
    if(b.hasAttribute('data-action-close'))close();
    if(b.hasAttribute('data-action-source')&&currentContext?.source){const s=currentContext.source;close();goto('memos');document.dispatchEvent(new CustomEvent('daynest:open-search-memo',{detail:{id:s.id,archived:s.archived}}));}
    if(b.hasAttribute('data-action-todo')){close();goto('todo');document.dispatchEvent(new CustomEvent('daynest:show-action-todo',{detail:currentContext?.todo}));}
    if(b.hasAttribute('data-action-focus')&&currentContext?.todo){close();document.dispatchEvent(new CustomEvent('daynest:prepare-todo-focus',{detail:currentContext.todo}));}
    if(b.dataset.actionCheck)check(b.dataset.actionCheck,false);
    if(b.dataset.actionRetry)check(b.dataset.actionRetry,true);
    if(b.dataset.actionForget){if(confirm('仅移除本机追踪，不会撤销服务端操作。请先核对结果，确定继续？')){store().remove(b.dataset.actionForget);refreshBanner();recovery();}}
  });
  document.addEventListener('click',event=>{const link=event.target.closest('[data-action-link]'),todo=event.target.closest('[data-action-todo-context]');if(link)openContext(`/api/v1/action-links/${link.dataset.actionLink}`);else if(todo)openContext(`/api/v1/todos/${todo.dataset.actionTodoContext}/context`);});
  banner.addEventListener('click',recovery);
  const reset=()=>{generation++;owner=null;busy=false;source=null;currentContext=null;if(dialog.open)dialog.close();refreshBanner();};
  document.addEventListener('daynest:account-ready',reset);
  window.addEventListener('storage',event=>{if(!event.key||event.key==='studyflow.token')reset();else if(event.key.startsWith('daynest.actions.v1:'))refreshBanner();});
  new MutationObserver(()=>{if($('#app-view').classList.contains('hidden'))reset();}).observe($('#app-view'),{attributes:true,attributeFilter:['class']});
  window.DaynestActions={openMemo,openTodo:id=>openContext(`/api/v1/todos/${id}/context`),
    hasPendingFocus(){try{return!!store().read().focus;}catch(_){return true;}},recovery,
    async startTodoFocus(todoID,minutes,breakEnabled){if(this.hasPendingFocus()){await recovery();throw Error('请先核对上一次待办专注的结果。');}
      const id=window.crypto?.randomUUID?.()||Array.from(window.crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');
      return dispatch('focus',{path:'/api/v1/focus-sessions',createdAt:Date.now(),body:{todo_id:todoID,request_id:id,planned_minutes:minutes,break_enabled:breakEnabled}});
    }};
  refreshBanner();
})();
