(() => {
  'use strict';
  const panel=document.getElementById('panel-meals'),A=window.DaynestMealActions,C=window.DaynestMeals;
  if(!panel||!A||!C)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=document.createElement('button');button.id='meal-ai-open';button.type='button';button.textContent='✦ AI 私人厨房';panel.querySelector('.meal-hero-actions').prepend(button);
  const dialog=document.createElement('dialog');dialog.id='meal-ai-dialog';dialog.className='meal-dialog meal-ai';dialog.setAttribute('aria-labelledby','meal-ai-title');
  dialog.innerHTML=`<header><div><p class="meal-eyebrow">YOUR LITTLE AI KITCHEN</p><h3 id="meal-ai-title">把晚餐的难题，交给我。</h3><p class="meal-muted">用自己的 ChatGPT Plus 授权，让菜单更懂你的日常。</p></div><button id="meal-ai-close" type="button" aria-label="关闭 AI 私人厨房">×</button></header>
    <div class="meal-ai-account"><div><strong id="meal-ai-account">尚未连接 ChatGPT</strong><p id="meal-ai-connection">授权凭据仅在本机服务内存中保存，服务重启后需重新连接。</p></div><div><button id="meal-ai-connect" type="button">Continue with ChatGPT</button><button id="meal-ai-disconnect" type="button" hidden>断开连接</button><button id="meal-ai-check" type="button">检查状态</button></div></div>
    <div class="meal-ai-layout"><form id="meal-ai-form"><label>今天想怎么吃？<textarea id="meal-ai-prompt" rows="7" maxlength="1200" required placeholder="例如：两个人吃晚饭，有鸡蛋、番茄和米饭，想吃清淡一点，不吃花生。请推荐容易做的家常搭配。"></textarea></label><div class="meal-form-row"><label>几人份<select id="meal-ai-people"><option value="1">1 人</option><option value="2">2 人</option><option value="3">3 人</option><option value="4">4 人</option><option value="5">5 人</option><option value="6">6 人</option></select></label><label>总耗时上限<select id="meal-ai-minutes"><option value="20">20 分钟</option><option value="30" selected>30 分钟</option><option value="60">60 分钟</option><option value="90">90 分钟</option><option value="150">150 分钟</option></select></label></div><label>账号可用模型<select id="meal-ai-model" required><option value="">连接后加载模型</option></select></label><button id="meal-ai-models" type="button">↻ 刷新模型</button><p class="meal-ai-privacy">仅发送这次填写的需求、人数与耗时，不读取日记、备忘录或其他私人数据。请求会消耗你的 ChatGPT 可用额度。</p><button id="meal-ai-generate" type="submit" class="meal-primary">✦ 为我搭配这一餐</button></form>
    <section aria-label="AI 推荐结果"><p id="meal-ai-status" role="status" aria-live="polite"></p><div id="meal-ai-results"><div class="meal-discover-empty"><span aria-hidden="true">✦</span><h4>一餐，刚好适合你。</h4><p>告诉我已有食材、口味和忌口。<br>菜单、用量和做法一起准备好。</p></div></div><div id="meal-ai-actions" hidden><div class="meal-form-row"><label>安排日期<input id="meal-ai-date" type="date" min="2000-01-01" max="2100-12-31"></label><label>餐次<select id="meal-ai-slot"><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner" selected>晚餐</option></select></label></div><div class="meal-discover-action-buttons"><button id="meal-ai-save" type="button">收藏菜谱</button><button id="meal-ai-arrange" type="button">加入菜单</button><button id="meal-ai-shop" type="button">准备采购清单</button></div></div><p class="meal-ai-safety">AI 生成内容可能有误。请核对食材、用量、忌口及调味品标签，注意生熟分开和充分加热；不保证无过敏原，也不提供医疗或精确营养建议。未连接或额度不足时，可继续使用原有本地推荐。</p></section></div>`;
  panel.append(dialog);const $=id=>document.getElementById('meal-ai-'+id),token=()=>localStorage.getItem('studyflow.token')||'';
  let owner=token(),seq=0,working=false,connected=false,signedIn=false,pending=false,rows=[],poll=null,controllers=new Set();
  function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('meal-error',error);}
  function stopPoll(){if(poll)clearInterval(poll);poll=null;}
  function reset(){seq++;owner=token();for(const c of controllers)c.abort();controllers.clear();stopPoll();rows=[];working=false;connected=false;signedIn=false;pending=false;dialog.close();$('form').reset();$('model').innerHTML='<option value="">连接后加载模型</option>';$('date').value=C.today();$('results').innerHTML='';$('account').textContent='尚未连接 ChatGPT';$('connection').textContent='授权凭据仅在本机服务内存中保存，服务重启后需重新连接。';status('');controls();}
  function sync(){if(owner!==token())reset();return !!owner;}
  function controls(){
    $('connect').disabled=working||pending||connected;$('disconnect').hidden=!signedIn&&!connected&&!pending;$('models').disabled=working||!connected;
    for(const id of ['generate','prompt','model','minutes','people'])$(id).disabled=working||(id==='generate'&&!connected);
    for(const id of ['save','arrange','shop'])$(id).disabled=working||!rows.length;
    $('actions').hidden=!rows.length;$('generate').textContent=working?'正在准备，请稍候…':'✦ 为我搭配这一餐';$('close').disabled=working;
  }
  async function api(path,method='GET',body){
    const account=owner,c=new AbortController();controllers.add(c);const timer=setTimeout(()=>c.abort(),100000);
    try{const res=await fetch('/api/v1/ai/'+path,{method,headers:{Authorization:'Bearer '+account,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:c.signal,cache:'no-store'});const data=await res.json().catch(()=>null);if(account!==token())throw Error('账号已切换');if(!res.ok)throw Error(data?.error?.message||`请求失败（${res.status}），请确认已重启新版 Go 服务。`);if(!data||!('data'in data))throw Error('响应格式异常');return data.data;}catch(e){if(e.name==='AbortError')throw Error('请求已取消或超时；不会自动重试，以避免重复消耗额度。');throw e;}finally{clearTimeout(timer);controllers.delete(c);}
  }
  async function loadModels(){const account=owner,version=seq;const list=await api('chatgpt/models');if(account!==token()||version!==seq)return;if(!Array.isArray(list)||!list.length)throw Error('账号未返回可用模型');const old=$('model').value;$('model').innerHTML=list.map(m=>`<option value="${esc(m.slug)}">${esc(m.display_name||m.slug)}</option>`).join('');if(list.some(m=>m.slug===old))$('model').value=old;}
  let checking=false;
  async function check(){if(!sync()||checking)return;checking=true;const account=owner,version=seq;
    try{const s=await api('chatgpt');if(account!==token()||version!==seq)return;const was=connected;connected=!!s.connected;signedIn=!!s.signed_in;pending=!!s.pending;$('account').textContent=connected?`已连接 · ${s.email||'ChatGPT 账号'}`:pending?'等待浏览器授权…':signedIn?'已登录 · 尚无 Plus 调用权限':'尚未连接 ChatGPT';$('connection').textContent=s.message||'凭据仅在本机服务内存中保存；服务重启后重新登录。';if(!pending)stopPoll();if(connected&&!was){await loadModels();if(account!==token()||version!==seq)return;status('已连接。选择模型，描述今天的用餐需求。');}controls();}
    catch(e){if(account===token()&&version===seq){stopPoll();status(e.message,true);}}
    finally{checking=false;}
  }
  async function run(fn){if(!sync()||working)return;working=true;controls();const account=owner,version=seq;try{await fn(account,version);}catch(e){if(account===token()&&version===seq)status(e.message,true);}finally{if(account===token()&&version===seq){working=false;controls();}}}
  $('open').addEventListener('click',()=>{if(!sync())return;dialog.showModal();check();});
  $('connect').addEventListener('click',()=>{
    // Open synchronously so popup blockers do not suppress the consent window.
    const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;
    run(async(account,version)=>{try{const result=await api('chatgpt/connect','POST');if(account!==token()||version!==seq){popup?.close();return;}const u=new URL(result.authorization_url);if(u.origin!=='https://auth.openai.com'||u.pathname!=='/api/accounts/authorize')throw Error('授权地址不正确');pending=true;if(popup)popup.location.href=u.href;else{const link=document.createElement('a');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='点击这里打开 ChatGPT 授权页';$('status').replaceChildren(link);}if(popup)status('请在新窗口完成授权，连接状态会自动更新。');stopPoll();poll=setInterval(check,2500);check();}catch(e){popup?.close();throw e;}});
  });
  $('check').addEventListener('click',check);$('models').addEventListener('click',()=>run(async()=>{await loadModels();status('模型列表已更新。');}));
  $('disconnect').addEventListener('click',async()=>{if(!sync()||!confirm('断开 ChatGPT 授权连接？正在进行的 AI 请求也会取消。'))return;const account=owner;seq++;for(const c of controllers)c.abort();controllers.clear();stopPoll();working=false;rows=[];connected=false;signedIn=false;pending=false;controls();try{const result=await api('chatgpt/disconnect','POST');if(account===token()){status(result.message);$('account').textContent='尚未连接 ChatGPT';$('connection').textContent=result.message;$('model').innerHTML='<option value="">连接后加载模型</option>';$('results').innerHTML='';}}catch(e){if(account===token())status(e.message+' 请点击检查状态确认后端连接。',true);}});
  $('form').addEventListener('submit',e=>{e.preventDefault();run(async(account,version)=>{
    const request={model:$('model').value,prompt:$('prompt').value.trim(),people:Number($('people').value),minutes:Number($('minutes').value)};if(!request.model||!request.prompt)throw Error('请选择模型并描述用餐需求。');rows=[];controls();status('AI 正在搭配菜单并整理做法，通常需要一些时间…');
    const answer=await api('meals/recommend','POST',request);if(account!==token()||version!==seq)return;if(!Array.isArray(answer.recipes))throw Error('菜单响应格式异常，请重试。');rows=answer.recipes;status(answer.summary);
    $('results').innerHTML=rows.map(r=>`<article class="meal-discover-card"><div class="meal-discover-card-heading"><span aria-hidden="true">🍲</span><div><h4>${esc(r.title)}</h4><p>${r.minutes} 分钟 · ${r.servings} 人份 · AI 生成</p></div></div><details open><summary>食材与做法</summary><div class="meal-discover-ingredients">${r.ingredients.map(i=>`<span>${esc(i.name)} <b>${esc(i.quantity)}</b></span>`).join('')}</div><ol>${r.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol><p>${esc(r.note)}</p></details></article>`).join('')||'<p>没有符合条件的菜单，请调整需求后再试。</p>';
  });});
  for(const kind of ['save','arrange','shop'])$(kind).addEventListener('click',()=>run(async(account,version)=>{
    if(!rows.length)return;if(!A.ready())throw Error('请先关闭窗口同步厨房，或处理待确认的保存请求。');const day=$('date').value,slot=$('slot').value;if(kind==='arrange'&&!window.DaynestMealDiscovery.validDay(day))throw Error('请选择有效安排日期。');
    const snapshot=JSON.parse(JSON.stringify(rows));const saved=await A.prepare(snapshot);if(account!==token()||version!==seq)return;if(!saved)throw Error('尚未全部保存。已保存部分会保留，请关闭窗口处理恢复栏后重试。');
    if(kind==='arrange'){if(!await A.arrange(saved,day,slot))throw Error('安排未全部完成，请处理恢复栏后重试。');if(account!==token()||version!==seq)return;dialog.close();}
    else if(kind==='shop'){dialog.close();A.shop(saved);}else status('菜谱已收藏，可在我的菜谱中修改。重复收藏同一版本不会新增。');
  }));
  function invalidate(){if(working)return;rows=[];$('results').innerHTML='';status('需求已变更，请重新推荐。');controls();}
  $('prompt').addEventListener('input',invalidate);for(const id of ['people','minutes','model'])$(id).addEventListener('change',invalidate);
  $('close').addEventListener('click',()=>{if(!working){dialog.close();stopPoll();}});dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();else stopPoll();});
  document.getElementById('logout').addEventListener('click',reset);window.addEventListener('storage',e=>{if(e.key==='studyflow.token')sync();});new MutationObserver(sync).observe(document.getElementById('app-view'),{attributes:true,attributeFilter:['class']});reset();
})();
