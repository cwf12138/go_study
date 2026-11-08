(() => {
  'use strict';
  const C=window.DaynestSaveCore,H=window.DaynestHTTP;if(!C||!H)return;
  const ledger=C.create(),host=document.querySelector('.app-sync-bar');if(!host)return;
  const button=document.createElement('button');button.id='save-status-open';button.type='button';button.className='save-status-chip';button.setAttribute('aria-haspopup','dialog');host.prepend(button);
  const dialog=document.createElement('dialog');dialog.id='save-status-dialog';dialog.className='save-status-dialog';dialog.setAttribute('aria-labelledby','save-status-title');
  dialog.innerHTML=`<header><div><p>YOUR CHANGES, ACCOUNTED FOR</p><h2 id="save-status-title">保存状态</h2></div><button type="button" data-save-close aria-label="关闭保存状态">×</button></header><div class="save-status-body"><p class="save-status-intro">提交成功后，电脑服务会定期写出数据快照。这里分别显示这两个步骤。</p><div class="save-status-summary" role="status" aria-live="polite"></div><div class="save-status-tools"><button type="button" data-save-check>检查快照状态</button><button type="button" class="quiet" data-save-diagnostics>打开设置与诊断 ↗</button></div><ol class="save-status-list"></ol><div class="save-status-foot"><p>本轮覆盖备忘录、待办与日程。仅记录当前页面的操作状态，刷新后清空；原有草稿与待核对提交保留各自规则。“已纳入成功快照”是本次运行观察到的历史结果，不等同于完整备份，也不代表其他未提交文字已保存。</p><button type="button" class="quiet" data-save-clear>清空本页状态记录</button><p class="save-status-clear-note" role="status"></p></div></div>`;
  document.body.append(dialog);
  let timer=null,busy=false,generation=0,automaticUntil=0,message='',returnFocus=null;
  const $=selector=>dialog.querySelector(selector),date=value=>new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function authorized(){const context=ledger.context();return context&&H.current(context)&&!!context.userID&&!H.authExpired();}
  function canCheck(){return authorized()&&navigator.onLine!==false&&!document.hidden;}
  function stop(){if(timer!==null)clearTimeout(timer);timer=null;}
  function schedule(){stop();if(!busy&&canCheck()&&ledger.pending().length&&Date.now()<automaticUntil)timer=setTimeout(()=>check(false),3000);}
  function inline(){for(const el of document.querySelectorAll('[data-save-topic]')){const row=ledger.latest(el.dataset.saveTopic,el.dataset.saveResource);el.hidden=!row;el.textContent=row?'上次提交：'+C.labels[row.state]:'';if(row){el.dataset.state=row.state;el.title='仅表示该记录在本页的上次提交；当前输入如有新修改，仍需保存。';}}}
  function render(){
    const summary=ledger.summary();button.dataset.state=summary.state;button.textContent=summary.label+(summary.total?' · '+summary.total:'');
    const paused=!authorized()&&summary.total?'登录状态已变化，已暂停检查。':navigator.onLine===false?'当前离线；不会重发保存请求。':document.hidden?'页面在后台，检查已暂停。':'';
    $('.save-status-summary').textContent=(message||paused||(summary.total?summary.label+'。':'还没有本页的保存操作。读取已有内容不会产生保存凭据。'))+(summary.overflow?`另有 ${summary.overflow} 次未完成确认的状态已超出显示范围，请回原记录核对。`:'');
    $('[data-save-check]').disabled=busy||!canCheck()||!ledger.pending().length;
    $('[data-save-check]').textContent=busy?'正在检查…':'检查快照状态';
    $('[data-save-clear]').disabled=busy||!!summary.counts.sending;
    const list=$('.save-status-list');list.replaceChildren();
    for(const row of ledger.rows().reverse()){
      const item=document.createElement('li'),icon=document.createElement('span'),content=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p'),time=document.createElement('time');
      item.dataset.state=row.state;icon.className='save-status-mark';icon.textContent=row.state==='snapshot_written'?'✓':row.state==='sending'?'↑':row.state==='needs_review'||row.state==='snapshot_failed'?'!':'·';
      title.textContent=row.label+' · '+({POST:'提交',PATCH:'修改',PUT:'修改',DELETE:'移除'}[row.method]||'提交');
      detail.textContent=C.labels[row.state]+(row.snapshotAt?' · '+date(row.snapshotAt)+' 快照覆盖':row.checkError?' · 暂时无法检查，请稍后手动核对':'');
      time.textContent=date(row.startedAt);time.dateTime=new Date(row.startedAt).toISOString();content.append(title,detail);item.append(icon,content,time);list.append(item);
    }inline();
  }
  async function check(manual){
    if(busy||!canCheck())return;const context=ledger.context(),turn=generation;
    const tickets=[...new Set(ledger.pending().map(row=>row.receipt))];if(!tickets.length)return;
    busy=true;message='';render();
    try{
      for(let index=0;index<tickets.length;index+=20){
        const batch=tickets.slice(index,index+20),result=await H.json('/api/v1/system/write-status',{method:'POST',body:{receipts:batch},context,timeoutMs:10000,validate(data){
          if(data?.schema_version!==1||data.checking_triggers_write!==false||!Array.isArray(data.receipts)||data.receipts.length!==batch.length||data.receipts.some((row,i)=>row?.receipt!==batch[i]||!['waiting_snapshot','snapshot_written','snapshot_failed','unverifiable'].includes(row.state)))throw Error();
        }});
        if(turn!==generation||!H.current(context))return;
        ledger.apply(context,result.receipts);
      }
      if(manual)message=ledger.pending().length?'检查完成，尚未确认的操作仍保留原状态。':ledger.summary().counts.needs_review?'检查完成。有结果需核对的操作，请回原记录确认。':'检查完成，可查询的凭据均已确认。无凭据的操作仍保留原状态。';
    }catch(error){if(turn===generation&&H.current(context)){ledger.failed(context);message=error.status===404?'当前服务不支持快照凭据检查，请重启新版 Go 服务。':H.authExpired()?'登录已过期，已暂停检查。未提交文字仍在原页面。':'暂时无法检查快照。已保留原状态，请稍后检查；不会重发业务操作。';}}
    finally{if(turn===generation){busy=false;render();schedule();}}
  }
  function reset(){generation++;stop();busy=false;message='';automaticUntil=0;ledger.reset();if(dialog.open)dialog.close();render();}
  function open(){returnFocus=document.activeElement;message='';render();if(!dialog.open)dialog.showModal();}
  function close(){dialog.close();returnFocus?.focus?.();}
  button.addEventListener('click',open);
  $('[data-save-close]').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('[data-save-check]').addEventListener('click',()=>check(true));
  $('[data-save-clear]').addEventListener('click',()=>{
    const summary=ledger.summary();if(summary.counts.sending||busy)return;
    if((summary.overflow||ledger.rows().some(row=>!['snapshot_written','rejected'].includes(row.state)))&&!confirm('有尚未确认的状态。仅清空本页状态追踪，不撤销提交，也不会清除原页面的草稿或待核对记录。确定清空？'))return;
    ledger.reset(ledger.context());message='本页状态记录已清空；业务记录和草稿未改变。';stop();render();
  });
  $('[data-save-diagnostics]').addEventListener('click',()=>{close();document.getElementById('diagnostics-open')?.click();});
  document.addEventListener('visibilitychange',()=>{render();schedule();});window.addEventListener('online',()=>{message='';render();schedule();});window.addEventListener('offline',()=>{stop();render();});
  document.addEventListener('daynest:auth-expired',()=>{stop();render();});
  document.addEventListener('daynest:account-ready',()=>{if(ledger.context()&&!H.current(ledger.context()))reset();});
  window.addEventListener('storage',event=>{if((!event.key||event.key==='studyflow.token')&&ledger.context()&&!H.current(ledger.context()))reset();});
  const app=document.getElementById('app-view');if(app)new MutationObserver(()=>{if(app.classList.contains('hidden'))reset();}).observe(app,{attributes:true,attributeFilter:['class']});
  window.DaynestSaveStatus={observe(event){if(!H.current(event.context))return;if(ledger.observe(event)){message='';automaticUntil=Date.now()+120000;render();schedule();}},bind(element,topic,resource){if(!element)return;element.dataset.saveTopic=topic;element.dataset.saveResource=resource||'';inline();},open};
  render();
})();
