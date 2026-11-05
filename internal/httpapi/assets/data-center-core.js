(() => {
  'use strict';
  const groups=[
    ['notes','备忘与安排','memos',[['calendar_commands','日程新建回执'],['todo_imports','本机待办提交回执'],['action_links','行动关联回执'],['memos','备忘录'],['memo_folders','备忘录文件夹'],['todos','待办'],['todo_lists','待办清单'],['calendar_events','日程'],['important_days','重要日子']]],
    ['life','生活与物品','inventory',[['text_clips','文字片段'],['parcels','快递'],['inventory','物品'],['shopping','购物项'],['bookmarks','收藏'],['subscriptions','订阅'],['ledger','账本流水'],['meals','用餐记录']]],
    ['care','身心与习惯','moods',[['moods','心情日记'],['focus_sessions','专注会话'],['fitness','运动记录'],['nutrition','饮食安排'],['care','保养事项'],['habits','习惯']]],
    ['learning','学习与阅读','literature',[['goals','学习目标'],['tasks','学习任务'],['word_books','词书'],['vocabulary_words','单词'],['vocabulary_reviews','单词复习记录'],['planner_preferences','规划偏好'],['plan_blocks','计划时段'],['planner_reports','规划报告'],['weekly_reflections','周复盘'],['english_readings','精读记录'],['ebook_readings','电子书阅读'],['classical_studies','古诗文学习']]],
    ['memories','探索与回忆','explore',[['explorations','探索记录'],['keepsakes','私人收藏']]],
    ['legacy','保留的历史内容','',[['projects','项目历史'],['travel_plans','旅行历史'],['splits','AA 历史'],['whiteboards','白板历史'],['knowledge_notes','旧知识笔记']]],
  ];
  const int=n=>Number.isSafeInteger(n)&&n>=0,time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function valid(value){
    if(value?.schema_version!==1||value.scope!=='current_account'||!time(value.checked_at)||value.personal_json_includes_attachments!==false||value.full_backup_restore_verified!==false)return false;
    const r=value.records,a=value.attachments;
    if(!r||!['available','unavailable'].includes(r.state)||!int(r.objects)||!Array.isArray(r.collections)||r.collections.length>80)return false;
    const seen=new Set();let sum=0;
    for(const c of r.collections){if(!c||typeof c.key!=='string'||!/^\w{1,50}$/.test(c.key)||seen.has(c.key)||!int(c.count)||typeof c.personal_json!=='boolean')return false;seen.add(c.key);sum+=c.count;}
    if(!int(sum)||sum!==r.objects||(r.state==='unavailable'&&(sum!==0||r.collections.length)))return false;
    return a&&['available','unavailable','local_only'].includes(a.state)&&['files','active','expired','trashed','missing','accounted_bytes'].every(k=>int(a[k]))&&a.max_bytes===256*1024*1024&&a.max_files===100&&a.active+a.expired+a.trashed===a.files&&a.missing<=a.files&&(a.state==='available'||(a.files===0&&a.accounted_bytes===0));
  }
  function integrity(value){
    if(value?.scope!=='indexed_transfer_files'||!time(value.started_at)||!time(value.finished_at)||Date.parse(value.finished_at)<Date.parse(value.started_at)||value.unindexed_files_checked!==false||value.backup_restore_verified!==false)return false;
    if(!['files','verified','missing','mismatched','unreadable','changed','pending_uploads'].every(k=>int(value[k]))||value.files>100||value.verified+value.missing+value.mismatched+value.unreadable+value.changed!==value.files||!Array.isArray(value.issues)||value.issues.length!==value.files-value.verified)return false;
    const counts={missing:0,mismatched:0,unreadable:0,changed:0},ids=new Set();
    for(const row of value.issues){if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(row.id)||ids.has(row.id)||typeof row.name!=='string'||[...row.name].length>180||!row.name.trim()||/[\p{Cc}\/\\]/u.test(row.name)||!Object.hasOwn(counts,row.state))return false;counts[row.state]++;ids.add(row.id);}
    return Object.keys(counts).every(k=>counts[k]===value[k]);
  }
  function categories(collections){
    const map=new Map(collections.map(c=>[c.key,c])),used=new Set(),out=[];
    for(const [id,label,view,items]of groups){const rows=items.filter(([key])=>map.has(key)).map(([key,label])=>{used.add(key);return {...map.get(key),label};});out.push({id,label,view,rows,count:rows.reduce((n,r)=>n+r.count,0)});}
    const unknown=collections.filter(c=>!used.has(c.key)).map(c=>({...c,label:'其他已保存项目'}));if(unknown.length)out.push({id:'other',label:'其他记录',view:'',rows:unknown,count:unknown.reduce((n,r)=>n+r.count,0)});
    return out;
  }
  const bytes=n=>!Number.isFinite(n)?'—':n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KiB':(n/1048576).toFixed(1)+' MiB';
  const date=v=>time(v)?new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(v)):'尚无记录';
  function summary(r){
    if(r.missing+r.mismatched)return ['需要核对',`${r.missing+r.mismatched} 个附件缺失或内容不符。原文件没有被修改。`,'error'];
    if(r.unreadable+r.changed)return ['部分未确认',`${r.unreadable+r.changed} 个附件暂时无法验证，请稍后重试。`,'caution'];
    if(r.pending_uploads)return ['上传进行中',`本次核对 ${r.verified} 个已索引附件，另有上传进行中；结束后请重新检查。`,'caution'];
    return r.files?['本次内容一致',`本次 ${r.verified} 个已索引附件的大小与哈希一致。`,'good']:['暂无附件','当前账号没有可检查的附件索引。','neutral'];
  }
  const guide=`# Daynest 完整备份与恢复\n\n个人 JSON 导出不包含快传附件，也不是可直接启动的完整服务快照。\n完整备份含全部账号及密码哈希，未加密，请仅保存在你控制的私密位置。\n\n1. 在电脑上正常停止 Go 服务，确认进程已经退出。旧版服务没有目录锁，不能仅靠工具判断已停服。\n2. 在项目根目录创建父目录（备份与恢复的目标本身不能存在）：\n\nNew-Item -ItemType Directory -Force .local/backups, .local/restores | Out-Null\n\n3. 创建完整备份；自定义 DATA_FILE 时明确替换路径：\n\ngo run ./cmd/backup create --data-file data/studyflow.json --output .local/backups/my-backup --service-stopped\n\n4. 只读校验：\n\ngo run ./cmd/backup verify --input .local/backups/my-backup\n\n5. 先预览恢复（不创建目录）：\n\ngo run ./cmd/backup restore --input .local/backups/my-backup --output .local/restores/my-restore\n\n6. 核对后，加 --apply 恢复到全新目录：\n\ngo run ./cmd/backup restore --input .local/backups/my-backup --output .local/restores/my-restore --apply\n\n已有目录不会覆盖。失败副本保留未完成标记，不要删标记后启动，应另选全新目录重试。\n恢复后先在独立目录和回环端口验收登录、记录与附件，再决定正式切换。不要让两个进程操作同一数据目录。\n\n网页的附件检查只核对当前账号已索引的快传文件，不查孤立文件，不等于完整备份或恢复验收。\n详情见项目 docs/backup-restore.md。\n`;
  window.DaynestDataCenterCore={valid,integrity,categories,bytes,date,summary,escape,guide};
})();
