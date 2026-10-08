// Browser APIs are simulated: never requests a real microphone or reads personal files.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {Blob}=require('node:buffer');
const root='internal/httpapi/assets/',html=fs.readFileSync(root+'index.html','utf8');
const core=fs.readFileSync(root+'toolkit-pocket-core.js','utf8'),script=fs.readFileSync(root+'toolkit-pocket.js','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for(const match of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('pocket-'+match[1]),'missing DOM '+match[1]);
for(const asset of ['toolkit-pocket.css','toolkit-pocket-core.js','toolkit-pocket.js'])assert(html.includes('/static/'+asset)&&fs.existsSync(root+asset));
assert(html.indexOf('/static/toolkit-pocket-core.js')<html.indexOf('/static/toolkit-pocket.js'));
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(){
  let account='user-one',now=0,urlID=0;
  const elements=new Map(),observers=[],intervals=[],windowEvents={},documentEvents={},urls=new Set(),downloads=[],recorders=[],streams=[];
  const options={permissionError:null,deferPermission:false,permissionResolve:null,deferImage:false,decode:null,deferBlob:false,encode:null,outputType:null,failBlob:false};
  function el(id){
    if(!elements.has(id)){
      assert(ids.has(id),'unknown element '+id);
      const classes=new Set(id==='panel-toolkit'?['active']:[]);
      elements.set(id,{id,value:'',checked:false,hidden:false,disabled:false,textContent:'',dataset:{},listeners:{},files:[],
        classList:{contains:c=>classes.has(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c);}},
        addEventListener(type,fn){this.listeners[type]=fn;},removeAttribute(k){delete this[k];},pause(){},load(){},
        querySelectorAll(){return[];}});
    }
    return elements.get(id);
  }
  const E=id=>el('pocket-'+id);
  E('image-edge').value='1920';E('image-format').value='image/jpeg';E('image-quality').value='82';
  function stream(){const track={stopped:false,stop(){this.stopped=true;},addEventListener(type,fn){this[type]=fn;}};const s={getTracks:()=>[track],track};streams.push(s);return s;}
  class Recorder{
    static isTypeSupported(type){return type==='audio/webm;codecs=opus';}
    constructor(s,opts={}){this.stream=s;this.mimeType=opts.mimeType||'audio/webm';this.state='inactive';recorders.push(this);}
    start(){this.state='recording';}
    pause(){assert.equal(this.state,'recording');this.state='paused';queueMicrotask(()=>this.onpause?.());}
    resume(){assert.equal(this.state,'paused');this.state='recording';queueMicrotask(()=>this.onresume?.());}
    stop(){assert.notEqual(this.state,'inactive');this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['final audio'],{type:this.mimeType})});this.onstop?.();});}
  }
  class Picture{
    constructor(){this.naturalWidth=4000;this.naturalHeight=3000;}
    set src(value){this.source=value;if(!value)return;const decode=()=>this.onload?.();if(options.deferImage)options.decode=decode;else queueMicrotask(decode);}
  }
  const navigator={clipboard:{writeText:async()=>{}},mediaDevices:{async getUserMedia(){if(options.permissionError)throw options.permissionError;if(options.deferPermission)return new Promise(resolve=>options.permissionResolve=()=>resolve(stream()));return stream();}}};
  const window={isSecureContext:true,MediaRecorder:Recorder,addEventListener:(type,fn)=>windowEvents[type]=fn,setInterval:fn=>intervals.push(fn)};
  const document={hidden:false,getElementById:el,addEventListener:(type,fn)=>documentEvents[type]=fn,body:{appendChild(){}},createElement(type){
    if(type==='a')return {click(){downloads.push({url:this.href,name:this.download});},remove(){}};
    assert.equal(type,'canvas');return {width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toBlob(fn,type){const encode=()=>fn(options.failBlob?null:new Blob(['encoded image'],{type:options.outputType||type}));if(options.deferBlob)options.encode=encode;else queueMicrotask(encode);}};
  }};
  const context=vm.createContext({window,document,navigator,Blob,Image:Picture,Date,console,confirm:()=>true,performance:{now:()=>now},localStorage:{getItem:()=>account},
    URL:{createObjectURL(){const url='blob:test-'+(++urlID);urls.add(url);return url;},revokeObjectURL:url=>urls.delete(url)},
    MutationObserver:class{constructor(fn){this.fn=fn;}observe(target){observers.push({target,fn:this.fn});}}});
  vm.runInContext(core,context);vm.runInContext(script,context);
  return {P:window.DaynestPocket,E,el,options,window,document,navigator,urls,downloads,recorders,streams,context,
    click:id=>E(id).listeners.click(),input:id=>E(id).listeners.input(),
    image:async(file={name:'holiday.png',type:'image/png',size:1024})=>{E('image-file').files=[file];return E('image-file').listeners.change();},
    advance(ms){now+=ms;intervals.forEach(fn=>fn());},
    leave(){el('toolkit-record').hidden=true;observers.filter(o=>o.target===el('toolkit-record')).forEach(o=>o.fn());},
    enter(){el('toolkit-record').hidden=false;},
    account(value){account=value;windowEvents.storage({key:'studyflow.token'});},
    hide(){document.hidden=true;documentEvents.visibilitychange();},
    unload(){windowEvents.pagehide();},windowEvents};
}
(async()=>{
  const h=harness(),{P,E}=h;
  assert.equal(P.dateSpan('2024-02-28','2024-03-01').days,2);
  assert.equal(P.dateSpan('2026-03-07','2026-03-09').days,2); // US DST transition
  assert.equal(P.dateSpan('2026-10-09','2026-10-09').days,0);
  assert.equal(P.dateSpan('2026-10-09','2026-10-09',true).weekdays,1);
  assert.equal(P.dateSpan('2026-10-10','2026-10-10',true).weekdays,0);
  assert.equal(P.dateSpan('2026-10-12','2026-10-09').signed,-3);
  assert.equal(P.dateSpan('2026-10-09','2026-10-12').weekdays,1);
  assert.equal(P.dateSpan('2026-10-05','2026-10-18',true).weekdays,10);
  for(const date of ['2023-02-29','1900-02-29','2026-13-01','2026-04-31','1899-01-01','2201-01-01','',null])assert.throws(()=>P.parseDate(date));
  assert.equal(P.shiftDate('2024-02-28',1),'2024-02-29');assert.equal(P.shiftDate('2026-01-01',-1),'2025-12-31');
  for(const offset of ['',1.5,36501,Infinity])assert.throws(()=>P.shiftDate('2026-01-01',offset));
  assert.throws(()=>P.shiftDate('2200-12-31',1));assert.throws(()=>P.shiftDate('1900-01-01',-1));
  assert.equal(P.fitImage(4000,3000,1920).height,1440);assert.equal(P.fitImage(100,50,640).width,100);
  assert.throws(()=>P.fitImage(6000,6000,1920));assert.throws(()=>P.fitImage(0,10,640));assert.throws(()=>P.fitImage(100,100,999));
  assert.equal(P.fileBase('my:photo.png'),'my_photo');assert.equal(P.audioExtension('audio/mp4'),'m4a');assert.equal(P.audioExtension('audio/ogg;codecs=opus'),'ogg');
  E('date-start').value='2024-02-28';E('date-end').value='2024-03-01';h.input('date-start');assert.equal(E('date-result').textContent,'2 天');
  E('date-inclusive').checked=true;h.input('date-inclusive');assert.equal(E('date-result').textContent,'3 天');
  E('shift-days').value='';h.input('shift-days');assert(E('shift-copy').disabled);

  await h.image();assert(!E('image-process').disabled);await h.click('image-process');assert(!E('image-download').disabled);assert.match(E('image-info').textContent,/1920 × 1440/);
  h.click('image-download');assert.equal(h.downloads.at(-1).name,'holiday-轻量.jpg');assert.equal(h.urls.size,1);
  E('image-format').value='image/png';h.input('image-format');assert(E('image-quality').disabled);assert(E('image-download').disabled);assert.equal(h.urls.size,0);
  h.options.outputType='image/png';E('image-format').value='image/webp';await h.click('image-process');h.click('image-download');assert.match(h.downloads.at(-1).name,/\.png$/);assert.match(E('image-status').textContent,/不支持/);
  h.options.failBlob=true;await h.click('image-process');assert(E('image-download').disabled);assert.match(E('image-status').textContent,/编码失败/);h.options.failBlob=false;
  h.click('image-clear');assert.equal(h.urls.size,0);await h.image({name:'bad.gif',type:'image/gif',size:500});assert(E('image-process').disabled);
  await h.image({name:'big.jpg',type:'image/jpeg',size:16*1048576});assert(E('image-process').disabled);
  h.options.deferImage=true;const loading=h.image();E('image-edge').value='640';h.input('image-edge');h.options.decode();await loading;assert(!E('image-process').disabled); // option change during decode
  h.options.deferImage=false;h.options.deferBlob=true;const processing=h.click('image-process');h.account('user-two');h.options.encode();await processing;assert(E('image-download').disabled);assert.equal(h.urls.size,0);

  h.options.permissionError={name:'NotAllowedError'};await h.click('record-start');assert.match(E('record-status').textContent,/权限被拒绝/);assert(!E('record-start').disabled);
  h.options.permissionError=null;h.options.deferPermission=true;const pending=h.click('record-start');assert(E('record-start').disabled);h.leave();h.options.permissionResolve();await pending;assert(h.streams.at(-1).track.stopped);assert.equal(h.recorders.length,0);
  h.options.deferPermission=false;h.enter();await h.click('record-start');assert.equal(h.recorders.at(-1).state,'recording');h.advance(3000);assert.equal(E('record-time').textContent,'00:03');
  h.click('record-pause');await settle();h.advance(7000);assert.equal(E('record-time').textContent,'00:03');h.click('record-pause');await settle();h.advance(2000);assert.equal(E('record-time').textContent,'00:05');
  h.click('record-stop');assert(h.streams.at(-1).track.stopped);await settle();assert(!E('record-preview').hidden);assert(!E('record-download').disabled);assert.equal(E('record-time').textContent,'00:05');
  E('record-name').value='my:voice';h.click('record-download');assert.equal(h.downloads.at(-1).name,'my_voice.webm');assert.equal(h.urls.size,1);
  h.options.permissionError={name:'NotFoundError'};await h.click('record-start');assert(!E('record-download').disabled);assert.equal(h.urls.size,1); // denial retains previous audio
  h.options.permissionError=null;await h.click('record-start');assert.equal(h.urls.size,0);h.advance(1800000);await settle();assert.match(E('record-status').textContent,/30 分钟/);assert(h.streams.at(-1).track.stopped);
  await h.click('record-start');h.leave();await settle();assert(!E('record-download').disabled);assert(h.streams.at(-1).track.stopped);
  h.enter();await h.click('record-start');h.account('user-three');await settle();assert(E('record-download').disabled);assert(h.streams.at(-1).track.stopped);assert.equal(h.urls.size,0);
  await h.click('record-start');h.hide();await settle();assert(h.streams.at(-1).track.stopped);assert(!E('record-download').disabled);
  h.unload();assert.equal(h.urls.size,0);assert(E('record-download').disabled);
  const unsupported=harness();unsupported.window.isSecureContext=false;await unsupported.click('record-start');assert.match(unsupported.E('record-status').textContent,/HTTPS/);assert.equal(unsupported.streams.length,0);
  console.log('Pocket tools passed: date boundaries/DST/weekdays, image validation/encoding/cancellation/URLs, mic permissions/pause/resume/final chunks/limits/navigation/account cleanup (mocked browser APIs).');
})().catch(error=>{console.error(error);process.exitCode=1;});
