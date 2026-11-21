// Account settings only. The food decision page owns the recommendation UI.
(() => {
  'use strict';
  const panel=document.getElementById('panel-meals');if(!panel)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dialog=document.createElement('dialog');dialog.id='meal-ai-dialog';dialog.className='meal-dialog food-ai-settings';dialog.setAttribute('aria-labelledby','meal-ai-title');
  dialog.innerHTML=`<header><h3 id="meal-ai-title">AI 推荐设置</h3><button id="meal-ai-close" type="button" aria-label="关闭 AI 设置">×</button></header>
    <p>描述预算、口味和现在的情况，AI 会推荐这顿吃什么。</p>
    <div class="food-ai-state"><strong id="meal-ai-account">正在读取 AI 配置…</strong><p id="meal-ai-connection"></p></div>
    <div class="food-ai-buttons"><button id="meal-ai-connect" type="button" hidden>Continue with ChatGPT</button><button id="meal-ai-disconnect" type="button" hidden>断开连接</button><button id="meal-ai-check" type="button">刷新配置状态</button></div>
    <div id="meal-ai-model-settings" hidden><label>账号可用模型<select id="meal-ai-model"><option value="">连接后加载模型</option></select></label><button id="meal-ai-models" type="button">↻ 刷新模型</button></div>
    <p id="meal-ai-status" role="status" aria-live="polite"></p><p class="food-subtle">发送本次的用餐需求、偏好与近期推荐的食物名称。AI 请求可能消耗所选服务的账号额度。</p>`;
  panel.append(dialog);
  const $=id=>document.getElementById('meal-ai-'+id),token=()=>localStorage.getItem('studyflow.token')||'';
  let owner=token(),seq=0,provider='',connected=false,signedIn=false,pending=false,busy=false,checking=false,poll=null;const controllers=new Set();
  function message(text,error=false){$('status').textContent=text;$('status').classList.toggle('meal-error',error);}
  function ready(){return connected&&!!$('model').value&&!pending&&!busy;}
  function controls(){
    const openAI=provider==='chatgpt';
    $('connect').hidden=!openAI;
    $('connect').disabled=busy||pending||connected;
    $('disconnect').hidden=!openAI||(!signedIn&&!connected&&!pending);
    $('model-settings').hidden=!openAI;
    $('models').disabled=busy||!connected;
    $('model').disabled=busy;
    $('close').disabled=busy;
    document.dispatchEvent(new CustomEvent('daynest:meal-ai-status'));
  }
  function stopPoll(){if(poll)clearInterval(poll);poll=null;}
  function cancel(){for(const c of controllers)c.abort();controllers.clear();}
  function reset(){seq++;owner=token();cancel();stopPoll();provider='';connected=false;signedIn=false;pending=false;busy=false;checking=false;dialog.close();$('model').innerHTML='<option value="">连接后加载模型</option>';$('account').textContent='正在读取 AI 配置…';$('connection').textContent='';message('');controls();}
  function sync(){if(owner!==token())reset();return !!owner;}
  async function api(path,method='GET',body){const account=owner,c=new AbortController(),timer=setTimeout(()=>c.abort(),100000);controllers.add(c);try{const response=await fetch('/api/v1/ai/'+path,{method,headers:{Authorization:'Bearer '+account,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:c.signal,cache:'no-store'});const result=await response.json().catch(()=>null);if(account!==token())throw Error('账号已切换');if(!response.ok)throw Error(result?.error?.message||`请求失败（${response.status}），请确认已重启新版服务。`);if(!result||!('data'in result))throw Error('响应格式异常');return result.data;}catch(e){if(e.name==='AbortError')throw Error('请求已取消或超时；未自动重试，不会自动改用其他计费方式。');throw e;}finally{clearTimeout(timer);controllers.delete(c);}}
  async function loadModels(){const account=owner,version=seq,list=await api('chatgpt/models');if(account!==token()||version!==seq)return;if(!Array.isArray(list)||!list.length||!list.every(m=>typeof m.slug==='string'&&typeof m.display_name==='string'))throw Error('账号未返回有效模型列表');const old=$('model').value;$('model').innerHTML=list.map(m=>`<option value="${esc(m.slug)}">${esc(m.display_name)}</option>`).join('');if(list.some(m=>m.slug===old))$('model').value=old;controls();}
  async function check(){
    if(!sync()||checking||busy)return;
    checking=true;
    const account=owner,version=seq;
    try{
      const status=await api('meals/status');
      if(account!==token()||version!==seq)return;
      if(status.provider!=='bigmodel'&&status.provider!=='chatgpt')throw Error('AI 服务配置无法识别');
      const previousProvider=provider,wasConnected=connected;
      provider=status.provider;
      connected=!!status.connected;
      signedIn=!!status.signed_in;
      pending=!!status.pending;
      if(!pending)stopPoll();
      $('connection').textContent=status.message||'';
      if(provider==='bigmodel'){
        if(typeof status.model!=='string'||!status.model)throw Error('本机智谱模型配置无效');
        $('model').innerHTML=`<option value="${esc(status.model)}">${esc(status.model)}</option>`;
        $('model').value=status.model;
        $('account').textContent=`智谱 GLM · ${status.model}`;
        message('关闭设置后，选择「AI 按情况推荐」。');
      }else{
        $('account').textContent=connected?`已连接 · ${status.email||'ChatGPT'}`:pending?'等待浏览器授权…':signedIn?'已登录 · 尚无调用权限':'尚未连接 ChatGPT';
        if(connected&&(!wasConnected||previousProvider!==provider||!$('model').value)){
          await loadModels();
          if(account!==token()||version!==seq)return;
          message('关闭设置后，选择「AI 按情况推荐」。');
        }
      }
      controls();
    }catch(e){
      if(account===token()&&version===seq){
        connected=false;
        stopPoll();
        message(e.message,true);
        controls();
      }
    }finally{
      if(version===seq)checking=false;
    }
  }
  async function run(fn){if(!sync()||busy)return;busy=true;controls();const account=owner,version=seq;try{await fn(account,version);}catch(e){if(account===token()&&version===seq)message(e.message,true);}finally{if(account===token()&&version===seq){busy=false;controls();}}}
  $('open').addEventListener('click',()=>{if(!sync())return;dialog.showModal();check();});$('close').addEventListener('click',()=>{if(!busy){dialog.close();stopPoll();}});dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();else stopPoll();});$('check').addEventListener('click',check);$('model').addEventListener('change',controls);$('models').addEventListener('click',()=>run(async()=>{await loadModels();message('模型列表已更新。');}));
  $('connect').addEventListener('click',()=>{if(!sync()||busy||pending)return;const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;run(async(account,version)=>{try{const result=await api('chatgpt/connect','POST');if(account!==token()||version!==seq){popup?.close();return;}const u=new URL(result.authorization_url);if(u.origin!=='https://auth.openai.com'||u.pathname!=='/api/accounts/authorize')throw Error('授权地址异常');pending=true;if(popup){popup.location.href=u.href;message('请在新窗口授权，状态将自动更新。');}else{const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='打开 ChatGPT 授权页';$('status').replaceChildren(a);}stopPoll();poll=setInterval(check,2500);}catch(e){popup?.close();throw e;}});});
  $('disconnect').addEventListener('click',async()=>{if(!sync()||!confirm('断开 ChatGPT 连接并取消正在进行的请求？'))return;const account=owner;seq++;checking=false;cancel();stopPoll();connected=false;signedIn=false;pending=false;busy=true;controls();try{const result=await api('chatgpt/disconnect','POST');if(account!==token())return;message(result.message);$('account').textContent='尚未连接 ChatGPT';$('connection').textContent=result.message;$('model').innerHTML='<option value="">连接后加载模型</option>';}catch(e){if(account===token())message(e.message+' 请检查状态确认是否已断开。',true);}finally{if(account===token()){busy=false;controls();}}});
  window.DaynestMealAI=Object.freeze({ready,cancel,async recommend(p){if(!sync()||!ready())throw Error('请先在 AI 连接设置中授权并选择可用模型。');const account=owner,version=seq;busy=true;controls();try{const result=await api('meals/recommend','POST',{model:$('model').value,prompt:p.prompt||'请根据这些条件推荐这顿吃什么，不要菜谱。',meal:p.meal,channel:p.channel,budget:p.budget,flavor:p.flavor,hunger:p.hunger,vegetarian:p.vegetarian,exclude:p.exclude,recent:p.recent});if(account!==token()||version!==seq)throw Error('连接状态已变更');return result;}finally{if(account===token()&&version===seq){busy=false;controls();}}}});
  document.getElementById('logout').addEventListener('click',reset);window.addEventListener('storage',e=>{if(e.key==='studyflow.token')sync();});new MutationObserver(sync).observe(document.getElementById('app-view'),{attributes:true,attributeFilter:['class']});reset();
})();
