(() => {
  'use strict';
  const P=window.DaynestPocket,$=id=>document.getElementById('pocket-'+id),panel=document.getElementById('panel-toolkit'),recordPanel=document.getElementById('toolkit-record');
  if(!P||!panel)return;
  const token=()=>localStorage.getItem('studyflow.token')||'';
  const status=(id,text)=>{if($(id).textContent!==text)$(id).textContent=text;};
  const size=bytes=>bytes>=1048576?(bytes/1048576).toFixed(2)+' MB':(bytes/1024).toFixed(1)+' KB';
  let owner=token(),imageEpoch=0,image=null,imageFile=null,imageURL='',imageBlob=null,imageBusy=false;
  let micEpoch=0,micPending=false,record=null,audioURL='',audioBlob=null;
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  function dateInputs(){['date-start','date-end','shift-start'].forEach(id=>$(id).value=today());$('shift-days').value=30;$('date-inclusive').checked=false;renderDates();renderShift();}
  function renderDates(){try{const r=P.dateSpan($('date-start').value,$('date-end').value,$('date-inclusive').checked);$('date-result').textContent=r.days+' 天';$('date-detail').textContent=`${r.weeks} 周 ${r.remainder} 天 · 其中周一至周五 ${r.weekdays} 天`;
    status('date-status',r.signed<0?'结束日期早于开始日期；上方显示绝对间隔。':$('date-inclusive').checked?'已包含首尾两天；同一天计为 1 天。':'不含较早日期，包含较晚日期；同一天计为 0 天。');}
    catch(error){$('date-result').textContent='—';$('date-detail').textContent='';status('date-status',error.message);}}
  function renderShift(){try{$('shift-result').textContent=P.shiftDate($('shift-start').value,$('shift-days').value);$('shift-copy').disabled=false;status('shift-status','');}catch(error){$('shift-result').textContent='—';$('shift-copy').disabled=true;status('shift-status',error.message);}}
  function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();}
  function clearImageOutput(){if(imageURL)URL.revokeObjectURL(imageURL);imageURL='';imageBlob=null;$('image-preview').removeAttribute('src');$('image-preview').hidden=true;$('image-empty').hidden=false;$('image-info').textContent='';$('image-download').disabled=true;}
  function imageControls(){$('image-process').disabled=!image||imageBusy;$('image-download').disabled=!imageBlob||imageBusy;$('image-process').textContent=imageBusy?'处理中…':'处理图片';$('image-quality').disabled=$('image-format').value==='image/png';$('image-quality-label').textContent=$('image-format').value==='image/png'?'PNG 不使用质量参数':$('image-quality').value+'%';}
  function clearImage(){imageEpoch++;if(image)image.src='';image=null;imageFile=null;imageBusy=false;$('image-file').value='';clearImageOutput();imageControls();status('image-status','图片只在本机处理，不会上传。');}
  async function chooseImage(file){
    clearImage();if(!sync()||!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1048576||file.size===0){status('image-status','请选择 15 MB 以内的 JPEG、PNG 或 WebP 图片。');return;}
    const epoch=++imageEpoch,account=owner,url=URL.createObjectURL(file),candidate=new Image();status('image-status','正在读取图片…');
    try{await new Promise((resolve,reject)=>{candidate.onload=resolve;candidate.onerror=()=>reject(Error('无法读取图片，文件可能已损坏或格式不受支持。'));candidate.src=url;});
      if(epoch!==imageEpoch||account!==token()){candidate.src='';return;}
      P.fitImage(candidate.naturalWidth,candidate.naturalHeight,$('image-edge').value);image=candidate;imageFile=file;status('image-status',`${file.name} · ${candidate.naturalWidth} × ${candidate.naturalHeight} · ${size(file.size)}`);imageControls();
    }catch(error){candidate.src='';if(epoch===imageEpoch&&account===token())status('image-status',error.message);}
    finally{URL.revokeObjectURL(url);}
  }
  async function processImage(){
    if(!sync()||!image||imageBusy)return;
    const epoch=++imageEpoch,account=owner,original=imageFile,source=image;imageBusy=true;clearImageOutput();imageControls();status('image-status','正在本机处理图片…');
    const canvas=document.createElement('canvas');
    try{const dimensions=P.fitImage(source.naturalWidth,source.naturalHeight,$('image-edge').value),type=$('image-format').value;
      const quality=Number($('image-quality').value)/100;if(!['image/jpeg','image/webp','image/png'].includes(type)||!Number.isFinite(quality)||quality<.3||quality>.95)throw Error('图片参数无效。');
      canvas.width=dimensions.width;canvas.height=dimensions.height;const context=canvas.getContext('2d');if(!context)throw Error('浏览器无法创建图片画布。');
      if(type==='image/jpeg'){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);}context.drawImage(source,0,0,canvas.width,canvas.height);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('图片编码失败，请换个格式重试。')),type,quality));
      if(epoch!==imageEpoch||account!==token())return;
      imageBlob=blob;imageURL=URL.createObjectURL(blob);$('image-preview').src=imageURL;$('image-preview').hidden=false;$('image-empty').hidden=true;
      const change=(1-blob.size/original.size)*100;$('image-info').textContent=`${original.size?size(original.size):'—'} → ${size(blob.size)} · ${dimensions.width} × ${dimensions.height} · ${change>=0?'减少 '+change.toFixed(1)+'%':'比原图增加 '+(-change).toFixed(1)+'%'} · ${blob.type.replace('image/','').toUpperCase()}`;
      status('image-status',blob.type===type?'已处理完成，原文件未改动。':'浏览器不支持所选格式，已使用 '+blob.type+'；下载扩展名将匹配实际格式。');
    }catch(error){if(epoch===imageEpoch&&account===token())status('image-status',error.message);}
    finally{canvas.width=0;canvas.height=0;if(epoch===imageEpoch){imageBusy=false;imageControls();}}
  }
  function resetImageOptions(){if(image||imageBusy)imageEpoch++;imageBusy=false;clearImageOutput();imageControls();if(image)status('image-status','参数已改变，请重新处理图片。');}
  function release(stream){if(stream)stream.getTracks().forEach(track=>track.stop());}
  function elapsed(r){return r.elapsed+(r.running?Math.max(0,performance.now()-r.started):0);}
  function showElapsed(ms){const seconds=Math.floor(ms/1000);$('record-time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
  function clearAudio(){if(audioURL)URL.revokeObjectURL(audioURL);audioURL='';audioBlob=null;$('record-preview').pause();$('record-preview').removeAttribute('src');$('record-preview').load();$('record-preview').hidden=true;$('record-info').textContent='尚无录音。录完可试听，再下载到本机。';recordControls();}
  function recordControls(){
    const busy=!!record||micPending;$('record-start').disabled=busy;$('record-start').textContent=micPending?'等待麦克风授权…':'开始录音';$('record-stop').disabled=!busy||!!record?.stopping;
    $('record-pause').disabled=!record||record.stopping||record.transition;$('record-pause').textContent=record&&!record.running?'继续':'暂停';$('record-download').disabled=!audioBlob||busy;$('record-clear').disabled=!audioBlob||busy;
    $('record-mark').classList.toggle('is-recording',!!record?.running&&!record?.stopping);
  }
  function stopRecording(reason='录音已结束。'){
    if(micPending){micEpoch++;micPending=false;status('record-status','已取消等待授权。');recordControls();return;}
    const r=record;if(!r||r.stopping)return;r.elapsed=elapsed(r);r.running=false;r.stopping=true;r.reason=reason;showElapsed(r.elapsed);recordControls();
    try{if(r.media.state!=='inactive')r.media.stop();}catch{r.failed=true;finishRecording(r);}finally{release(r.stream);}
  }
  function finishRecording(r){
    release(r.stream);if(record!==r||r.epoch!==micEpoch||r.account!==token())return;r.elapsed=elapsed(r);r.running=false;showElapsed(r.elapsed);record=null;
    if(r.chunks.length){const blob=new Blob(r.chunks,{type:r.media.mimeType||r.chunks[0].type||'audio/webm'});if(blob.size){audioBlob=blob;audioURL=URL.createObjectURL(blob);$('record-preview').src=audioURL;$('record-preview').hidden=false;$('record-info').textContent=`${size(blob.size)} · ${P.audioExtension(blob.type).toUpperCase()} · 仅在当前页面暂存，请下载保存。`;}}
    status('record-status',r.failed?'录音遇到错误；若有内容可先试听并下载。':audioBlob?(r.reason||'录音已结束，可以试听或下载。'):'没有收到音频数据，请检查麦克风后重试。');r.chunks=[];recordControls();
  }
  async function startRecording(){
    if(!sync()||record||micPending||recordPanel.hidden||document.hidden)return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status('record-status','此浏览器无法录音。请使用支持录音的浏览器，通过 HTTPS 或 localhost 打开。');return;}
    if(audioBlob&&!confirm('重新录制将清除当前录音，请确认已经下载保存。'))return;
    const epoch=++micEpoch,account=owner;micPending=true;recordControls();status('record-status','等待麦克风授权，可点击“结束”取消等待。');let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(epoch!==micEpoch||account!==token()||recordPanel.hidden||document.hidden||!panel.classList.contains('active')){release(stream);return;}
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>window.MediaRecorder.isTypeSupported(type));
      const media=mime?new window.MediaRecorder(stream,{mimeType:mime}):new window.MediaRecorder(stream);
      const r={media,stream,epoch,account,chunks:[],bytes:0,elapsed:0,started:performance.now(),running:true,stopping:false,transition:false,failed:false};
      clearAudio();record=r;
      media.ondataavailable=event=>{if(r.epoch!==micEpoch||r.account!==token())return;if(event.data?.size){r.chunks.push(event.data);r.bytes+=event.data.size;if(r.bytes>=50*1048576)stopRecording('已达到约 50 MB 上限，录音已结束。');}};
      media.onstop=()=>finishRecording(r);media.onerror=()=>{r.failed=true;stopRecording('录音发生错误。');};
      media.onpause=media.onresume=()=>{if(record===r){r.transition=false;recordControls();}};
      stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(record===r)stopRecording('麦克风已断开，录音已结束。');}));
      media.start(1000);status('record-status','正在录音 · 离开工具会自动结束');$('record-time').textContent='00:00';
    }catch(error){release(stream);if(epoch===micEpoch&&account===token()){record=null;const messages={NotAllowedError:'麦克风权限被拒绝。可在浏览器站点设置中授权后重试。',NotFoundError:'未找到麦克风，请连接设备后重试。',NotReadableError:'麦克风不可用，可能正被其他应用占用。'};status('record-status',messages[error.name]||'录音启动失败，请确认浏览器和麦克风可用后重试。');}}
    finally{if(epoch===micEpoch){micPending=false;recordControls();}}
  }
  function pauseRecording(){
    const r=record;if(!sync()||!r||r.stopping||r.transition)return;
    try{r.transition=true;if(r.running){r.media.pause();r.elapsed=elapsed(r);r.running=false;}else{r.media.resume();r.started=performance.now();r.running=true;}status('record-status',r.running?'正在录音 · 离开工具会自动结束':'已暂停 · 点击继续恢复录音');}
    catch{r.transition=false;status('record-status','当前浏览器未能暂停或恢复，请结束录音后重试。');}recordControls();
  }
  function cleanup(){
    micEpoch++;micPending=false;const r=record;record=null;if(r){try{if(r.media.state!=='inactive')r.media.stop();}catch{}release(r.stream);r.chunks=[];}
    clearAudio();clearImage();$('record-time').textContent='00:00';$('record-name').value='';status('record-status','点击开始后才会请求麦克风权限。');
  }
  function sync(){const next=token();if(next!==owner){owner=next;cleanup();dateInputs();}return !!owner;}
  function leave(){if(recordPanel.hidden||!panel.classList.contains('active')||document.hidden){stopRecording('已离开录音工具，录音自动结束。');$('record-preview').pause();}}
  ['date-start','date-end','date-inclusive'].forEach(id=>$(id).addEventListener('input',renderDates));$('date-today').addEventListener('click',dateInputs);
  ['shift-start','shift-days'].forEach(id=>$(id).addEventListener('input',renderShift));panel.querySelectorAll('[data-day-offset]').forEach(b=>b.addEventListener('click',()=>{$('shift-days').value=b.dataset.dayOffset;renderShift();}));
  $('shift-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('shift-result').textContent);status('shift-status','日期已复制。');}catch{status('shift-status','无法复制，请手动选中目标日期复制。');}});
  $('image-file').addEventListener('change',()=>chooseImage($('image-file').files[0]));$('image-process').addEventListener('click',processImage);$('image-clear').addEventListener('click',clearImage);
  ['image-edge','image-format','image-quality'].forEach(id=>$(id).addEventListener('input',resetImageOptions));
  $('image-download').addEventListener('click',()=>{if(!sync()||!imageBlob)return;const ext={'image/png':'png','image/webp':'webp','image/jpeg':'jpg'}[imageBlob.type]||'png';download(imageURL,P.fileBase(imageFile.name)+'-轻量.'+ext);});
  $('record-start').addEventListener('click',startRecording);$('record-pause').addEventListener('click',pauseRecording);$('record-stop').addEventListener('click',()=>stopRecording());
  $('record-download').addEventListener('click',()=>{if(sync()&&audioBlob)download(audioURL,P.fileBase($('record-name').value||'录音-'+today())+'.'+P.audioExtension(audioBlob.type));});
  $('record-clear').addEventListener('click',()=>{if(record||micPending||!sync())return;if(confirm('清空当前录音？如需保留请先下载。')){clearAudio();$('record-time').textContent='00:00';status('record-status','已清空，可以重新录音。');}});
  new MutationObserver(()=>{sync();leave();}).observe(panel,{attributes:true,attributeFilter:['class']});new MutationObserver(leave).observe(recordPanel,{attributes:true,attributeFilter:['hidden']});
  new MutationObserver(sync).observe(document.getElementById('app-view'),{attributes:true,attributeFilter:['class']});
  document.getElementById('logout').addEventListener('click',()=>{cleanup();owner=token();dateInputs();});window.addEventListener('storage',e=>{if(e.key==='studyflow.token')sync();});document.addEventListener('visibilitychange',()=>{sync();leave();});
  window.addEventListener('pagehide',cleanup);window.addEventListener('beforeunload',e=>{if(record||micPending||audioBlob){e.preventDefault();e.returnValue='';}});
  window.setInterval(()=>{sync();const r=record;if(!r)return;const ms=elapsed(r);showElapsed(ms);if(ms>=1800000)stopRecording('已达到 30 分钟上限，录音已结束。');},250);
  dateInputs();imageControls();recordControls();
})();
