(() => {
  'use strict';
  const C=window.DaynestTextTools,$=id=>document.getElementById('text-tool-'+id),panel=document.getElementById('toolkit-text');
  if(!C||!panel)return;
  let owner='',result=null,undo=[],redo=[],revision=0;
  const token=()=>localStorage.getItem('studyflow.token')||'';
  const message=text=>$('status').textContent=text;
  const labels={clean:'去除行首尾空格、合并连续空格与多余空行；不适合需要保留缩进的代码。',blank:'移除只含空白的行，保留其他行的原始内容。',unique:'按完整行精确去重，保留第一次出现的顺序；区分大小写与空格。',replace:'按原文精确匹配全部替换，区分大小写，不使用正则表达式；替换为空即可删除匹配内容。'};
  function render(){
    const mode=$('mode').value;$('replace-fields').hidden=mode!=='replace';$('hint').textContent=labels[mode]||'';
    $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;
    ['characters','compact','lines','words'].forEach(id=>$(id).textContent='—');
    try{
      const source=$('input').value,stats=C.stats(source);result=C.transform(source,mode,$('find').value,$('replacement').value);
      $('characters').textContent=String(stats.characters);$('compact').textContent=String(stats.compact);$('lines').textContent=String(stats.lines);$('words').textContent=String(stats.words);
      $('output').value=result.text;
      $('summary').textContent=`整理后 ${C.stats(result.text).characters} 字符`+(mode==='replace'?` · 匹配 ${result.count} 处`:mode==='unique'?` · 去掉 ${result.count} 行重复项`:'')+(result.changed?' · 原文尚未修改':' · 内容未改变');
      $('apply').disabled=!result.changed;$('copy').disabled=!result.text;$('download').disabled=!result.text;
    }catch(error){result=null;$('output').value='';$('summary').textContent=error.message;['apply','copy','download'].forEach(id=>$(id).disabled=true);}
    $('clear').disabled=!$('input').value;
  }
  function reset(){revision++;owner=token();undo=[];redo=[];result=null;['input','output','find','replacement'].forEach(id=>$(id).value='');$('mode').value='clean';message('文字仅在本页内存中，刷新或退出账号会清空。');render();}
  function sync(){if(token()!==owner)reset();return !!owner;}
  function remember(stack,value){stack.push(value);if(stack.length>10)stack.shift();}
  function commit(value){remember(undo,$('input').value);redo=[];$('input').value=value;revision++;render();}
  ['input','find','replacement'].forEach(id=>$(id).addEventListener('input',e=>{if(!sync())return;revision++;if(id==='input')redo=[];if(e.isComposing)return;message('预览已更新，原文不会自动覆盖。');render();}));
  ['input','find','replacement'].forEach(id=>$(id).addEventListener('compositionend',()=>{if(sync())render();}));
  $('mode').addEventListener('change',()=>{if(sync()){revision++;render();}});
  $('apply').addEventListener('click',()=>{if(!sync()||!result?.changed)return;commit(result.text);message('已应用，可以撤销这次整理。');});
  $('clear').addEventListener('click',()=>{if(!sync()||!$('input').value)return;commit('');message('已清空，可以撤销恢复。');});
  $('undo').addEventListener('click',()=>{if(!sync()||!undo.length)return;remember(redo,$('input').value);$('input').value=undo.pop();revision++;render();message('已撤销工具操作。手动输入仍可使用系统撤销快捷键。');});
  $('redo').addEventListener('click',()=>{if(!sync()||!redo.length)return;remember(undo,$('input').value);$('input').value=redo.pop();revision++;render();message('已重做。');});
  $('copy').addEventListener('click',async()=>{
    if(!sync()||!result?.text)return;const account=owner,version=revision,text=result.text;
    try{await navigator.clipboard.writeText(text);if(account===token()&&version===revision)message('整理结果已复制。');}
    catch{if(account===token()&&version===revision){$('output').focus();$('output').select();message('浏览器未允许复制，已选中结果，请按 Ctrl/⌘ + C。');}}
  });
  $('download').addEventListener('click',()=>{
    if(!sync()||!result?.text)return;
    const url=URL.createObjectURL(new Blob([result.text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='整理后的文字.txt';document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);message('已请求下载整理结果，原文不会上传。');
  });
  new MutationObserver(sync).observe(document.getElementById('app-view'),{attributes:true,attributeFilter:['class']});
  document.getElementById('logout').addEventListener('click',reset);
  window.addEventListener('storage',e=>{if(e.key==='studyflow.token')sync();});
  window.addEventListener('pagehide',reset);
  document.addEventListener('visibilitychange',sync);
  window.setInterval(sync,1000);
  reset();
})();
