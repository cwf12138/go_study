// Browser APIs are simulated: does not read personal files.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {Blob}=require('node:buffer');
const root='internal/httpapi/assets/',html=fs.readFileSync(root+'index.html','utf8');
const core=fs.readFileSync(root+'toolkit-pocket-core.js','utf8'),script=fs.readFileSync(root+'toolkit-pocket.js','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for(const match of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('pocket-'+match[1]),'missing DOM '+match[1]);
for(const asset of ['toolkit-pocket.css','toolkit-pocket-core.js','toolkit-pocket.js'])assert(html.includes('/static/'+asset)&&fs.existsSync(root+asset));
assert(html.indexOf('/static/toolkit-pocket-core.js')<html.indexOf('/static/toolkit-pocket.js'));
function harness(){
  let account='user-one',urlID=0;
  const elements=new Map(),observers=[],windowEvents={},documentEvents={},urls=new Set(),downloads=[];
  const options={deferImage:false,decode:null,deferBlob:false,encode:null,outputType:null,failBlob:false};
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
  class Picture{
    constructor(){this.naturalWidth=4000;this.naturalHeight=3000;}
    set src(value){this.source=value;if(!value)return;const decode=()=>this.onload?.();if(options.deferImage)options.decode=decode;else queueMicrotask(decode);}
  }
  const window={addEventListener:(type,fn)=>windowEvents[type]=fn};
  const document={hidden:false,getElementById:el,addEventListener:(type,fn)=>documentEvents[type]=fn,body:{appendChild(){}},createElement(type){
    if(type==='a')return {click(){downloads.push({url:this.href,name:this.download});},remove(){}};
    assert.equal(type,'canvas');return {width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toBlob(fn,type){const encode=()=>fn(options.failBlob?null:new Blob(['encoded image'],{type:options.outputType||type}));if(options.deferBlob)options.encode=encode;else queueMicrotask(encode);}};
  }};
  const context=vm.createContext({window,document,Blob,Image:Picture,Date,console,localStorage:{getItem:()=>account},
    URL:{createObjectURL(){const url='blob:test-'+(++urlID);urls.add(url);return url;},revokeObjectURL:url=>urls.delete(url)},
    MutationObserver:class{constructor(fn){this.fn=fn;}observe(target){observers.push({target,fn:this.fn});}}});
  vm.runInContext(core,context);vm.runInContext(script,context);
  return {P:window.DaynestPocket,E,el,options,window,document,urls,downloads,context,
    click:id=>E(id).listeners.click(),input:id=>E(id).listeners.input(),
    image:async(file={name:'holiday.png',type:'image/png',size:1024})=>{E('image-file').files=[file];return E('image-file').listeners.change();},
    account(value){account=value;windowEvents.storage({key:'studyflow.token'});},
    unload(){windowEvents.pagehide();},windowEvents};
}
(async()=>{
  const h=harness(),{P,E}=h;
  assert.equal(P.fitImage(4000,3000,1920).height,1440);assert.equal(P.fitImage(100,50,640).width,100);
  assert.throws(()=>P.fitImage(6000,6000,1920));assert.throws(()=>P.fitImage(0,10,640));assert.throws(()=>P.fitImage(100,100,999));
  assert.equal(P.fileBase('my:photo.png'),'my_photo');
  assert.equal(P.fileBase('10.09 会议',false),'10.09 会议');assert.equal(P.fileBase('CON',false),'_CON');assert.equal(P.fileBase('voice. ',false),'voice');

  await h.image();assert(!E('image-process').disabled);await h.click('image-process');assert(!E('image-download').disabled);assert.match(E('image-info').textContent,/1920 × 1440/);
  h.click('image-download');assert.equal(h.downloads.at(-1).name,'holiday-轻量.jpg');assert.equal(h.urls.size,1);
  E('image-format').value='image/png';h.input('image-format');assert(E('image-quality').disabled);assert(E('image-download').disabled);assert.equal(h.urls.size,0);
  h.options.outputType='image/png';E('image-format').value='image/webp';await h.click('image-process');h.click('image-download');assert.match(h.downloads.at(-1).name,/\.png$/);assert.match(E('image-status').textContent,/不支持/);
  h.options.failBlob=true;await h.click('image-process');assert(E('image-download').disabled);assert.match(E('image-status').textContent,/编码失败/);h.options.failBlob=false;
  h.click('image-clear');assert.equal(h.urls.size,0);await h.image({name:'bad.gif',type:'image/gif',size:500});assert(E('image-process').disabled);
  await h.image({name:'big.jpg',type:'image/jpeg',size:16*1048576});assert(E('image-process').disabled);
  h.options.deferImage=true;const loading=h.image();E('image-edge').value='640';h.input('image-edge');h.options.decode();await loading;assert(!E('image-process').disabled); // option change during decode
  h.options.deferImage=false;h.options.deferBlob=true;const processing=h.click('image-process');h.account('user-two');h.options.encode();await processing;assert(E('image-download').disabled);assert.equal(h.urls.size,0);

  h.unload();assert.equal(h.urls.size,0);assert(E('image-download').disabled);
  assert(!script.includes('getUserMedia'));
  console.log('Image tools passed: validation, encoding, cancellation, object URL and account cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
