(() => {
 'use strict';
 const categories={birthday:'生日',anniversary:'纪念日',plan:'计划',other:'其他'};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s?d:null;}
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function info(row,day=today()){
  const original=date(row.date),now=date(day);if(!original||!now)throw Error('日期无效');let next=row.date;
  if(row.annual&&next<day){for(let y=Math.max(now.getUTCFullYear(),original.getUTCFullYear());y<=now.getUTCFullYear()+8;y++){const candidate=String(y)+row.date.slice(4);if(date(candidate)&&candidate>=day){next=candidate;break;}}}
  const days=Math.round((+date(next)-+now)/86400000);
  return {next,days,label:days===0?'就是今天':days>0?'还有':'已经',count:Math.abs(days)};
 }
 function valid(r){return r&&typeof r.id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(r.id)&&typeof r.title==='string'&&r.title.length>0&&r.title.length<=160&&!!date(r.date)&&Object.hasOwn(categories,r.category)&&typeof r.note==='string'&&r.note.length<=2000&&['annual','pinned','deleted'].every(k=>typeof r[k]==='boolean')&&Number.isSafeInteger(r.revision)&&r.revision>0&&typeof r.created_at==='string'&&Number.isFinite(Date.parse(r.created_at));}
 function select(rows,{query='',view='all',category='',sort='nearest'}={},day=today()){
  const q=query.trim().toLocaleLowerCase();return rows.filter(r=>r.deleted===(view==='trash')).map(r=>({...r,computed:info(r,day)})).filter(r=>(!category||r.category===category)&&(!q||(r.title+' '+r.note).toLocaleLowerCase().includes(q))&&(view!=='soon'||(r.computed.days>=0&&r.computed.days<=30))).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(sort==='created'?b.created_at.localeCompare(a.created_at):((a.computed.days<0)-(b.computed.days<0)||Math.abs(a.computed.days)-Math.abs(b.computed.days)))||a.id.localeCompare(b.id));
 }
 window.DaynestImportantDays={categories,esc,date,today,info,valid,select};
})();
