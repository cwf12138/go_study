(() => {
  'use strict';
  const $ = id => document.getElementById(`inventory-${id}`);
  const token = () => localStorage.getItem('studyflow.token') || '';
  const state = { token: '', items: [], loaded: false, busy: false, loading: false, request: 0, page: 1, editing: null, baseline: '' };
  const fields = { name:'name', category:'edit-category', location:'location', quantity:'quantity', price:'price', purchased_on:'purchased', warranty_until:'warranty', expires_on:'expiry', borrower:'borrower', return_on:'return', note:'note' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const days = date => date ? Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(day()+'T00:00:00Z'))/86400000) : Infinity;
  const money = value => new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:2}).format(value/100);
  function price(value) {
    value=value.trim(); if(!value) return 0;
    if(!/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new Error('金额最多两位小数，不支持负数或科学计数法。');
    const [whole,fraction='']=value.split('.'), result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    if(result>10000000000) throw new Error('购入总价不能超过一亿元。'); return result;
  }
  function alerts(item) {
    return [['到期',item.expires_on],['保修结束',item.warranty_until],['归还',item.borrower ? item.return_on : '']]
      .filter(([,date])=>date && days(date)<=30).map(([label,date])=>({label,date,days:days(date)}));
  }
  function deadline(item) { return Math.min(...[item.expires_on,item.warranty_until,item.borrower?item.return_on:''].filter(Boolean).map(days)); }
  function status(message, error=false, target='status') { $(target).textContent=message; $(target).classList.toggle('inventory-error',error); }
  function syncAccount() {
    const owner=token(); if(owner===state.token)return owner;
    state.token=owner;state.items=[];state.loaded=false;state.loading=false;state.busy=false;state.request++;state.page=1;state.editing=null;state.baseline='';
    $('dialog').close();$('form').reset();$('search').value='';$('category').value='';$('view').value='active';$('sort').value='updated';
    status('');status('',false,'save-status'); render(); return owner;
  }
  async function api(path,options={}) {
    const owner=token(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch('/api/v1/inventory'+path,{...options,signal:controller.signal,headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'}});
      let payload=null;
      try { payload=await response.json(); }
      catch(error) { if(error.name!=='SyntaxError')throw error; }
      if(owner!==token())throw new Error('账号已切换，旧请求已忽略。');
      if(response.status===401)throw new Error('登录已过期或尚未登录，请退出后重新登录。');
      if(response.status===404) {
        if(path && payload?.error?.code==='not_found')throw new Error('这条物品记录已不存在，请保留草稿并刷新列表。');
        throw new Error('物品管家接口不存在（HTTP 404）。请在运行 Go 服务的终端按 Ctrl+C，重新执行 go run ./cmd/api，再刷新网页；仅刷新浏览器不会更新后端。如已重启，请检查访问地址或反向代理配置。');
      }
      if(response.status===405)throw new Error('当前服务不支持物品管家请求（HTTP 405），请重启新版 Go 服务并检查代理配置。');
      if(!response.ok)throw new Error(payload?.error?.message || `物品服务请求失败（HTTP ${response.status}），请稍后重试或检查服务日志。`);
      if(!payload || typeof payload!=='object' || Array.isArray(payload) || !Object.prototype.hasOwnProperty.call(payload,'data'))throw new Error('物品接口没有返回有效的 JSON 数据，请检查访问地址、代理配置和 Go 服务版本。');return payload.data;
    } catch(error) { if(error.name==='AbortError')throw new Error('请求超时。保存结果可能未知，请原样重试。');throw error; }
    finally { clearTimeout(timer); }
  }
  async function load() {
    const owner=syncAccount();if(!owner||state.busy)return;
    const version=++state.request;state.loading=true;render();status('正在整理你的物品…');
    try {
      const rows=await api('');if(owner!==token()||version!==state.request)return;
      if(!Array.isArray(rows))throw new Error('物品列表格式无效。');
      state.items=rows;state.loaded=true;status(`已同步 ${rows.length} 条记录 · 页面内到期提醒`);
    } catch(error) {if(owner===token()&&version===state.request)status(`${error.message} ${state.loaded?'当前保留上次数据。':'点击刷新重试。'}`,true);}
    finally {if(owner===token()&&version===state.request){state.loading=false;render();}}
  }
  function filtered() {
    const query=$('search').value.trim().toLocaleLowerCase(),category=$('category').value,view=$('view').value;
    const rows=state.items.filter(item=> Boolean(item.archived)===(view==='archived') && (!category||item.category===category)
      && (view!=='lent'||item.borrower) && (view!=='attention'||alerts(item).length)
      && [item.name,item.category,item.location,item.borrower,item.note].join(' ').toLocaleLowerCase().includes(query));
    rows.sort((a,b)=>{switch($('sort').value){case 'name':return a.name.localeCompare(b.name,'zh-CN');case 'price':return b.price-a.price;case 'deadline':return deadline(a)-deadline(b)||a.name.localeCompare(b.name,'zh-CN');default:return b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id)}});
    return rows;
  }
  function render() {
    state.today = day();
    const active=state.items.filter(item=>!item.archived),category=$('category').value;
    $('category').innerHTML='<option value="">全部分类</option>'+[...new Set(state.items.map(item=>item.category).concat(category?[category]:[]))].sort().map(value=>`<option value="${escape(value)}">${escape(value)}</option>`).join('');$('category').value=category;
    $('total').textContent=state.loaded?`${active.length} / ${active.reduce((sum,item)=>sum+item.quantity,0)}`:'—';
    $('value').textContent=state.loaded?money(active.reduce((sum,item)=>sum+item.price,0)):'—';
    $('due').textContent=state.loaded?active.filter(item=>alerts(item).length).length:'—';$('lent').textContent=state.loaded?active.filter(item=>item.borrower).length:'—';
    const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/12));state.page=Math.min(pages,Math.max(1,state.page));
    $('page').textContent=`第 ${state.page} / ${pages} 页 · ${rows.length} 条`;
    $('prev').disabled=state.page===1||state.busy;$('next').disabled=state.page===pages||state.busy;
    $('new').disabled=!state.loaded||state.busy||state.loading;$('reload').disabled=state.busy||state.loading;$('export').disabled=!state.loaded||state.busy||!rows.length;
    $('list').innerHTML=rows.length?rows.slice((state.page-1)*12,state.page*12).map(item=>card(item)).join(''):
      `<div class="inventory-empty"><span aria-hidden="true">▣</span><h3>${!state.loaded?'物品架正在等待连接':$('search').value||category||$('view').value!=='active'?'没有匹配的物品':'从手边的一件物品开始'}</h3><p>${!state.loaded?'加载失败时，请点击上方刷新。':'记录位置、保修或借用情况，需要时便能快速找到。'}</p></div>`;
  }
  function card(item) {
    const notices=alerts(item), icon=({'数码设备':'⌨','家居用品':'⌂','衣物配饰':'♧','食品饮品':'◒','运动户外':'△'})[item.category]||'▣';
    return `<article class="inventory-card ${item.archived?'is-archived':''}"><div class="inventory-card-top"><span class="inventory-object" aria-hidden="true">${icon}</span><span>${escape(item.category)}</span><b>× ${item.quantity}</b></div><h3>${escape(item.name)}</h3><p class="inventory-location">⌖ ${escape(item.location||'尚未记录位置')}</p><div class="inventory-card-value">${money(item.price)}<small>登记购入总价</small></div><div class="inventory-badges">${item.borrower?`<span class="lent">借给 ${escape(item.borrower)}${item.return_on?' · '+escape(item.return_on)+' 归还':''}</span>`:''}${!item.archived?notices.map(n=>`<span class="${n.days<0?'overdue':'soon'}">${escape(n.label)} · ${n.days<0?'已过 '+(-n.days)+' 天':n.days===0?'今天':n.days+' 天后'}</span>`).join(''): '<span>已归档 · 可恢复</span>'}</div>${item.note?`<p class="inventory-card-note">${escape(item.note)}</p>`:''}<footer><button class="text-button" type="button" data-inventory-action="edit" data-id="${escape(item.id)}" ${state.busy?'disabled':''}>查看 / 编辑</button><div>${item.borrower?`<button class="text-button" type="button" data-inventory-action="return" data-id="${escape(item.id)}" ${state.busy?'disabled':''}>确认归还</button>`:''}<button class="text-button" type="button" data-inventory-action="archive" data-id="${escape(item.id)}" ${state.busy||item.borrower?'disabled':''}>${item.archived?'恢复':'归档'}</button></div></footer></article>`;
  }
  function rawDraft() {return JSON.stringify(Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,$(id).value])));}
  function open(item) {
    if(!syncAccount()||state.busy||!state.loaded)return;
    state.editing=item?{...item}:{id:crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join(''),revision:0,archived:false};
    for(const [key,id] of Object.entries(fields))$(id).value=key==='price'?(item?.price?String(item.price/100):''):item?.[key]??(key==='quantity'?1:key==='category'?'日常用品':'');
    state.baseline=rawDraft();$('dialog-title').textContent=item?'物品档案':'收录一件物品';status('',false,'save-status');$('dialog').showModal();$('name').focus();
  }
  function payload() {
    const result=Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,$(id).value.trim()]));result.quantity=Number(result.quantity);result.price=price(result.price);
    return {...result,revision:state.editing.revision,archived:state.editing.archived};
  }
  function lockForm(locked) { $('form').querySelectorAll('input,textarea,button').forEach(input=>{input.disabled=locked;}); }
  async function save(event) {
    event.preventDefault();if(state.busy||!state.editing||state.token!==token())return;
    let body;try{body=payload();}catch(error){status(error.message,true,'save-status');return;}
    const owner=state.token,id=state.editing.id;state.busy=true;lockForm(true);render();status('正在保存…',false,'save-status');
    try {
      const item=await api('/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(body)});if(owner!==token())return;
      state.items=state.items.filter(row=>row.id!==id).concat(item);state.baseline=rawDraft();$('dialog').close();state.editing=null;status('已保存。位置和日期都替你记住了。');
    }catch(error){if(owner===token())status(`${error.message} 草稿已保留，可导出草稿；结果未知时请原样重试，版本冲突时关闭并刷新后重新编辑。`,true,'save-status');}
    finally{if(owner===token()){state.busy=false;lockForm(false);render();}}
  }
  async function action(kind,id) {
    if(!syncAccount()||state.busy||state.loading)return;
    const item=state.items.find(row=>row.id===id);if(!item)return;
    if(kind==='edit'){open(item);return;}
    if(!['return','archive'].includes(kind))return;
    if(kind==='archive'&&item.borrower){status('请先确认归还，再归档。',true);return;}
    if(!window.confirm(kind==='return'?`确认“${item.name}”已经归还？`: `${item.archived?'恢复':'归档'}“${item.name}”？归档后仍可恢复。`))return;
    const owner=state.token;state.busy=true;render();
    const body=Object.fromEntries([...Object.keys(fields),'revision','archived'].map(key=>[key,item[key]]));
    if(kind==='return'){body.borrower='';body.return_on='';}else body.archived=!item.archived;
    try{const updated=await api('/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(body)});if(owner!==token())return;state.items=state.items.map(row=>row.id===id?updated:row);status(kind==='return'?'已确认归还。':body.archived?'已归档，可在“已归档”中恢复。':'已恢复到在库物品。');}
    catch(error){if(owner===token())status(error.message+' 可重试同一操作；如提示版本冲突，请刷新。',true);}
    finally{if(owner===token()){state.busy=false;render();}}
  }
  function close() {if(state.busy)return;if(state.editing&&rawDraft()!==state.baseline&&!window.confirm('尚有未保存修改，确定关闭？可先导出草稿。'))return;$('dialog').close();state.editing=null;}
  function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function csvCell(value){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
  function exportCSV(){if(!state.loaded||state.busy||state.token!==token())return;const rows=[['名称','分类','位置','数量','购入总价（元）','购入日期','保修截止','到期日期','借用人','预计归还','备注','状态'],...filtered().map(item=>[item.name,item.category,item.location,item.quantity,(item.price/100).toFixed(2),item.purchased_on,item.warranty_until,item.expires_on,item.borrower,item.return_on,item.note,item.archived?'归档':'在库'])];download('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8',`Daynest-物品-${day()}.csv`);status('已导出当前全部筛选结果，文件包含借用人和备注，请妥善保存。');}
  function bind() {
    document.addEventListener('daynest:shopping-store',async event=>{
      const owner=syncAccount(),item=event.detail;
      if(!owner||state.busy||!item||typeof item.id!=='string'||typeof item.name!=='string')return;
      if($('dialog').open){status('请先保存或关闭当前物品编辑器。',true);return;}
      await load();if(owner!==token()||!state.loaded||state.busy)return;
      const id='shopping-'+item.id,existing=state.items.find(row=>row.id===id);
      if(existing){open(existing);return;}
      const quantity=Number(String(item.quantity||'').match(/^\d+/)?.[0]||1);
      open({id,revision:0,archived:false,name:item.name,category:'日常用品',quantity:Math.min(9999,Math.max(1,quantity)),note:[item.note,item.quantity?'购物数量：'+item.quantity:''].filter(Boolean).join('\n')});
      status('已预填购物内容，请核对数量并确认保存；不会自动记账。',false,'save-status');
    });
    document.querySelector('[data-view="inventory"]')?.addEventListener('click',load);
    $('new').addEventListener('click',()=>open());$('reload').addEventListener('click',load);$('form').addEventListener('submit',save);$('close').addEventListener('click',close);
    $('dialog').addEventListener('cancel',event=>{event.preventDefault();close();});
    $('dialog').addEventListener('click',event=>{if(event.target===$('dialog'))close();});
    for(const id of ['search','category','view','sort'])$(id).addEventListener(id==='search'?'input':'change',()=>{state.page=1;render();});
    $('prev').addEventListener('click',()=>{state.page--;render();});$('next').addEventListener('click',()=>{state.page++;render();});
    $('list').addEventListener('click',event=>{const button=event.target.closest('[data-inventory-action]');if(button)action(button.dataset.inventoryAction,button.dataset.id);});
    $('export').addEventListener('click',exportCSV);
    $('draft-export').addEventListener('click',()=>{if(state.editing&&state.token===token())download(rawDraft(),'application/json',`Daynest-物品草稿-${day()}.json`);});
    document.getElementById('logout')?.addEventListener('click',()=>{state.token='invalidated';syncAccount();lockForm(false);});
    window.addEventListener('storage',event=>{if(event.key==='studyflow.token'){syncAccount();lockForm(false);}});
    window.addEventListener('beforeunload',event=>{if(state.editing&&rawDraft()!==state.baseline){event.preventDefault();event.returnValue='';}});
    setInterval(()=>{if(state.token!==token()){syncAccount();lockForm(false);}else if(state.loaded&&!document.hidden&&state.today!==day())render();},60000);
  }
  bind();
})();
