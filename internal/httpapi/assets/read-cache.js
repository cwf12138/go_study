(() => {
  'use strict';
  const C=window.DaynestReadCacheCore,P=window.DaynestPlanningCache,H=window.DaynestHTTP,$=id=>document.getElementById(id);
  let verified=null,shell='',sourceControl=null;
  const dialog=document.createElement('dialog');dialog.id='read-cache-dialog';dialog.className='read-cache-dialog';dialog.setAttribute('aria-labelledby','rc-title');
  dialog.innerHTML='<header><div><h2 id="rc-title">离线资料</h2></div><button id="rc-close" type="button" aria-label="关闭离线资料设置">×</button></header><p id="rc-status" role="status" aria-live="polite"></p>';
  dialog.insertAdjacentHTML('beforeend','<section class="rc-planning"><h3>待办与当日安排</h3><p>单独开启后保留完整待办清单，以及最多 7 个已读取日期的安排。离线状态只读，不勾选完成、不创建日程。</p><label class="rc-switch"><span>保留待办与当日安排<small>最多 500 项待办 · 共 512 KiB</small></span><input id="pc-enabled" type="checkbox"></label><p id="pc-summary"></p><div class="pc-refresh-row"><label>准备的日期（北京时间）<input id="pc-date" type="date" min="2000-01-01" max="2099-12-30"></label><button id="pc-refresh" class="quiet" type="button">更新此日与待办</button></div><p id="pc-status" role="status" aria-live="polite"></p><p><a id="pc-reader" class="primary" href="/offline/#todos" target="_blank" rel="noopener noreferrer">打开待办与安排 ↗</a></p><button id="pc-clear" class="quiet" type="button">仅关闭并清空安排快照</button></section>');
  document.body.append(dialog);
  let planningError='',planningState={writes:0,serial:0,controller:null},planningTimer;
  $('pc-date').value=P.today();
  function cancelPlanning(){planningState.serial++;planningState.controller?.abort();planningState.controller=null;}
  function renderPlanning(){const account=owner();$('pc-enabled').disabled=!account;$('pc-clear').disabled=!account;$('pc-refresh').disabled=!account||planningState.writes>0||!!planningState.controller;$('pc-enabled').checked=false;$('pc-summary').textContent='在线登录后可单独开启。';
    try{if(account){const data=P.create(localStorage,account.server,account.userID).read();$('pc-enabled').checked=data.enabled;$('pc-refresh').disabled=$('pc-refresh').disabled||!data.enabled;$('pc-summary').textContent=`${data.todo?data.todo.items.length+' 项待办（完整清单）':'待办尚未准备'} · 已保留 ${data.days.length} / 7 个日期`+(data.invalidated_at?' · 在线修改后等待重新读取':'');}}catch(error){planningError=error.message;}
    $('pc-status').textContent=planningState.writes?'在线操作进行中，安排快照已作废。':planningState.controller?'正在核对完整待办与所选日期…':planningError||'只有完整成功读取后才替换快照；失败时保留此前副本。';
  }
  function planningEnabled(account=owner()){return!!account&&P.create(localStorage,account.server,account.userID).read().enabled;}
  async function refreshPlanning(date=$('pc-date').value){const account=owner();if(!account||planningState.writes)return false;let saved;
    try{P.day(date);saved=P.create(localStorage,account.server,account.userID);if(!saved.read().enabled)return false;}catch(error){planningError=error.message;renderPlanning();return false;}
    cancelPlanning();const state=planningState,serial=state.serial,context=H.capture(),fence=saved.read().fence,controller=new AbortController();state.controller=controller;planningError='';renderPlanning();
    try{const options={context,signal:controller.signal};const lists=await H.json('/api/v1/todo-lists',options);const [todos,overview]=await Promise.all([H.json(`/api/v1/todos?view=all&date=${date}`,options),H.json(`/api/v1/calendar?start=${date}&end=${P.nextDay(date)}`,options)]);
      if(state!==planningState||serial!==state.serial||state.writes||!safeContext(context))return false;
      const result=saved.commit(lists,todos,overview,date,fence);planningError=result.stored?`已完整保留 ${todos.length} 项待办及 ${date} 的安排。`:'保留设置或快照已变化，本次结果未覆盖本机内容。';return result.stored;
    }catch(error){if(state===planningState&&serial===state.serial&&safeContext(context)&&error.kind!=='cancelled')planningError=`安排快照未更新：${error.message}`;return false;}
    finally{if(state===planningState&&serial===state.serial){state.controller=null;renderPlanning();}}
  }
  function queuePlanning(){clearTimeout(planningTimer);planningTimer=setTimeout(()=>{try{if(!document.hidden&&navigator.onLine!==false&&planningEnabled()&&!planningState.writes&&!planningState.controller)refreshPlanning(P.today());}catch(error){planningError=error.message;renderPlanning();}},350);}
  function beginPlanningWrite(path,method,context){if(['GET','HEAD'].includes((method||'GET').toUpperCase())||!/^\/api\/v1\/(?:todo-imports(?:\/|$)|todos(?:\/|$)|todo-lists(?:\/|$)|tasks(?:\/|$)|plan-blocks(?:\/|$)|planner\/|calendar\/(?:events|event-commands)(?:\/|$)|moods(?:\/|$)|fitness(?:\/|$)|focus-sessions(?:$|\/[^/]+\/finish$))/.test(path)||!context||!safeContext(context))return;
    try{if(!planningEnabled())return;}catch(error){planningError=error.message;return;}
    const state=planningState,account=owner();cancelPlanning();planningError='检测到在线操作，旧安排已作废，等待重新读取。';state.writes++;try{P.create(localStorage,account.server,account.userID).invalidate();}catch(error){planningError=error.message;}renderPlanning();
    let done=false;return()=>{if(done)return;done=true;state.writes=Math.max(0,state.writes-1);if(state!==planningState||!safeContext(context))return;try{P.create(localStorage,account.server,account.userID).invalidate();}catch(error){planningError=error.message;}if(!state.writes)queuePlanning();renderPlanning();};
  }
  $('pc-enabled').addEventListener('change',async()=>{const context=H.capture(),account=owner();if(!account)return;const enabled=$('pc-enabled').checked;try{if(!enabled&&!confirm('关闭并清空待办与安排快照？本机草稿和在线记录不受影响。'))return renderPlanning();cancelPlanning();P.create(localStorage,account.server,account.userID).setEnabled(enabled);C.identify(localStorage,account,$('user-name')?.textContent);planningError='';if(enabled){await prepareShell();if(H.current(context))await refreshPlanning();}}catch(error){if(H.current(context))planningError=error.message;}render();});
  $('pc-clear').addEventListener('click',()=>{const account=owner();if(!account||!confirm('仅关闭并清空安排快照？'))return;try{cancelPlanning();P.create(localStorage,account.server,account.userID).setEnabled(false);planningError='';}catch(error){planningError=error.message;}renderPlanning();});
  $('pc-refresh').addEventListener('click',()=>refreshPlanning());
  window.addEventListener('online',queuePlanning);window.addEventListener('focus',queuePlanning);setInterval(queuePlanning,60000);

  const owner=()=>H.authExpired?.()?null:window.DaynestAccount?.current?.();
  function render(){ $('rc-status').textContent=shell;renderPlanning(); }
  async function prepareShell(){if(window.DaynestMobile?.native){shell='阅读界面已随 App 打包，电脑不可达时可从连接页打开。';return;}
    if(!window.isSecureContext||!navigator.serviceWorker){shell='当前 HTTP 地址不能离线启动网页。可保持阅读页打开，或在安卓 App 中使用内置阅读界面。';return;}
    try{const registration=await navigator.serviceWorker.register('/offline/sw.js',{scope:'/offline/'});if(registration.installing||registration.waiting||!registration.active){await new Promise((resolve,reject)=>{const worker=registration.installing||registration.waiting;if(!worker)return reject(Error());if(worker.state==='activated')return resolve();const timer=setTimeout(()=>reject(Error()),10000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error());}});});}shell='离线阅读页已准备好。请收藏阅读库地址，断网后可直接打开。';}catch(_){shell='快照仍会保留；离线页面尚未准备好，请联网后再打开阅读库。';}}
  function accept(){
    const account=owner();
    if(!account)return;
    verified={...account};
    try{if(planningEnabled(account)){C.identify(localStorage,account,$('user-name')?.textContent);prepareShell().then(render);queuePlanning();}}
    catch(error){planningError=error.message;}
    render();
  }
  function safeContext(context){const active=owner();return!!active&&H.current(context)&&active.userID===context.userID&&active.server===context.server;}
  function open(options={}){sourceControl=document.activeElement;if(options.planningDate)$('pc-date').value=options.planningDate;$('pc-reader').href='/offline/#'+(options.section==='agenda'?'agenda':'todos');render();if(!dialog.open)dialog.showModal();dialog.scrollTop=0;}
  function openReader(event){if(window.DaynestMobile?.openOfflineReader){event.preventDefault();const section=event.currentTarget?.id==='pc-reader'&&event.currentTarget.hash?event.currentTarget.hash.slice(1):undefined;window.DaynestMobile.openOfflineReader(section);}}
  $('rc-close').addEventListener('click',()=>{dialog.close();sourceControl?.focus?.();});
  $('pc-reader').addEventListener('click',openReader);
  $('todo-offline-open')?.addEventListener('click',()=>open({section:'todos',planningDate:P.today()}));
  $('calendar-offline-open')?.addEventListener('click',event=>open({section:'agenda',planningDate:event.currentTarget.dataset.selectedDate||P.today()}));
  $('auth-offline-open')?.addEventListener('click',openReader);
  document.addEventListener('daynest:account-ready',()=>{cancelPlanning();planningState={writes:0,serial:0,controller:null};planningError='';if(dialog.open)dialog.close();accept();});
  document.addEventListener('daynest:account-leaving',event=>{cancelPlanning();planningState={writes:0,serial:0,controller:null};planningError='';if(!event.detail?.keepStoredSession&&verified){try{P.create(localStorage,verified.server,verified.userID).forget();C.create(localStorage,verified.server,verified.userID).forget();}catch(_){}verified=null;}if(dialog.open)dialog.close();});
  document.addEventListener('daynest:auth-expired',()=>{cancelPlanning();planningState={writes:0,serial:0,controller:null};planningError='';if(verified){try{P.create(localStorage,verified.server,verified.userID).forget();C.create(localStorage,verified.server,verified.userID).forget();}catch(_){}verified=null;}if(dialog.open)render();});
  window.addEventListener('storage',event=>{if(!event.key||event.key==='studyflow.token'){cancelPlanning();verified=null;planningError='';if(dialog.open)dialog.close();}else if(event.key.startsWith(C.prefix)){if(event.key.startsWith(C.prefix+'planning:'))cancelPlanning();if(dialog.open)render();}});
  window.DaynestReadCache={open,beginPlanningWrite,refreshPlanning,prepareOfflineShell:prepareShell};if(owner())accept();
})();
