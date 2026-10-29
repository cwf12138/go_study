(() => {
  'use strict';
  const C=window.DaynestDiagnostics,$=id=>document.getElementById('dg-'+id),app=document.getElementById('app-view'),trigger=document.getElementById('diagnostics-open');
  if(!C||!$('dialog')||!trigger)return;
  const token=()=>localStorage.getItem('studyflow.token')||'';
  let owner='',sequence=0,controller=null,model=null,client=null,fresh=false,busy=false,exporting=false,opener=null;
  const message=text=>{$('status').textContent=text;};
  function connection(){try{return window.DaynestMobile?.getConnectionInfo?.().server||location.origin;}catch(_){return location.origin;}}
  function reset(){sequence++;controller?.abort();controller=null;owner='';model=null;client=null;fresh=false;busy=false;$('dialog').close();for(const id of ['target','client-kind','transport','uptime','key','last-success','loaded-snapshot','interval','attempt','server-version','server-commit','client-version','client-commit','runtime'])$(id).textContent='—';$('snapshot-summary').textContent='尚未读取写盘状态。';for(const id of ['connection-badge','snapshot-badge']){$(id).textContent='待检查';$(id).dataset.tone='neutral';}$('export').disabled=true;$('refresh').disabled=false;message('点击检查，读取当前服务状态。');}
  function sync(){const next=app.classList.contains('hidden')?'':token();if(next!==owner){reset();owner=next;}return !!owner;}
  function render(){
    $('target').textContent=connection();const native=!!window.DaynestMobile?.native;
    $('client-kind').textContent=native?'Android App':'网页';$('transport').textContent=connection().startsWith('https:')?'HTTPS':'HTTP（未加密）';$('connection').hidden=!window.DaynestMobile?.openConnectionSettings;
    $('refresh').disabled=busy;$('export').disabled=!model||exporting;
    $('connection-badge').textContent=busy?'检查中':fresh?'接口可达':model?'上次记录':'未连接';$('connection-badge').dataset.tone=fresh?'good':'neutral';
    $('client-version').textContent=client?`${client.version}（${client.version_code}）`+(client.dirty?' · 含本机修改':''):native?'无客户端构建信息':'网页源码（未独立标记）';$('client-commit').textContent=(client?.commit||'未标记')+(client?.content_hash?' · 资源 '+client.content_hash.slice(0,12):'');
    if(!model)return;const s=C.summary(model),p=model.persistence,o=p.observation;
    $('snapshot-badge').textContent=fresh?s[0]:'上次记录';$('snapshot-badge').dataset.tone=fresh?s[2]:'neutral';$('snapshot-summary').textContent=(fresh?'':'以下为上次成功读取的状态。')+s[1]+(o.in_progress?' 当前正在尝试写入。':'');
    $('last-success').textContent=C.time(o.last_success_at);$('loaded-snapshot').textContent=C.time(o.loaded_snapshot_at)+(o.recovered_from_backup?' · 从滚动备份恢复':'');$('interval').textContent=`每 ${p.interval_seconds} 秒尝试`;
    $('attempt').textContent=`${C.time(o.last_attempt_at)} / ${o.consecutive_failures} 次`;$('key').textContent=model.security.development_key?'仍为公开开发密钥':'未使用已知公开开发密钥（不代表强度认证）';
    $('uptime').textContent=`${Math.floor(model.runtime.uptime_seconds/3600)} 小时 ${Math.floor(model.runtime.uptime_seconds%3600/60)} 分钟`;
    $('server-version').textContent=model.build.version==='dev'?'源码运行 · dev':model.build.version;$('server-commit').textContent=model.build.commit+(model.build.dirty?' · 含本机修改':'');$('runtime').textContent=`${model.mobile_protocol} / ${model.runtime.go} · ${model.runtime.os}/${model.runtime.arch}`;
  }
  async function check(){
    if(!sync()||busy)return;const account=owner,id=++sequence,c=new AbortController();controller=c;busy=true;fresh=false;render();message('正在检查当前 Go 服务…');const timer=setTimeout(()=>c.abort(),15000);
    try{
      const response=await fetch('/api/v1/system/diagnostics',{headers:{Authorization:'Bearer '+account},signal:c.signal,cache:'no-store'});
      if(!response.ok)throw Error(response.status===401?'登录状态失效，请重新登录。':response.status===404?'当前服务缺少诊断接口，请重启新版 Go 服务。':`诊断请求失败（${response.status}）。`);
      const out=await response.json();if(!C.valid(out?.data))throw Error('诊断数据格式异常，请检查两端版本。');
      let meta=null;if(window.DaynestMobile?.native){try{const res=await fetch('/client-build.json',{signal:c.signal,cache:'no-store'});if(res.ok)meta=C.client(await res.json());}catch(_){} }
      if(account!==token()||id!==sequence||app.classList.contains('hidden'))return;model=out.data;client=meta;fresh=true;message(`检查完成 · ${C.time(model.server_time)}。这里只确认当前服务的诊断接口可达。`);
    }catch(error){if(account===token()&&id===sequence)message(error.name==='AbortError'?'检查已取消或超时，已有诊断保留为历史记录。':error.message+' 已有记录不代表当前状态。');}
    finally{clearTimeout(timer);if(id===sequence){busy=false;controller=null;render();}}
  }
  function open(){if(!sync())return;opener=document.activeElement;$('dialog').showModal();render();check();}
  trigger.addEventListener('click',open);$('close').addEventListener('click',()=>$('dialog').close());$('dialog').addEventListener('click',event=>{if(event.target===$('dialog'))$('dialog').close();});
  $('dialog').addEventListener('close',()=>{sequence++;controller?.abort();controller=null;busy=false;$('refresh').disabled=false;if(opener?.isConnected)opener.focus({preventScroll:true});});$('refresh').addEventListener('click',check);
  $('connection').addEventListener('click',()=>{$('dialog').close();window.DaynestMobile?.openConnectionSettings?.();});
  $('export').addEventListener('click',async()=>{
    if(!sync()||!model||exporting)return;const account=owner;exporting=true;render();
    try{const report=C.report(model,client||{kind:window.DaynestMobile?.native?'android':'web'},fresh),blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),name='daynest-diagnostics-'+new Date().toISOString().slice(0,10)+'.json';
      if(window.DaynestMobile?.saveBlob)await window.DaynestMobile.saveBlob(blob,name,account);else{const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
      if(account===token())message('脱敏诊断已交给保存窗口或浏览器下载，请确认保存位置。');
    }catch(error){if(account===token())message(error.code==='CANCELLED'||error.name==='AbortError'?'已取消诊断导出。':'诊断导出未完成，请重试。');}
    finally{exporting=false;render();}
  });
  document.getElementById('logout').addEventListener('click',reset);document.addEventListener('daynest:account-ready',sync);window.addEventListener('storage',event=>{if(event.key==='studyflow.token'||event.key===null)sync();});new MutationObserver(sync).observe(app,{attributes:true,attributeFilter:['class']});sync();
})();
