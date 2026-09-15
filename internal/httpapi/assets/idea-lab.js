(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const panel = $('#panel-lab');
  const modes = {
    explain: {title:'费曼讲解', prompts:['用初学者听得懂的话解释','给出一个具体例子或生活类比','哪里还讲不清？下一步如何验证？']},
    connect: {title:'知识碰撞', prompts:['这两个概念有什么共同结构？','将一个概念的方法应用到另一个，会怎样？','这个联系有什么局限？设计一个小实验来验证']},
    challenge: {title:'反向思考', prompts:['这个观点成立，依赖哪些前提？','找一个反例：在什么场景下它不成立？','你会如何修改原观点？还需要什么证据？']}
  };
  const fields = ['one','two','three'];
  const state = {mode:'explain', sources:[], topic:'', noteID:'', title:'', dirty:false, busy:false, epoch:0, token:''};
  const controllers = new Set();
  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const status = text => { $('#lab-status').textContent = text; };
  function render() {
    const mode=modes[state.mode]; $('#lab-heading').textContent=mode.title;
    fields.forEach((field,i)=>{$('#lab-label-'+field).textContent=mode.prompts[i];});
    panel.querySelectorAll('[data-lab-mode]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.labMode===state.mode));button.disabled=state.busy;});
    $('#lab-context').textContent=state.topic || '输入主题或抽取笔记，开始一次思考实验。';
    $('#lab-sources').innerHTML=state.sources.map(note=>`<details><summary>${esc(note.title)}</summary><p>${esc(note.snippet || '这则笔记没有正文摘要。')}</p><small>笔记摘要 · 仅供思考参考</small></details>`).join('');
    $('#lab-count').textContent=fields.reduce((sum,field)=>sum+Array.from($('#lab-'+field).value.trim()).length,0)+' 字';
    $('#lab-save').textContent=state.noteID?'更新练习笔记':'保存到知识花园';
    $('#lab-save').disabled=state.busy||!state.topic||(!state.dirty&&!!state.noteID);
    ['start','draw','topic',...fields].forEach(id=>{$('#lab-'+id).disabled=state.busy;});
  }
  function reset() {
    state.epoch++;controllers.forEach(c=>c.abort());controllers.clear();
    Object.assign(state,{sources:[],topic:'',noteID:'',title:'',dirty:false,busy:false});
    $('#lab-form').reset();$('#lab-topic').value='';status('未保存的内容仅在当前页面保留。');render();
  }
  function syncAccount() {
    const token=localStorage.getItem('studyflow.token')||'';
    if(token!==state.token){reset();state.token=token;} return token;
  }
  async function request(path='',options={}) {
    const token=localStorage.getItem('studyflow.token')||'', epoch=state.epoch;
    if(token!==state.token){syncAccount();throw new Error('账号已切换，请重新开始。');}
    if(!token)throw new Error('请先登录。');
    const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch('/api/v1/knowledge/notes'+path,{...options,signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
      const payload=await response.json();
      if(epoch!==state.epoch||token!==(localStorage.getItem('studyflow.token')||'')){syncAccount();throw new Error('账号已切换，请重新开始。');}
      if(!response.ok)throw new Error(payload.error?.message||'请求失败，请重试。');
      return payload.data;
    } catch(error) {
      if(error.name==='AbortError')throw new Error('请求超时或已取消。保存状态可能不确定，请重试以核对。');
      throw error;
    } finally {clearTimeout(timer);controllers.delete(controller);}
  }
  async function run(action) {
    syncAccount();if(state.busy)return;const epoch=state.epoch;state.busy=true;render();
    try {await action();}catch(error){if(epoch===state.epoch)status('未完成：'+error.message+' 当前草稿不会清空。');}
    finally {if(epoch===state.epoch){state.busy=false;render();}}
  }
  function mayReplace() {return !state.dirty||window.confirm('当前练习尚未保存，开始新练习会清空正文。是否继续？');}
  function start(topic,sources=[]) {
    $('#lab-form').reset();Object.assign(state,{topic,sources,noteID:'',title:'',dirty:true});
    status('练习已开始。请用自己的话完成三个问题，再保存。');render();$('#lab-one').focus();
  }
  function drawNotes(notes,count) {
    const unique=[...new Map(notes.filter(n=>n&&typeof n.id==='string'&&typeof n.title==='string'&&!(n.tags||[]).includes('灵感实验')).map(n=>[n.id,n])).values()];
    if(unique.length<count)throw new Error(`需要至少 ${count} 则非练习笔记。可先到知识花园添加，或使用自选主题。`);
    for(let i=unique.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[unique[i],unique[j]]=[unique[j],unique[i]];}return unique.slice(0,count);
  }
  function content() {
    const refs=state.sources.map(n=>/[[\]|\n\r]/.test(n.title)?n.title:`[[${n.title}]]`).join('、');
    return `# ${modes[state.mode].title}\n\n主题：${state.topic}\n\n${refs?'来源：'+refs+'\n\n':''}`+fields.map((field,i)=>`## ${modes[state.mode].prompts[i]}\n\n${$('#lab-'+field).value.trim()}`).join('\n\n');
  }
  panel.querySelectorAll('[data-lab-mode]').forEach(button=>button.addEventListener('click',()=>{
    syncAccount();if(state.busy||button.dataset.labMode===state.mode||!mayReplace())return;
    reset();state.mode=button.dataset.labMode;render();
  }));
  $('#lab-start').addEventListener('click',()=>{syncAccount();if(state.busy)return;const topic=$('#lab-topic').value.trim();if(!topic){status('请先填写主题；知识碰撞可填写“概念 A × 概念 B”。');$('#lab-topic').focus();return;}if(mayReplace())start(topic);});
  $('#lab-draw').addEventListener('click',()=>{syncAccount();if(state.busy||!mayReplace())return;run(async()=>{status('正在从知识花园抽取灵感…');const notes=await request();if(!Array.isArray(notes))throw new Error('笔记列表格式无效');const sources=drawNotes(notes,state.mode==='connect'?2:1);start(sources.map(n=>n.title).join(' × '),sources);});});
  fields.forEach(field=>$('#lab-'+field).addEventListener('input',()=>{state.dirty=true;status('有未保存的修改。');$('#lab-count').textContent=fields.reduce((sum,f)=>sum+Array.from($('#lab-'+f).value.trim()).length,0)+' 字';$('#lab-save').disabled=!state.topic||state.busy;}));
  $('#lab-form').addEventListener('submit',event=>{
    event.preventDefault();syncAccount();if(state.busy||!state.topic||!event.currentTarget.reportValidity())return;
    if(fields.some(field=>!$('#lab-'+field).value.trim())){status('请完成三个问题后再保存。');return;}
    run(async()=>{
      status('正在保存练习…');
      // Keep this title stable after an uncertain POST result so a retry can find it.
      if(!state.title)state.title=`灵感实验 · ${modes[state.mode].title} · ${Array.from(state.topic).slice(0,40).join('')} · ${crypto.randomUUID()}`;
      if(!state.noteID){const existing=await request('?q='+encodeURIComponent(state.title));if(!Array.isArray(existing))throw new Error('保存前核对失败');state.noteID=existing.find(n=>n.title===state.title)?.id||'';}
      const body={title:state.title,content:content(),tags:['灵感实验',modes[state.mode].title]};
      const result=await request(state.noteID?'/'+encodeURIComponent(state.noteID):'',{method:state.noteID?'PATCH':'POST',body:JSON.stringify(body)});
      if(!result?.note?.id)throw new Error('保存响应不完整，请重试核对');
      state.noteID=result.note.id;state.dirty=false;status('已保存到知识花园，可搜索“灵感实验”查看。');
    });
  });
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  window.addEventListener('storage',event=>{if(event.key==='studyflow.token')syncAccount();});
  new MutationObserver(()=>syncAccount()).observe($('#app-view'),{attributes:true,attributeFilter:['class']});
  new MutationObserver(()=>{if(panel.classList.contains('active'))syncAccount();}).observe(panel,{attributes:true,attributeFilter:['class']});
  syncAccount();render();
})();
