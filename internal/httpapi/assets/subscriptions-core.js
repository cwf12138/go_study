(() => {
  'use strict';
  const cycles={weekly:['每周',365.2425/7],monthly:['每月',12],quarterly:['每季',4],yearly:['每年',1]},states={active:'进行中',paused:'已暂停',cancelled:'已取消'};
  function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('请选择完整日期');const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value||d.getUTCFullYear()<2000||d.getUTCFullYear()>2100)throw Error('日期范围为 2000–2100 年');return d;}
  function due(row,n=row.paid_cycles){
    const anchor=date(row.anchor_date);if(!Number.isInteger(n)||n<0||n>12000||!cycles[row.cycle])throw Error('扣费周期无效');
    let d;if(row.cycle==='weekly')d=new Date(anchor.getTime()+7*n*86400000);else{const step={monthly:1,quarterly:3,yearly:12}[row.cycle],first=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+step*n,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();d=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(anchor.getUTCDate(),last)));}
    const result=d.toISOString().slice(0,10);date(result);return result;
  }
  function cents(value){if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(value))throw Error('金额须为非负数字，最多两位小数');const [a,b='']=value.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));if(n>100000000)throw Error('每期最多 1,000,000 元');return n;}
  function valid(row){try{return row&&typeof row.id==='string'&&typeof row.name==='string'&&typeof row.category==='string'&&typeof row.note==='string'&&typeof row.deleted==='boolean'&&!!states[row.state]&&Number.isSafeInteger(row.amount_cents)&&row.amount_cents>=0&&row.amount_cents<=100000000&&Number.isInteger(row.revision)&&row.revision>0&&!!due(row);}catch{return false;}}
  function days(a,b){return Math.round((date(b)-date(a))/86400000);}
  function upcoming(rows,today,span=30){
    const start=date(today),end=new Date(start.getTime()+span*86400000).toISOString().slice(0,10),events=[];
    for(const row of rows.filter(r=>!r.deleted&&r.state==='active')){
      const anchor=date(row.anchor_date),step={monthly:1,quarterly:3,yearly:12}[row.cycle];
      let n=Math.max(row.paid_cycles,row.cycle==='weekly'?Math.floor((start-anchor)/(7*86400000))-1:Math.floor(((start.getUTCFullYear()-anchor.getUTCFullYear())*12+start.getUTCMonth()-anchor.getUTCMonth())/step)-1,0);
      for(let guard=0;guard<40&&n<=12000;guard++,n++){
        let next;try{next=due(row,n);}catch{break;}
        if(next>=end)break;if(next>=today)events.push({row,date:next});
      }
    }
    return events.sort((a,b)=>a.date.localeCompare(b.date)||a.row.name.localeCompare(b.row.name,'zh-CN')||a.row.id.localeCompare(b.row.id));
  }
  function totals(rows,today){const active=rows.filter(r=>!r.deleted&&r.state==='active'),annual=active.reduce((n,r)=>n+r.amount_cents*cycles[r.cycle][1],0),events=upcoming(active,today);return {active:active.length,annual:Math.round(annual),monthly:Math.round(annual/12),due:active.filter(r=>due(r)<=today).length,upcoming:events.reduce((n,e)=>n+e.row.amount_cents,0),events};}
  function csv(rows){const cell=v=>{let s=String(v??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFF'+[['名称','分类','每期金额（元）','扣费周期','下一扣费日','状态','最近确认支付日期','备注'],...rows.map(r=>[r.name,r.category,(r.amount_cents/100).toFixed(2),cycles[r.cycle][0],due(r),states[r.state],r.last_paid_date,r.note])].map(row=>row.map(cell).join(',')).join('\r\n');}
  window.DaynestSubscriptions=Object.freeze({cycles,states,date,due,cents,valid,days,upcoming,totals,csv});
})();
