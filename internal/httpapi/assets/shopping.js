(() => {
  'use strict';
  const $=id=>document.getElementById('shopping-'+id), token=()=>localStorage.getItem('studyflow.token')||'';
  const state={owner:'',items:[],loaded:false,busy:false,loading:false,seq:0,view:'pending',limit:40,editing:null,baseline:'',undo:null,ids:new Map()};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key=name=>name.trim().replace(/\s+/g,' ').toLowerCase();
  const uuid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const body=item=>Object.fromEntries(['name','quantity','note','frequent','purchased','deleted','revision'].map(field=>[field,item[field]]));
  function message(text,error=false){for(const id of ['status','home-status']){$(id).textContent=text;$(id).classList.toggle('shopping-error',error);}}
  function sync(){
    const owner=token();if(owner===state.owner)return owner;
    Object.assign(state,{owner,items:[],loaded:false,busy:false,loading:false,seq:state.seq+1,editing:null,baseline:'',undo:null,limit:40,view:'pending'});state.ids.clear();
    $('dialog').close();$('edit-form').reset();$('input').value='';$('home-input').value='';$('edit-status').textContent='';message('');setMode(false);lock(false);render();return owner;
  }
  async function api(path='',data){
    const owner=token(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/v1/shopping'+path,{method:data?'PUT':'GET',headers:{Authorization:'Bearer '+owner,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:controller.signal});
      let payload;try{payload=await response.json();}catch(error){if(error.name!=='SyntaxError')throw error;}
      if(owner!==token())throw new Error('账号已切换，已忽略旧响应。');
      if(response.status===404||response.status===405)throw new Error('购物接口不可用，请停止旧 Go 服务，再运行 go run ./cmd/api 并刷新页面。');
      if(response.status===401)throw new Error('登录已过期，请重新登录。');
      if(!response.ok)throw new Error(payload?.error?.message||`购物请求失败（HTTP ${response.status}）。`);
      if(!payload||typeof payload!=='object'||!('data' in payload))throw new Error('购物服务返回格式无效。');return payload.data;
    }catch(error){if(error.name==='AbortError')throw new Error('请求超时，输入已保留；结果未知时请原样重试。');throw error;}
    finally{clearTimeout(timer);}
  }
  async function load(){
    const owner=sync();if(!owner||state.busy)return;
    const seq=++state.seq;state.loading=true;render();
    try{const rows=await api();if(owner!==token()||seq!==state.seq)return;if(!Array.isArray(rows))throw new Error('购物列表格式无效。');state.items=rows;state.loaded=true;message('清单已同步。');}
    catch(error){if(owner===token()&&seq===state.seq)message(error.message+(state.loaded?' 显示的是上次数据。':''),true);}
    finally{if(owner===token()&&seq===state.seq){state.loading=false;render();}}
  }
  async function write(item){
    const row=await api('/'+encodeURIComponent(item.id),body(item));
    if(!row||row.id!==item.id||!Number.isInteger(row.revision))throw new Error('保存响应无效，请原样重试。');
    state.items=state.items.filter(old=>old.id!==row.id).concat(row);return row;
  }
  function parse(text){
    const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if(!lines.length)throw new Error('先写下一件想买的东西。');if(lines.length>30)throw new Error('一次最多添加 30 项，请分批添加。');
    return lines.map(raw=>{const match=raw.match(/^(.+?)\s+(\d+(?:\.\d+)?\s*[^\s]*)$/u);const name=match?match[1].trim():raw,quantity=match?match[2]:'';
      if([...name].length>80||[...quantity].length>30)throw new Error('名称最多 80 字，数量最多 30 字。');return {raw,name,quantity};});
  }
  function lock(locked){for(const id of ['add-form','home-form','edit-form'])$(id).querySelectorAll('input,textarea,button').forEach(el=>{el.disabled=locked;});}
  async function add(input){
    if(!sync()||state.busy||state.loading)return;
    if(!state.loaded){message('请先刷新并载入购物清单。',true);return;}
    let entries;try{entries=parse(input.value);}catch(error){message(error.message,true);return;}
    const owner=state.owner,original=input.value;state.busy=true;state.seq++;lock(true);render();let done=0,duplicates=0,failed=false;
    try{
      for(const entry of entries){
        const existing=state.items.find(row=>!row.deleted&&!row.purchased&&key(row.name)===key(entry.name));
        if(existing){state.ids.delete(key(entry.name));duplicates++;done++;continue;}
        const previous=state.items.filter(row=>!row.deleted&&row.purchased&&key(row.name)===key(entry.name)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at))[0];
        if(!state.ids.has(key(entry.name)))state.ids.set(key(entry.name),uuid());
        const item=previous?{...previous,purchased:false,quantity:entry.quantity||previous.quantity}:{id:state.ids.get(key(entry.name)),revision:0,name:entry.name,quantity:entry.quantity,note:'',purchased:false,deleted:false,frequent:false};
        await write(item);state.ids.delete(key(entry.name));done++;
      }
      message(duplicates?`已处理 ${done} 项，其中 ${duplicates} 项已在待购清单中，未重复添加。`:`已加入 ${done} 项，购物时记得带上清单。`);
    }catch(error){failed=true;if(owner===token())message(`已处理 ${done} 项；${error.message} 剩余输入已保留。`,true);}
    finally{if(owner===token()){if(input.value===original)input.value=failed?entries.slice(done).map(e=>e.raw).join('\n'):'';state.busy=false;lock(false);render();input.focus();}}
  }
  function render(){
    const items=state.items.filter(row=>!row.deleted),pending=items.filter(row=>!row.purchased),bought=items.filter(row=>row.purchased);
    $('home-count').textContent=state.loaded?`还有 ${pending.length} 件待买`:'清单待同步';
    $('pending').textContent=`待购买 ${pending.length}`;$('bought').textContent=`已买到 ${bought.length}`;
    $('pending').setAttribute('aria-pressed',String(state.view==='pending'));$('bought').setAttribute('aria-pressed',String(state.view==='bought'));
    const rows=(state.view==='pending'?pending:bought).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id));
    const disabled=state.busy||state.loading;
    $('list').innerHTML=rows.length?rows.slice(0,state.limit).map(row=>`<article class="shopping-row ${row.purchased?'is-bought':''}"><button type="button" class="shopping-tick" data-shopping="toggle" data-id="${esc(row.id)}" aria-label="${row.purchased?'撤销购买':'标记已买到'} ${esc(row.name)}" ${disabled?'disabled':''}>${row.purchased?'✓':''}</button><button class="shopping-detail" type="button" data-shopping="edit" data-id="${esc(row.id)}" ${disabled?'disabled':''}><b>${esc(row.name)}${row.frequent?' <span aria-label="常买">★</span>':''}</b><small>${esc([row.quantity,row.note].filter(Boolean).join(' · ')||'点击添加数量或备注')}</small></button>${row.purchased?`<button class="text-button shopping-store" type="button" data-shopping="store" data-id="${esc(row.id)}" ${disabled?'disabled':''}>存入物品管家</button>`:''}<button class="shopping-remove" type="button" data-shopping="delete" data-id="${esc(row.id)}" aria-label="移除 ${esc(row.name)}" ${disabled?'disabled':''}>×</button></article>`).join(''):`<div class="shopping-empty"><span aria-hidden="true">${state.view==='pending'?'✓':'◌'}</span><h4>${!state.loaded?'先连接你的清单':state.view==='pending'?'暂时没有要买的了':'买到的小事，会留在这里'}</h4><p>${!state.loaded?'请点击刷新；若接口不可用，需要重启新版服务。':'想到什么，随时写在上面。'}</p></div>`;
    $('more').hidden=rows.length<=state.limit;$('more').disabled=disabled;
    $('favorites').innerHTML=items.filter(row=>row.frequent).map(row=>{const exists=pending.some(p=>key(p.name)===key(row.name));return `<button type="button" data-shopping="repeat" data-id="${esc(row.id)}" ${disabled||exists?'disabled':''}>${esc(row.name)} <span>${exists?'已在清单':'＋'}</span></button>`;}).join('')||'<p>还没有常买物品。点击清单名称，就能设为常买。</p>';
    $('undo-bar').hidden=!state.undo;$('undo').disabled=disabled;$('undo-label').textContent=state.undo?.label||'';
    for(const id of ['add','home-add'])$(id).disabled=disabled||!state.loaded;
    $('refresh').disabled=disabled;
  }
  async function mutate(row,changes,label){
    if(state.busy||state.loading||state.owner!==token())return;
    const owner=state.owner;state.busy=true;state.seq++;render();
    try{const saved=await write({...row,...changes});if(label)state.undo={before:row,revision:saved.revision,label};message(label||'已更新清单。');return saved;}
    catch(error){if(owner===token()){message(error.message+' 请原样重试；版本冲突时先刷新。',true);$('edit-status').textContent=error.message;}return null;}
    finally{if(owner===token()){state.busy=false;render();}}
  }
  function draft(){return JSON.stringify({name:$('name').value,quantity:$('quantity').value,note:$('note').value,frequent:$('frequent').checked});}
  function edit(row){state.editing={...row};$('name').value=row.name;$('quantity').value=row.quantity;$('note').value=row.note;$('frequent').checked=row.frequent;state.baseline=draft();$('edit-status').textContent='';$('dialog').showModal();$('name').focus();}
  function close(){if(state.busy)return;if(state.editing&&state.baseline!==draft()&&!window.confirm('放弃这次未保存的修改？'))return;$('dialog').close();state.editing=null;}
  async function action(action,id){
    if(!sync()||state.busy||state.loading)return;
    const row=state.items.find(item=>item.id===id&&!item.deleted);if(!row)return;
    if(action==='edit'){edit(row);return;}
    if(action==='store'){showTab(false);document.dispatchEvent(new CustomEvent('daynest:shopping-store',{detail:row}));return;}
    if(action==='toggle')await mutate(row,{purchased:!row.purchased},row.purchased?'已移回待购买。':'已标记买到。');
    if(action==='delete')await mutate(row,{deleted:true},'已从清单移除。');
    if(action==='repeat')await mutate(row,{purchased:false},'已加入待购买。');
  }
  function showTab(shopping){$('space').hidden=!shopping;document.getElementById('inventory-collection').hidden=shopping;
    for(const [id,active] of [['shopping-tab',shopping],['collection-tab',!shopping]]){const el=document.getElementById(id);el.setAttribute('aria-selected',String(active));el.tabIndex=active?0:-1;}}
  function setMode(active){$('space').classList.toggle('shopping-mode',active);$('mode').setAttribute('aria-pressed',String(active));$('mode').textContent=active?'退出购物模式':'购物模式';}
  function bind(){
    $('add-form').addEventListener('submit',e=>{e.preventDefault();add($('input'));});$('home-form').addEventListener('submit',e=>{e.preventDefault();add($('home-input'));});
    $('input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();add($('input'));}});
    $('home-open').addEventListener('click',()=>{document.querySelector('[data-view="inventory"]').click();showTab(true);});
    $('tab').addEventListener('click',()=>{showTab(true);load();});document.getElementById('collection-tab').addEventListener('click',()=>showTab(false));
    for(const id of ['shopping-tab','collection-tab'])document.getElementById(id).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'collection-tab':e.key==='End'?'shopping-tab':id==='shopping-tab'?'collection-tab':'shopping-tab';document.getElementById(next).click();document.getElementById(next).focus();}});
    document.querySelector('[data-view="inventory"]').addEventListener('click',load);
    for(const view of ['pending','bought'])$(view).addEventListener('click',()=>{state.view=view;state.limit=40;render();});
    $('mode').addEventListener('click',()=>setMode($('mode').getAttribute('aria-pressed')!=='true'));$('refresh').addEventListener('click',load);$('more').addEventListener('click',()=>{state.limit+=40;render();});
    $('space').addEventListener('click',e=>{const btn=e.target.closest('[data-shopping]');if(btn)action(btn.dataset.shopping,btn.dataset.id);});
    $('undo').addEventListener('click',async()=>{const undo=state.undo;if(!undo||state.busy)return;const saved=await mutate({...undo.before,revision:undo.revision},{},null);if(saved){state.undo=null;message('已撤销。');render();}});
    $('edit-form').addEventListener('submit',async e=>{e.preventDefault();if(!state.editing||state.busy)return;const owner=state.owner,changes=JSON.parse(draft());lock(true);try{const saved=await mutate(state.editing,changes,null);if(saved){state.editing=null;$('dialog').close();}}finally{if(owner===token()){lock(false);render();}}});
    $('close').addEventListener('click',close);$('dialog').addEventListener('cancel',e=>{e.preventDefault();close();});
    document.addEventListener('daynest:account-ready',load);document.getElementById('logout').addEventListener('click',()=>{state.owner='invalid';sync();});
    window.addEventListener('storage',e=>{if(e.key==='studyflow.token'){sync();if(token())load();}});
    window.addEventListener('beforeunload',e=>{if($('input').value.trim()||$('home-input').value.trim()||(state.editing&&draft()!==state.baseline)){e.preventDefault();e.returnValue='';}});
    if(token())load();else render();
  }
  bind();
})();
