(() => {
  'use strict';
  const D=window.DaynestMealDiscovery,C=window.DaynestMeals,A=window.DaynestMealActions,$=id=>document.getElementById('meal-discover-'+id);
  if(!D||!A||!$('dialog'))return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token=()=>localStorage.getItem('studyflow.token')||'';
  let owner=token(),rows=[],locks=new Set(),working=false,version=0,selection=null;
  function message(text,error=false){$('status').textContent=text;$('status').classList.toggle('meal-error',error);}
  function reset(){owner=token();rows=[];locks.clear();working=false;version++;selection=null;$('dialog').close();$('form').reset();$('slot').value='dinner';$('mode').value='single';$('people').value='1';$('minutes').value='60';$('flavor').value='any';$('vegetarian').checked=false;$('exclude').value='';$('date').value=C.today();message('');render();}
  function sync(){if(owner!==token())reset();return !!owner;}
  function prefs(){return {slot:$('slot').value,people:Number($('people').value),mode:$('mode').value,minutes:Number($('minutes').value),flavor:$('flavor').value,vegetarian:$('vegetarian').checked,exclude:C.names($('exclude').value),avoid:[...$('fields').querySelectorAll('[data-discover-avoid]')].filter(i=>i.checked).map(i=>i.value),have:A.have(),locks:[...locks]};}
  function controls(){for(const id of ['draw','arrange','shop','save'])$(id).disabled=working||id!=='draw'&&!rows.length;$('draw').textContent=rows.length?'换一餐 · 保留已锁定':'给我一个答案 ↗';$('fields').disabled=working;$('mode').disabled=working||$('slot').value==='breakfast';$('results').querySelectorAll('button').forEach(b=>b.disabled=working);$('date').disabled=working;}
  function render(){
    $('count').textContent=`${D.catalog.length} 道家常灵感 · 无需先收藏`;$('summary').textContent=rows.length?`${selection?.people||1} 人 · 约 ${rows.reduce((n,r)=>n+r.minutes,0)} 分钟`:'先来一点惊喜';$('actions').hidden=!rows.length;
    $('results').innerHTML=rows.map(row=>`<article class="meal-discover-card"><div class="meal-discover-card-heading"><span aria-hidden="true">${{protein:'🍳',veg:'🥬',soup:'🍲',staple:'🍜',rice:'🍚',breakfast:'🍞'}[row.role]}</span><div><h4>${esc(row.title)}</h4><p>${row.minutes} 分钟 · ${row.servings} 人份 · ${row.spicy?'含辣味':'不加辣'}</p></div><button type="button" data-discover-lock="${esc(row.id)}" aria-pressed="${locks.has(row.id)}" aria-label="${locks.has(row.id)?'解锁':'锁定'}${esc(row.title)}">${locks.has(row.id)?'已锁定':'留住它'}</button></div><details><summary>食材与做法</summary><div class="meal-discover-ingredients">${row.ingredients.map(i=>`<span>${esc(i.name)} <b>${esc(i.quantity)}</b></span>`).join('')}</div><ol>${row.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol></details></article>`).join('')||'<div class="meal-discover-empty"><span aria-hidden="true">♨</span><h4>把“吃什么”交给这一刻。</h4><p>选好偏好，点一下就给你完整答案。<br>有喜欢的菜，可以留住它再换搭配。</p></div>';
    controls();
  }
  function draw(){if(!sync()||working)return;try{const p=prefs();rows=D.recommend(p,rows);selection={slot:p.slot,people:p.people};message('这一餐给你搭好了。喜欢的菜可锁定，再点按钮换其余搭配；用量仅为按人数折算的参考。');render();}catch(e){rows=[];locks.clear();selection=null;message(e.message,true);render();}}
  async function act(kind){
    if(!sync()||working||!rows.length)return;if(!A.ready()){message('请先在厨房同步数据；若有待确认请求，请关闭此窗口，处理恢复栏后再继续。',true);return;}
    if(kind==='arrange'&&!D.validDay($('date').value)){message('请选择 2000–2100 年内的有效安排日期。',true);return;}
    const account=owner,seq=++version,snapshot=JSON.parse(JSON.stringify(rows)),day=$('date').value,slot=selection.slot;working=true;controls();message('正在保存这一餐…');
    try{const prepared=await A.prepare(snapshot);if(account!==token()||seq!==version)return;if(!prepared){message('尚未全部完成。已成功保存的菜谱会保留；请关闭此窗口处理恢复栏，再点同一操作继续，不会覆盖修改。',true);return;}
      if(kind==='arrange'){if(!await A.arrange(prepared,day,slot)){if(account===token()&&seq===version)message('菜单尚未全部保存。请处理恢复栏后重试；已安排的菜品会跳过。',true);return;}if(account!==token()||seq!==version)return;$('dialog').close();}
      else if(kind==='shop'){$('dialog').close();A.shop(prepared);}
      else message('已收藏这一餐的菜谱。相同版本重复收藏不会新增，个人修改不会被覆盖。');
    }catch(e){if(account===token()&&seq===version)message(e.message,true);}
    finally{if(account===token()&&seq===version){working=false;controls();}}
  }
  $('open').addEventListener('click',()=>{if(!sync())return;$('dialog').showModal();if(!rows.length)draw();else render();});
  $('form').addEventListener('submit',e=>{e.preventDefault();draw();});
  $('fields').addEventListener('change',()=>{if(!sync()||working)return;locks.clear();rows=[];selection=null;message('条件已变更，点击按钮生成新的搭配。');render();});
  $('exclude').addEventListener('input',()=>{if(!sync()||working)return;locks.clear();rows=[];selection=null;message('排除食材已变更，请重新推荐。');render();});
  $('results').addEventListener('click',e=>{if(!sync()||working)return;const button=e.target.closest('[data-discover-lock]');if(!button)return;const id=button.dataset.discoverLock;if(locks.has(id))locks.delete(id);else locks.add(id);render();});
  $('close').addEventListener('click',()=>{if(!working)$('dialog').close();});$('dialog').addEventListener('cancel',e=>{if(working)e.preventDefault();});
  for(const kind of ['arrange','shop','save'])$(kind).addEventListener('click',()=>act(kind));
  document.getElementById('logout').addEventListener('click',reset);window.addEventListener('storage',e=>{if(e.key==='studyflow.token')sync();});new MutationObserver(sync).observe(document.getElementById('app-view'),{attributes:true,attributeFilter:['class']});
  reset();
})();
