(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DaynestActionCore=api;})(typeof window==='undefined'?globalThis:window,()=>{
  'use strict';
  const normalize=text=>String(text||'').trim().replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)、]\s*)/,'').trim().replace(/\s+/g,' ');
  function anchor(note,start,end){
    const content=note.content||'';
    if(end>start){const selected=content.slice(start,end);if(/[\r\n]/.test(selected))throw Error('请只选择同一行中的文字，一次关联一项行动。');
      const from=content.lastIndexOf('\n',start-1)+1,to=content.indexOf('\n',end),text=normalize(content.slice(from,to<0?content.length:to));
      if(!text||[...text].length>300)throw Error('选择的这一行需包含 1–300 个字。');return{anchor_kind:'line',anchor_text:text};}
    const text=normalize(note.title);if(!text||[...text].length>300)throw Error('请先填写标题，或选中正文中需要处理的一行。');return{anchor_kind:'title',anchor_text:text};
  }
  function commands(storage,scope){
    const key='daynest.actions.v1:'+encodeURIComponent(JSON.stringify([scope.server,scope.userID]));
    if(!scope.userID||!scope.server)throw Error('请先确认登录状态。');
    function read(){const raw=storage.getItem(key);if(!raw)return{};if(raw.length>32768)throw Error('待确认操作记录过大，请检查本机存储。');const data=JSON.parse(raw);
      if(!data||typeof data!=='object'||Array.isArray(data))throw Error('待确认操作记录损坏，请先导出或清理浏览器存储。');
      for(const [kind,c]of Object.entries(data)){if(!['link','focus'].includes(kind)||!c||typeof c.path!=='string'||!c.body||typeof c.body!=='object'||!Number.isFinite(c.createdAt))throw Error('待确认操作记录损坏。');
        if(kind==='link'&&!/^\/api\/v1\/memos\/[\w-]+\/actions$/.test(c.path))throw Error('无效的关联操作记录。');
        if(kind==='focus'&&(c.path!=='/api/v1/focus-sessions'||!/^[\w-]{16,100}$/.test(c.body.request_id)||typeof c.body.todo_id!=='string'))throw Error('无效的专注操作记录。');}
      return data;
    }
    function write(data){const raw=JSON.stringify(data);if(raw.length>32768)throw Error('操作内容过长，无法安全保留重试记录。');storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('无法保留重试记录，请检查浏览器存储权限。');}
    return{read,put(kind,command){const data=read();if(data[kind])throw Error('还有一项操作尚未确认，请先处理“待确认操作”。');data[kind]=command;write(data);},remove(kind){const data=read();delete data[kind];write(data);}};
  }
  const id=v=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v),time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v)),count=v=>Number.isSafeInteger(v)&&v>=0;
  function validLink(v,user){return!!v&&id(v.id)&&v.user_id===user&&id(v.memo_id)&&id(v.todo_id)&&['line','title'].includes(v.anchor_kind)&&typeof v.anchor_text==='string'&&typeof v.memo_title==='string'&&time(v.memo_updated_at)&&time(v.created_at);}
  function validFocus(v,user){return!!v&&id(v.id)&&v.user_id===user&&id(v.todo_id)&&['running','paused','completed','abandoned'].includes(v.status)&&['focus','focus_first','break','focus_second'].includes(v.phase)&&Number.isInteger(v.planned_minutes)&&v.planned_minutes>=1&&v.planned_minutes<=240&&count(v.actual_minutes)&&count(v.focused_seconds)&&count(v.phase_remaining_seconds)&&time(v.started_at)&&time(v.phase_started_at);}
  function validContext(v,user){
    if(!v||!count(v.completed_minutes)||!Array.isArray(v.sessions)||v.sessions.length>20)return false;
    const t=v.todo,l=v.link,s=v.source;
    if(t!==null&&(!t||!id(t.id)||t.user_id!==user||typeof t.title!=='string'||!['open','completed'].includes(t.status)))return false;
    if(l!==null&&!validLink(l,user))return false;
    if(!l&&!t)return false;
    if(l&&(!s||s.id!==l.memo_id||typeof s.title!=='string'||!['archived','deleted','changed'].every(key=>typeof s[key]==='boolean')||(t&&(t.id!==l.todo_id||t.memo_action_id!==l.id))))return false;
    if(!l&&s!==null)return false;
    return v.sessions.every(item=>validFocus(item,user)&&item.todo_id===(l?.todo_id||t.id));
  }
  return{normalize,anchor,commands,validLink,validFocus,validContext};
});
