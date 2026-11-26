(() => {
  'use strict';
  const P=window.DaynestPocket,$=id=>document.getElementById('pocket-'+id);
  if(!P||!$('image-file'))return;
  const token=()=>localStorage.getItem('studyflow.token')||'';
  const status=(id,text)=>{if($(id).textContent!==text)$(id).textContent=text;};
  const size=bytes=>bytes>=1048576?(bytes/1048576).toFixed(2)+' MB':(bytes/1024).toFixed(1)+' KB';
  let owner=token(),imageEpoch=0,image=null,imageFile=null,imageURL='',imageBlob=null,imageBusy=false;
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
  function sync(){const next=token();if(next!==owner){owner=next;clearImage();}return !!owner;}
  $('image-file').addEventListener('change',()=>chooseImage($('image-file').files[0]));$('image-process').addEventListener('click',processImage);$('image-clear').addEventListener('click',clearImage);
  ['image-edge','image-format','image-quality'].forEach(id=>$(id).addEventListener('input',resetImageOptions));
  $('image-download').addEventListener('click',()=>{if(!sync()||!imageBlob)return;const ext={'image/png':'png','image/webp':'webp','image/jpeg':'jpg'}[imageBlob.type]||'png';download(imageURL,P.fileBase(imageFile.name)+'-轻量.'+ext);});
  new MutationObserver(sync).observe(document.getElementById('app-view'),{attributes:true,attributeFilter:['class']});
  document.addEventListener('daynest:account-leaving',clearImage);
  window.addEventListener('storage',event=>{if(event.key==='studyflow.token'||event.key===null)sync();});
  window.addEventListener('pagehide',clearImage);
  imageControls();
})();
