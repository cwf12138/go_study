(() => {
 'use strict';
 const O=window.DaynestTodoOutbox,H=window.DaynestHTTP;
 const actor=()=>H.authExpired()?null:window.DaynestAccount?.current?.();
 function remember(){const account=actor();if(!account)return;try{if(localStorage.getItem(O.identityKey(account.server)))O.identify(localStorage,account,document.getElementById('user-name')?.textContent);}catch(_){} }
 function open(){const account=actor();if(!account){window.DaynestUI?.notify('请先在线核验账号，再打开本机收集。','error');return;}try{O.identify(localStorage,account,document.getElementById('user-name')?.textContent);window.DaynestReadCache?.prepareOfflineShell?.().catch(()=>{});if(window.DaynestMobile?.openOfflineReader)window.DaynestMobile.openOfflineReader('capture');else window.open('/offline/#capture','_blank','noopener,noreferrer');}catch(error){window.DaynestUI?.notify(error.message,'error');}}
 document.getElementById('todo-local-open')?.addEventListener('click',open);
 document.addEventListener('daynest:account-ready',remember);
 for(const type of ['daynest:auth-expired','daynest:account-leaving'])document.addEventListener(type,event=>{if(event.detail?.keepStoredSession)return;const account=window.DaynestAccount?.current?.();if(account){try{O.revoke(localStorage,account);}catch(_){}}});
 window.addEventListener('storage',event=>{
  const account=actor();if(!account)return;
  if(event.key===O.PREFIX+'imported'){try{const value=JSON.parse(event.newValue);if(value?.server===account.server&&value.userID===account.userID){document.dispatchEvent(new CustomEvent('daynest:todo-imported',{detail:{server:account.server,userID:account.userID}}));window.DaynestReadCache?.refreshPlanning?.();}}catch(_){} }
  if(event.key===O.identityKey(account.server)){try{const value=JSON.parse(event.newValue);if(value?.revoked&&value.userID===account.userID&&value.credentialTag===window.DaynestReadCacheCore.hash(account.token))H.reportUnauthorized(H.capture());}catch(_){} }
 });
 if(actor())remember();
})();
