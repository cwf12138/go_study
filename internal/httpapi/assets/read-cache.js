(() => {
  'use strict';
  const C=window.DaynestReadCacheCore,H=window.DaynestHTTP,$=id=>document.getElementById(id);
  let verified=null,lastError='',shell='',sourceControl=null;
  const dialog=document.createElement('dialog');dialog.id='read-cache-dialog';dialog.className='read-cache-dialog';dialog.setAttribute('aria-labelledby','rc-title');
  dialog.innerHTML='<header><div><p class="rc-eyebrow">READ WITHOUT THE RUSH</p><h2 id="rc-title">为阅读，留一份副本。</h2></div><button id="rc-close" type="button" aria-label="关闭离线阅读设置">×</button></header><p>开启后，保留最近打开且服务端成功返回的备忘录。离线时只读，不改动你的编辑区，也不自动提交内容。</p><label class="rc-switch"><span>保留最近阅读<small>仅此账号与此服务 · 默认关闭</small></span><input id="rc-enabled" type="checkbox"></label><p id="rc-summary" class="rc-meter"></p><div class="rc-buttons"><a id="rc-reader" class="primary" href="/offline/" target="_blank" rel="noopener noreferrer">打开阅读库 ↗</a><button id="rc-clear" class="quiet" type="button">关闭并清空</button></div><p id="rc-status" role="status" aria-live="polite"></p><p>最多 20 篇、1 MiB，达到限制时移除最早保留的快照。大篇幅内容可能不保留；退出登录会清除此账号快照，本机草稿与电脑原文保持独立。</p>';
  document.body.append(dialog);
  const owner=()=>H.authExpired?.()?null:window.DaynestAccount?.current?.();
  function render(){const account=owner();$('rc-enabled').disabled=!account;$('rc-clear').disabled=!account;$('rc-enabled').checked=false;$('rc-summary').textContent='在线登录后，可为此账号开启保留。';
    try{if(account){const data=C.create(localStorage,account.server,account.userID).read();$('rc-enabled').checked=data.enabled;$('rc-summary').textContent=`已保留 ${data.entries.length} / ${C.MAX_NOTES} 篇 · ${Math.ceil(C.bytes(JSON.stringify(data))/1024)} / 1024 KiB`;}}catch(error){lastError=error.message;}
    $('rc-status').textContent=lastError||shell||'快照可能不是最新原文，请以在线核对结果为准。';}
  async function prepareShell(){if(window.DaynestMobile?.native){shell='阅读界面已随 App 打包，电脑不可达时可从连接页打开。';return;}
    if(!window.isSecureContext||!navigator.serviceWorker){shell='当前 HTTP 地址不能离线启动网页。可保持阅读页打开，或在安卓 App 中使用内置阅读界面。';return;}
    try{const registration=await navigator.serviceWorker.register('/offline/sw.js',{scope:'/offline/'});if(!registration.active){await new Promise((resolve,reject)=>{const worker=registration.installing||registration.waiting;if(!worker)return reject(Error());const timer=setTimeout(()=>reject(Error()),10000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error());}});});}shell='离线阅读页已准备好。请收藏阅读库地址，断网后可直接打开。';}catch(_){shell='快照仍会保留；离线页面尚未准备好，请联网后再打开阅读库。';}}
  function accept(){const account=owner();if(!account)return;verified={...account};try{lastError='';if(C.create(localStorage,account.server,account.userID).read().enabled){C.identify(localStorage,account,$('user-name')?.textContent);prepareShell().then(render);}}catch(error){lastError=error.message;}render();}
  function safeContext(context){const active=owner();return!!active&&H.current(context)&&active.userID===context.userID&&active.server===context.server;}
  function observe(path,method,data,context){if(!safeContext(context))return;const match=path.match(/^\/api\/v1\/memos\/([\w-]+)(?:\/(restore|permanent))?$/);if(!match)return;
    try{const vault=C.create(localStorage,context.server,context.userID);
      if(method==='DELETE'||data?.deleted_at)vault.remove(match[1]);
      else if((method==='GET'||method==='PATCH'||(method==='POST'&&match[2]==='restore'))&&data?.id===match[1]){const result=vault.put(data);lastError=result.reason==='too_large'?'这篇内容超过单篇保留限制，在线原文可正常使用，离线库没有截断它。':result.reason==='same_version_conflict'?'相同版本返回了不同内容，已保留原快照，请在线核对。':'';}
    }catch(error){lastError=`本机快照未更新：${error.message} 在线操作结果不受影响。`;}if(dialog.open)render();}
  function missing(id,context){if(!safeContext(context))return;try{C.create(localStorage,context.server,context.userID).remove(id);}catch(error){lastError=error.message;}if(dialog.open)render();}
  function open(){sourceControl=document.activeElement;render();if(!dialog.open)dialog.showModal();}
  function openReader(event){if(window.DaynestMobile?.openOfflineReader){event.preventDefault();window.DaynestMobile.openOfflineReader();}}
  $('rc-close').addEventListener('click',()=>{dialog.close();sourceControl?.focus?.();});$('rc-reader').addEventListener('click',openReader);
  $('rc-enabled').addEventListener('change',async()=>{const context=H.capture(),account=owner();if(!account)return render();const enabled=$('rc-enabled').checked;
    try{if(!enabled&&!confirm('关闭离线保留会清空已有快照，原文和本机草稿不受影响。'))return render();C.identify(localStorage,account,$('user-name')?.textContent);C.create(localStorage,account.server,account.userID).setEnabled(enabled);lastError='';
      if(enabled){await prepareShell();if(!H.current(context))return;document.dispatchEvent(new CustomEvent('daynest:read-cache-enabled'));}
    }catch(error){if(H.current(context))lastError=error.message;}if(H.current(context))render();});
  $('rc-clear').addEventListener('click',()=>{const account=owner();if(!account||!confirm('关闭保留并清空此账号快照？原文和本机草稿不受影响。'))return;try{C.create(localStorage,account.server,account.userID).setEnabled(false);lastError='';}catch(error){lastError=error.message;}render();});
  $('memo-offline-open')?.addEventListener('click',open);$('auth-offline-open')?.addEventListener('click',openReader);
  document.addEventListener('daynest:account-ready',()=>{if(dialog.open)dialog.close();accept();});
  document.addEventListener('daynest:account-leaving',event=>{if(!event.detail?.keepStoredSession&&verified){try{C.create(localStorage,verified.server,verified.userID).forget();}catch(_){}verified=null;}lastError='';if(dialog.open)dialog.close();});
  document.addEventListener('daynest:auth-expired',()=>{if(verified){try{C.create(localStorage,verified.server,verified.userID).forget();}catch(_){}verified=null;}if(dialog.open)render();});
  window.addEventListener('storage',event=>{if(!event.key||event.key==='studyflow.token'){verified=null;lastError='';if(dialog.open)dialog.close();}else if(event.key.startsWith(C.prefix)&&dialog.open)render();});
  window.DaynestReadCache={observe,missing,open};if(owner())accept();
})();
