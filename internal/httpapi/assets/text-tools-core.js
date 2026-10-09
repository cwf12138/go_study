(() => {
  'use strict';
  const LIMIT=50000;
  function checked(value){const text=String(value??'');if(text.length>LIMIT)throw Error('文字过长，请控制在 50,000 个 UTF-16 单位以内（大部分常用文字计 1，部分表情计 2）。');return text.replace(/\r\n?/g,'\n');}
  function stats(value){const text=checked(value);return {characters:[...text].length,compact:[...text.replace(/\s/gu,'')].length,lines:text?text.split('\n').length:0,words:(text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[]).length};}
  function transform(value,mode,find='',replacement=''){
    const text=checked(value);let result=text,count=0;
    if(mode==='clean'){
      result=text.split('\n').map(line=>line.replace(/^[ \t\u3000]+|[ \t\u3000]+$/g,'').replace(/[ \t\u3000]{2,}/g,' ')).join('\n').replace(/\n{3,}/g,'\n\n').trim();
    }else if(mode==='blank'){
      result=text.split('\n').filter(line=>line.trim()!=='').join('\n');
    }else if(mode==='unique'){
      const seen=new Set();result=text.split('\n').filter(line=>{if(seen.has(line)){count++;return false;}seen.add(line);return true;}).join('\n');
    }else if(mode==='replace'){
      find=checked(find);replacement=checked(replacement);
      if(!find)throw Error('请先填写要查找的文字。');
      const parts=text.split(find);count=parts.length-1;
      if(text.length+count*(replacement.length-find.length)>LIMIT)throw Error('替换后的内容超过 50,000 上限，请缩短替换文字。');
      result=parts.join(replacement);
    }else throw Error('请选择有效的整理方式。');
    return {text:checked(result),count,changed:result!==text};
  }
  window.DaynestTextTools=Object.freeze({LIMIT,checked,stats,transform});
})();
