(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let theme='light';
  function applyTheme(){document.documentElement.dataset.theme=theme;}
  try{theme=localStorage.getItem('studyflow.theme')|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(_){}applyTheme();
  $('or-theme').addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';applyTheme();try{localStorage.setItem('studyflow.theme',theme);}catch(_){}});
  if(parent!==window){document.body.classList.add('or-embedded');$('or-back').addEventListener('click',()=>parent.postMessage({type:'daynest:offline-close'},location.origin));document.querySelector('.or-brand').removeAttribute('href');}
  window.addEventListener('storage',event=>{if(event.key==='studyflow.theme'){theme=event.newValue||'light';applyTheme();}});
  if(parent===window&&location.pathname==='/offline/'&&'serviceWorker' in navigator&&window.isSecureContext){navigator.serviceWorker.register('/offline/sw.js',{scope:'/offline/'}).then(registration=>{$('or-shell').textContent='离线页面准备中；首次请等待资源保留完成。';return new Promise((resolve,reject)=>{const worker=registration.installing||registration.waiting||registration.active;if(!worker)return reject(Error());if(worker.state==='activated')return resolve();const timer=setTimeout(()=>reject(Error()),10000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error());}});});}).then(()=>{$('or-shell').textContent='离线页面已准备，可收藏此地址供断网后打开。';}).catch(()=>{$('or-shell').textContent='离线页面尚未准备好；联网后重新打开此页。';});}
  else $('or-shell').textContent=parent!==window?'阅读界面来自 App 内置资源。':window.isSecureContext?'阅读快照不访问业务接口；本机收集仅在手动核对或提交时连接服务。':'此 HTTP 地址不支持离线页面启动；当前页打开后仍可阅读本机快照。';
})();
