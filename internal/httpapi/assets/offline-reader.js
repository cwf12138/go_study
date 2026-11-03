(() => {
  'use strict';
  const C=window.DaynestReadCacheCore,$=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let entries=[],selected='',vault=null,identity=null,server='',theme='light';
  function applyTheme(){document.documentElement.dataset.theme=theme;}
  try{theme=localStorage.getItem('studyflow.theme')|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(_){}applyTheme();
  const date=value=>new Date(value).toLocaleString('zh-CN'),status=message=>{$('or-status').textContent=message;};
  function clearDocument(){selected='';$('or-document').hidden=true;$('or-empty').hidden=false;['or-title','or-meta','or-tags','or-content'].forEach(id=>$(id).textContent='');}
  function authorized(){try{const current=C.resolve(localStorage,server,localStorage.getItem('studyflow.token')||'');if(!current||current.userID!==identity?.userID||current.credentialTag!==identity?.credentialTag){load();return false;}if(parent!==window){const config=JSON.parse(localStorage.getItem('daynest.mobile.connection.v1')||'null');if(!config||C.origin(config.server)!==server){load();return false;}}return true;}catch(_){load();return false;}}
  function renderList(){const query=$('or-search').value.trim().toLocaleLowerCase(),sort=$('or-sort').value;
    const items=entries.filter(({note})=>[note.title,note.content,...note.tags].join('\n').toLocaleLowerCase().includes(query)).sort((a,b)=>sort==='title'?a.note.title.localeCompare(b.note.title,'zh-CN'):sort==='updated'?(C.version(a.note.updated_at)>C.version(b.note.updated_at)?-1:C.version(a.note.updated_at)<C.version(b.note.updated_at)?1:0):Date.parse(b.readAt)-Date.parse(a.readAt));
    $('or-list').innerHTML=items.length?items.map(item=>`<button type="button" data-note="${esc(item.note.id)}" class="or-note ${selected===item.note.id?'selected':''}" aria-pressed="${selected===item.note.id}"><strong>${esc(item.note.title||'未命名备忘录')}</strong><span>${esc(item.note.content.slice(0,75)||'没有正文')}</span><small>保留于 ${esc(date(item.readAt))}</small></button>`).join(''):'<p class="or-muted">'+(query?'没有匹配的本机内容。':'尚无可阅读的快照。')+'</p>';
  }
  function select(id,fromList=false){if(!authorized())return;const item=entries.find(entry=>entry.note.id===id);if(!item)return clearDocument();selected=id;$('or-empty').hidden=true;$('or-document').hidden=false;$('or-title').textContent=item.note.title||'未命名备忘录';$('or-meta').textContent=`本机保留 ${date(item.readAt)}\n原文更新 ${date(item.note.updated_at)}${item.note.archived?' · 原文已归档':''}`;$('or-tags').innerHTML=item.note.tags.map(tag=>`<span>${esc(tag)}</span>`).join('');$('or-content').textContent=item.note.content||'这篇备忘录没有正文。';renderList();if(fromList&&matchMedia('(max-width:720px)').matches){document.querySelector('.or-workspace').classList.remove('show-library');$('or-library').setAttribute('aria-expanded','false');$('or-title').focus({preventScroll:true});}}
  function load(){clearDocument();entries=[];vault=null;identity=null;$('or-count').textContent='0';$('or-clear').disabled=true;$('or-library').textContent='资料列表';$('or-account').textContent='当前没有可核对的本机账号资料。';
    try{server=C.origin(new URLSearchParams(location.search).get('server')||location.origin);
      // Native frames are tied to the selected server, even if a stale frame URL remains open.
      if(window.parent!==window){const connection=JSON.parse(localStorage.getItem('daynest.mobile.connection.v1')||'null');if(!connection||C.origin(connection.server)!==server)throw Error('电脑连接已变化，请关闭后从连接页重新打开。');}
      identity=C.resolve(localStorage,server,localStorage.getItem('studyflow.token')||'');if(!identity){status('请在原服务在线登录，并开启离线保留。退出或切换账号后，旧资料不会在这里显示。');renderList();return;}
      vault=C.create(localStorage,server,identity.userID);const data=vault.read();entries=data.entries;$('or-count').textContent=entries.length;$('or-library').textContent=`资料列表 · ${entries.length} 篇 ↕`;$('or-account').textContent=`${identity.name} · ${server} · 此处未连接或验证在线会话`;$('or-clear').disabled=false;
      status(data.enabled?'只读快照可能不是最新内容。它们不包含未提交的编辑，也不能在这里保存到电脑。':'离线保留已关闭。在线时可从备忘录重新开启。');renderList();if(entries.length)select([...entries].sort((a,b)=>Date.parse(b.readAt)-Date.parse(a.readAt))[0].note.id);
    }catch(error){status(error.message||'本机资料无法读取。');$('or-clear').disabled=!vault;renderList();}
  }
  $('or-library').addEventListener('click',()=>{const open=document.querySelector('.or-workspace').classList.toggle('show-library');$('or-library').setAttribute('aria-expanded',String(open));if(open)$('or-search').focus();});
  $('or-search').addEventListener('input',renderList);$('or-sort').addEventListener('change',renderList);
  $('or-list').addEventListener('click',event=>{const button=event.target.closest('[data-note]');if(button)select(button.dataset.note,true);});
  $('or-clear').addEventListener('click',()=>{if(!vault||!authorized()||!confirm('关闭此账号的离线保留并清空快照？这不会删除电脑上的原文或本机草稿。'))return;try{vault.setEnabled(false);load();}catch(error){status(error.message);}});
  $('or-export').addEventListener('click',async()=>{if(!authorized())return;const item=entries.find(entry=>entry.note.id===selected);if(!item)return;const token=localStorage.getItem('studyflow.token'),text=`# ${item.note.title}\n\n> 只读快照 · 保留于 ${date(item.readAt)} · 原文更新 ${date(item.note.updated_at)}\n\n${item.note.content}\n`,blob=new Blob([text],{type:'text/markdown;charset=utf-8'}),name=(item.note.title||'备忘录').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,80)+'.md';
    try{if(parent!==window&&parent.DaynestMobile?.saveBlob){await parent.DaynestMobile.saveBlob(blob,name,token);return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){if(authorized())status(error.message||'导出未完成，请重试。');}
  });
  $('or-theme').addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';applyTheme();try{localStorage.setItem('studyflow.theme',theme);}catch(_){}});
  if(parent!==window){document.body.classList.add('or-embedded');$('or-back').addEventListener('click',()=>parent.postMessage({type:'daynest:offline-close'},location.origin));document.querySelector('.or-brand').removeAttribute('href');}
  window.addEventListener('storage',event=>{if(!event.key||event.key==='studyflow.token'||event.key==='daynest.mobile.connection.v1'||event.key.startsWith(C.prefix))load();if(event.key==='studyflow.theme'){theme=localStorage.getItem('studyflow.theme')||'light';applyTheme();}});
  load();
  if(parent===window&&location.pathname==='/offline/'&&'serviceWorker' in navigator&&window.isSecureContext){navigator.serviceWorker.register('/offline/sw.js',{scope:'/offline/'}).then(()=>{$('or-shell').textContent='离线页面准备中；首次请等待资源保留完成。';return new Promise((resolve,reject)=>{let attempts=0;const check=async()=>{try{const registration=await navigator.serviceWorker.getRegistration('/offline/');if(registration?.active)return resolve();if(++attempts>=100)return reject(Error());setTimeout(check,100);}catch(error){reject(error);}};check();});}).then(()=>{$('or-shell').textContent='离线页面已准备，可收藏此地址供断网后打开。';}).catch(()=>{$('or-shell').textContent='离线页面尚未准备好；联网后重新打开此页。';});}
  else $('or-shell').textContent=parent!==window?'阅读界面来自 App 内置资源。':window.isSecureContext?'此页面不读取在线业务接口。':'此 HTTP 地址不支持离线页面启动；当前页打开后仍可阅读本机快照。';
})();
