(() => {
 'use strict';
 const statuses={ready:'待取件',transit:'运输中',picked:'已取件'};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
 function valid(r){return !!r&&typeof r.id==='string'&&/^[\w-]{8,80}$/.test(r.id)&&Object.hasOwn(statuses,r.status)&&typeof r.deleted==='boolean'&&Number.isInteger(r.revision)&&r.revision>0&&[['title',160],['carrier',60],['location',240],['pickup_code',80],['tracking',120],['note',2000]].every(([k,n])=>typeof r[k]==='string'&&r[k].length<=n)&&(r.deadline===''||date(r.deadline))&&typeof r.created_at==='string'&&Number.isFinite(Date.parse(r.created_at));}
 function select(rows,{view='ready',query='',location=''}={}){const q=query.trim().toLocaleLowerCase();return rows.filter(r=>view==='trash'?r.deleted:!r.deleted&&(view==='all'||r.status===view)).filter(r=>(!location||r.location===location)&&(!q||[r.title,r.carrier,r.location,r.tracking,r.note].join(' ').toLocaleLowerCase().includes(q))).sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999')||b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));}
 function deadline(r,day=today()){if(r.deleted||r.status!=='ready'||!r.deadline)return '';const delta=Math.round((Date.parse(r.deadline+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);return delta<0?`已超过自定日期 ${-delta} 天`:delta===0?'今天是自定最晚取件日':`自定取件日还剩 ${delta} 天`;}
 function extract(text){if(typeof text!=='string'||text.length>1500)throw Error('请粘贴 1500 字以内的取件通知。');const match=text.match(/(?:取件码|取货码|提货码)(?:为|是)?[：:\s]*([a-zA-Z0-9][a-zA-Z0-9_-]{2,39})/);if(!match)throw Error('未找到明确的取件码，请手动填写；不会猜测短信里的普通数字。');return match[1];}
 window.DaynestParcels={statuses,esc,today,date,valid,select,deadline,extract};
})();
