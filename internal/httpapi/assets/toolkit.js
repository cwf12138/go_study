(() => {
  'use strict';
  const C=window.DaynestToolkit,$=id=>document.getElementById('toolkit-'+id),panel=document.getElementById('panel-toolkit');
  if(!C||!panel)return;
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data=C.fresh(),owner=null,currentTool='calc',calcResult=null,unitResult=null,audio=null;
  let wallClockKey='',clockQuiet=false;
  const storageKey=id=>'daynest.toolkit.session.v1.'+id;
  const showText=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
  function account(){try{const token=localStorage.getItem('studyflow.token')||'',part=token.split('.')[1]||'';const claim=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=')));return typeof claim.sub==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(claim.sub)?claim.sub:'';}catch{return '';}}
  function persist(){if(!owner)return;try{sessionStorage.setItem(storageKey(owner),JSON.stringify(data));}catch{$('storage-status').textContent='当前浏览器无法保存标签页记录，刷新后计时和历史可能丢失。';}}
  function sync(){
    const next=account();if(next===owner)return !!owner;
    if(owner){try{sessionStorage.removeItem(storageKey(owner));}catch{}}
    owner=next;data=C.fresh();calcResult=null;$('expression').value='';$('result').textContent='0';$('calc-status').textContent='括号优先，先乘除后加减。';$('timer-feedback').textContent='';$('storage-status').textContent='当前标签页保存 · 同标签页刷新可恢复 · 退出登录后清空';
    if(owner){try{data=C.restore(JSON.parse(sessionStorage.getItem(storageKey(owner))),Date.now());}catch{}}
    $('unit-value').value='1';$('unit-category').value='length';units(true);
    $('clock-zone').value=data.clock.zone;$('clock-12h').checked=data.clock.hour12;$('clock-seconds').checked=data.clock.seconds;
    clockQuiet=false;$('clock').classList.toggle('is-quiet',false);$('clock-quiet').setAttribute('aria-pressed','false');$('clock-quiet').textContent='简洁表盘';wallClockKey='';renderWallClock();
    renderCalcMode();renderHistory();renderTimerSettings();renderLaps();renderClocks();return !!owner;
  }
  function selectTool(name,focus=false){
    if(!['calc','timer','watch','convert','clock'].includes(name))return;
    currentTool=name;
    for(const button of panel.querySelectorAll('[data-tool]')){const active=button.dataset.tool===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$(button.dataset.tool).hidden=!active;}
    if(focus)$('tab-'+name).focus();renderClocks();if(name==='clock')renderWallClock();
  }
  function renderHistory(){
    $('history-list').innerHTML=data.history.map((h,i)=>`<button type="button" data-history="${i}" title="重新使用此算式"><span>${escape(h.expression)} · ${h.angle==='rad'?'RAD':'DEG'}</span><strong>= ${escape(h.result)}</strong></button>`).join('')||'<p class="toolkit-empty">还没有计算记录。<br>算过的答案，会留在这里。</p>';
    $('clear-history').disabled=!data.history.length;
  }
  function evaluate(){
    if(!sync()){ $('calc-status').textContent='请先登录。';return; }
    try{const expression=$('expression').value.trim();calcResult=C.calculate(expression,data.calculator.angle);$('result').textContent=String(calcResult);$('calc-status').textContent='已计算，可复制结果或点击历史重用。';data.history=[{expression,result:calcResult,angle:data.calculator.angle},...data.history].slice(0,20);renderHistory();persist();}
    catch(error){calcResult=null;$('result').textContent='—';$('calc-status').textContent=error.message;}
  }
  function key(value){
    const input=$('expression');
    if(value==='='){evaluate();return;}
    if(value==='AC'){input.value='';calcResult=null;$('result').textContent='0';$('calc-status').textContent='已清空算式。';input.focus();return;}
    const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
    if(value==='⌫'){const pos=start===end?Math.max(0,start-1):start;input.setRangeText('',pos,end,'end');}
    else if(input.value.length-(end-start)+value.length<=160)input.setRangeText(value,start,end,'end');
    input.focus();
  }
  function renderCalcMode(){
    const scientific=data.calculator.mode==='scientific';$('science-keys').hidden=!scientific;$('science-hint').hidden=!scientific;$('angle').hidden=!scientific;
    $('mode-basic').setAttribute('aria-pressed',String(!scientific));$('mode-scientific').setAttribute('aria-pressed',String(scientific));$('angle').textContent=data.calculator.angle==='rad'?'RAD · 弧度':'DEG · 角度';
  }
  function scienceKey(action){
    if(['π','e','^'].includes(action)){key(action);return;}
    const input=$('expression'),start=input.selectionStart??0,end=input.selectionEnd??0,selected=start!==end;
    const value=selected?input.value.slice(start,end):input.value;
    const next=action==='square'?`(${value||'0'})^2`:action==='inverse'?`1/(${value||'0'})`:action==='factorial'?`(${value||'0'})!`:value?`${action}(${value})`:`${action}(`;
    const left=selected?start:0,right=selected?end:input.value.length;
    if(input.value.length-(right-left)+next.length>160){$('calc-status').textContent='算式最多 160 个字符。';return;}
    input.setRangeText(next,left,right,'end');input.focus();
  }
  async function copy(value,status){try{if(value===null)throw Error();await navigator.clipboard.writeText(String(value));$(status).textContent='已复制结果。';}catch{$(status).textContent='无法复制，请选中显示的结果手动复制。';}}
  function renderTimerSettings(){
    const seconds=Math.floor(data.timer.total/1000);$('timer-hours').value=Math.floor(seconds/3600);$('timer-minutes').value=Math.floor(seconds/60)%60;$('timer-seconds').value=seconds%60;$('timer-name').value=data.timer.label;$('timer-sound').checked=data.timer.sound;
  }
  function readDuration(){
    const values=['hours','minutes','seconds'].map(id=>Number($('timer-'+id).value));
    if(values.some((n,i)=>!Number.isInteger(n)||n<0||n>(i===0?24:59)))throw Error('请填写有效的时、分、秒整数。');
    const ms=(values[0]*3600+values[1]*60+values[2])*1000;if(ms<1000||ms>86400000)throw Error('请选择 1 秒至 24 小时的时长。');return ms;
  }
  function prepareAudio(){
    if(!data.timer.sound)return;
    try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error();if(!audio)audio=new Audio();audio.resume().catch(()=>{$('timer-feedback').textContent='提示音未能启用，到时仍会显示文字提醒。';});}
    catch{$('timer-feedback').textContent='当前浏览器不支持提示音，到时仍会显示文字提醒。';}
  }
  function alarm(){
    if(!data.timer.sound||!audio||audio.state!=='running')return;
    try{const oscillator=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;oscillator.connect(gain);gain.connect(audio.destination);oscillator.frequency.value=660;gain.gain.setValueAtTime(.001,now);gain.gain.linearRampToValueAtTime(.15,now+.03);gain.gain.exponentialRampToValueAtTime(.001,now+.8);oscillator.start(now);oscillator.stop(now+.85);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}catch{ /* Text notice remains available. */ }
  }
  function timerToggle(){
    if(!sync())return;const t=data.timer,now=Date.now();
    if(t.running){t.remaining=C.remaining(t,now);t.running=false;if(t.remaining===0)t.finished=true;}
    else{
      try{if(t.remaining===t.total||t.finished){t.total=readDuration();t.remaining=t.total;t.label=$('timer-name').value.trim();t.sound=$('timer-sound').checked;}t.end=now+t.remaining;t.running=true;t.finished=false;$('timer-feedback').textContent='切换页面后仍可在顶部查看倒计时。';prepareAudio();}
      catch(error){$('timer-feedback').textContent=error.message;return;}
    }
    persist();renderClocks();
  }
  function timerReset(){
    if(!sync())return;if(data.timer.running&&!confirm('结束当前倒计时并重置？'))return;
    Object.assign(data.timer,{running:false,remaining:data.timer.total,end:0,finished:false});renderTimerSettings();persist();renderClocks();$('timer-feedback').textContent='已重置，可调整时长。';
  }
  function watchToggle(){if(!sync())return;const w=data.watch,now=Date.now();if(w.running){w.elapsed=C.elapsed(w,now);w.running=false;}else{w.started=now;w.running=true;}persist();renderClocks();}
  function lap(){if(!sync()||!data.watch.running||data.watch.laps.length>=50)return;data.watch.laps.push(C.elapsed(data.watch,Date.now()));persist();renderLaps();renderClocks();}
  function renderLaps(){
    const laps=data.watch.laps;let last=0;const rows=laps.map((total,i)=>{const part=total-last;last=total;return {number:i+1,total,part};});
    $('lap-count').textContent=`${rows.length} / 50`;
    $('laps').innerHTML=rows.reverse().map(r=>`<div class="toolkit-lap"><span>${String(r.number).padStart(2,'0')}</span><strong>${C.duration(r.part,true)}</strong><span>${C.duration(r.total,true)}</span></div>`).join('')||'<p class="toolkit-empty">开始秒表后，点击“分段”<br>记录每一小段的用时。</p>';
  }
  function renderClocks(){
    const now=Date.now(),t=data.timer,w=data.watch,ms=C.remaining(t,now),runningOrPaused=t.running||t.remaining<t.total||t.finished;
    showText('timer-display',C.duration(Math.ceil(ms/1000)*1000));showText('timer-label',t.label||'留一点时间');showText('timer-state',t.finished?'时间到了':t.running?'正在计时':t.remaining<t.total?'已暂停':'准备开始');
    showText('timer-toggle',t.running?'暂停':t.finished?'再计一次':t.remaining<t.total?'继续':'开始计时');$('timer-toggle').disabled=!owner;
    $('timer-fields').disabled=t.running||(!t.finished&&t.remaining<t.total);$('timer-ring').style.setProperty('--remaining',String(Math.max(0,Math.min(1,ms/t.total))));
    $('running').hidden=!owner||!runningOrPaused;showText('running-message',t.finished?`${t.label||'倒计时'} · 时间到了`:t.running?(t.label||'倒计时进行中'):'倒计时已暂停');showText('running-time',C.duration(Math.ceil(ms/1000)*1000));
    showText('watch-display',C.duration(C.elapsed(w,now),true));showText('watch-toggle',w.running?'暂停':w.elapsed?'继续':'开始');$('watch-toggle').disabled=!owner;showText('watch-state',w.running?'正在计时':w.elapsed?'已暂停':'准备开始');$('watch-lap').disabled=!w.running||w.laps.length>=50;
  }
  function tick(){if(!sync())return;const t=data.timer;if(t.running&&C.remaining(t,Date.now())<=0){t.running=false;t.remaining=0;t.finished=true;persist();alarm();$('timer-feedback').textContent='时间到了。可以再计一次，或重置时长。';}if(t.running||t.finished||data.watch.running||panel.classList.contains('active'))renderClocks();if(currentTool==='clock'&&panel.classList.contains('active'))renderWallClock();}
  function renderWallClock(){
    const now=Date.now(),settings=data.clock,key=JSON.stringify([Math.floor(now/1000),settings]);if(key===wallClockKey)return;wallClockKey=key;
    const value=C.clockTime(now,settings.zone),pad=n=>String(n).padStart(2,'0');
    showText('clock-digital',`${pad(settings.hour12?(value.hour%12||12):value.hour)}:${pad(value.minute)}${settings.seconds?':'+pad(value.second):''}`);
    $('clock-digital').setAttribute('datetime',new Date(now).toISOString());showText('clock-period',settings.hour12?(value.hour<12?'上午':'下午'):'');showText('clock-date',value.date);showText('clock-zone-label',(settings.zone==='local'?'设备本地 · ':'')+value.zone);
    $('clock-hour').setAttribute('transform',`rotate(${(value.hour%12)*30+value.minute/2+value.second/120} 150 150)`);
    $('clock-minute').setAttribute('transform',`rotate(${value.minute*6+value.second/10} 150 150)`);
    $('clock-second').setAttribute('transform',`rotate(${value.second*6} 150 150)`);$('clock-second').style.display=settings.seconds?'':'none';
  }
  function units(reset=false){
    const category=$('unit-category').value,group=C.units[category].units;
    if(reset){const html=Object.entries(group).map(([id,[label]])=>`<option value="${id}">${label}</option>`).join('');$('unit-from').innerHTML=html;$('unit-to').innerHTML=html;$('unit-from').value=Object.keys(group)[0];$('unit-to').value=Object.keys(group)[1];}
    try{unitResult=C.convert($('unit-value').value,category,$('unit-from').value,$('unit-to').value);$('unit-result').textContent=String(unitResult);$('unit-status').textContent=`${$('unit-value').value} ${group[$('unit-from').value][0]} ≈ ${unitResult} ${group[$('unit-to').value][0]}`;}
    catch(error){unitResult=null;$('unit-result').textContent='—';$('unit-status').textContent=error.message;}
    $('unit-copy').disabled=unitResult===null;
  }
  const keyValues=['AC','(',')','⌫','7','8','9','÷','4','5','6','×','1','2','3','−','0','.','%','+','='];
  $('keys').innerHTML=keyValues.map(k=>`<button type="button" data-key="${k}" class="${k==='='?'is-equals':['÷','×','−','+'].includes(k)?'is-operator':''}"${k==='⌫'?' aria-label="退格"':k==='AC'?' aria-label="清空算式"':''}>${k}</button>`).join('');
  $('keys').addEventListener('click',e=>{const button=e.target.closest('[data-key]');if(button)key(button.dataset.key);});
  $('science-keys').innerHTML=[['square','x²'],['^','xʸ'],['sqrt','√x'],['cbrt','∛x'],['sin','sin'],['cos','cos'],['tan','tan'],['inverse','1/x'],['log','log₁₀'],['ln','ln'],['exp','eˣ'],['factorial','n!'],['π','π'],['e','e'],['abs','|x|']].map(([action,label])=>`<button type="button" data-science="${action}">${label}</button>`).join('');
  $('science-keys').addEventListener('click',e=>{const b=e.target.closest('[data-science]');if(b)scienceKey(b.dataset.science);});
  for(const mode of ['basic','scientific'])$('mode-'+mode).addEventListener('click',()=>{if(!sync())return;data.calculator.mode=mode;renderCalcMode();persist();});
  $('angle').addEventListener('click',()=>{if(!sync())return;data.calculator.angle=data.calculator.angle==='deg'?'rad':'deg';renderCalcMode();persist();$('calc-status').textContent='角度单位已切换，请按 = 重新计算。';});
  $('expression').addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();evaluate();}if(e.key==='Escape')key('AC');});
  $('copy-result').addEventListener('click',()=>copy(calcResult,'calc-status'));
  $('clear-history').addEventListener('click',()=>{if(sync()){data.history=[];persist();renderHistory();}});
    $('history-list').addEventListener('click',e=>{const button=e.target.closest('[data-history]');if(button&&sync()){const row=data.history[Number(button.dataset.history)];if(row){$('expression').value=row.expression;calcResult=row.result;data.calculator.angle=row.angle==='rad'?'rad':'deg';if(/[a-zπ^!]/i.test(row.expression))data.calculator.mode='scientific';renderCalcMode();persist();$('result').textContent=String(row.result);$('expression').focus();}}});
  const tabs=[...panel.querySelectorAll('[data-tool]')];
  tabs.forEach((button,index)=>{button.addEventListener('click',()=>selectTool(button.dataset.tool));button.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(index+1)%tabs.length;if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();selectTool(tabs[next].dataset.tool,true);}});});
  $('timer-toggle').addEventListener('click',timerToggle);$('timer-reset').addEventListener('click',timerReset);
  panel.querySelectorAll('[data-timer-minutes]').forEach(b=>b.addEventListener('click',()=>{if($('timer-fields').disabled)return;$('timer-hours').value=0;$('timer-minutes').value=b.dataset.timerMinutes;$('timer-seconds').value=0;previewTimer();}));
  function previewTimer(){try{if($('timer-fields').disabled||!sync())return;data.timer.total=readDuration();data.timer.remaining=data.timer.total;data.timer.finished=false;data.timer.label=$('timer-name').value.trim();data.timer.sound=$('timer-sound').checked;persist();renderClocks();}catch{/* Keep incomplete input editable; Start will explain the validation error. */}}
  ['timer-hours','timer-minutes','timer-seconds','timer-name','timer-sound'].forEach(id=>$(id).addEventListener('change',previewTimer));
  $('watch-toggle').addEventListener('click',watchToggle);$('watch-lap').addEventListener('click',lap);$('watch-reset').addEventListener('click',()=>{if(!sync())return;if((data.watch.running||data.watch.laps.length)&&!confirm('清空秒表与分段记录？'))return;data.watch=C.fresh().watch;persist();renderLaps();renderClocks();});
  $('unit-category').innerHTML=Object.entries(C.units).map(([id,g])=>`<option value="${id}">${g.label}</option>`).join('');$('unit-category').value='length';
  $('unit-category').addEventListener('change',()=>units(true));['unit-value','unit-from','unit-to'].forEach(id=>$(id).addEventListener('input',()=>units()));
  $('unit-swap').addEventListener('click',()=>{const from=$('unit-from').value;$('unit-from').value=$('unit-to').value;$('unit-to').value=from;if(unitResult!==null)$('unit-value').value=unitResult;units();});$('unit-copy').addEventListener('click',()=>copy(unitResult,'unit-status'));
  $('running-open').addEventListener('click',()=>{document.querySelector('.nav-link[data-view="toolkit"]')?.click();selectTool('timer');});
  $('clock-ticks').innerHTML=Array.from({length:60},(_,i)=>`<line x1="150" y1="${i%5===0?19:23}" x2="150" y2="${i%5===0?31:28}" transform="rotate(${i*6} 150 150)" class="${i%5===0?'is-hour':''}"/>`).join('');
  $('clock-numbers').innerHTML=[12,3,6,9].map(n=>{const angle=n/12*Math.PI*2;return `<text x="${150+Math.sin(angle)*101}" y="${150-Math.cos(angle)*101}">${n}</text>`;}).join('');
  ['clock-zone','clock-12h','clock-seconds'].forEach(id=>$(id).addEventListener('change',()=>{if(!sync())return;data.clock={zone:$('clock-zone').value,hour12:$('clock-12h').checked,seconds:$('clock-seconds').checked};persist();renderWallClock();}));
  $('clock-quiet').addEventListener('click',()=>{clockQuiet=!clockQuiet;$('clock').classList.toggle('is-quiet',clockQuiet);$('clock-quiet').setAttribute('aria-pressed',String(clockQuiet));$('clock-quiet').textContent=clockQuiet?'退出简洁表盘':'简洁表盘';});
  document.getElementById('logout').addEventListener('click',()=>{if(owner){try{sessionStorage.removeItem(storageKey(owner));}catch{}}owner=null;sync();});
  window.addEventListener('storage',e=>{if(e.key==='studyflow.token')sync();});document.addEventListener('visibilitychange',tick);
  new MutationObserver(()=>sync()).observe(document.getElementById('app-view'),{attributes:true,attributeFilter:['class']});
  sync();units(true);selectTool('calc');window.setInterval(tick,100);
})();
