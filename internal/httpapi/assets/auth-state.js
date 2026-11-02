(() => {
  "use strict";
  const client=window.DaynestHTTP,notice=document.getElementById("auth-expiry"),app=document.getElementById("app-view");
  if(!client||!notice||!app)return;
  function render(){client.cancelStale();notice.hidden=app.classList.contains("hidden")||!client.authExpired();}
  document.addEventListener("daynest:auth-expired",render);
  document.addEventListener("daynest:account-ready",render);
  window.addEventListener("storage",e=>{if(!e.key||e.key==="studyflow.token")render();});
  new MutationObserver(render).observe(app,{attributes:true,attributeFilter:["class"]});
  document.getElementById("auth-expiry-login").addEventListener("click",()=>{
    // Reuse the existing unsaved-content confirmation. Expiry never clears an editor.
    if(client.authExpired())document.getElementById("logout")?.click();
  });
  render();
})();
