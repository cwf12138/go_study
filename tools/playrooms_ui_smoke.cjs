const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'../internal/httpapi/assets'),nodes=new Map(),storage=new Map(),timers=new Map();let timerID=0,random=[0],contexts=[];
const token=name=>'header.'+Buffer.from(JSON.stringify({sub:name})).toString('base64url')+'.signature';storage.set('studyflow.token',token('alice'));
function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='#sound-timer'?'15':'',checked:false,style:{},dataset:{},handlers:{},classList:{add(){},remove(){}},addEventListener(n,f){this.handlers[n]=f;},getContext(){return null;}});return nodes.get(id);}
const param=()=>({value:0,setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){}}),audioNode=()=>({gain:param(),frequency:param(),threshold:param(),ratio:param(),connect(){},start(){}});
let resumeImpl=()=>Promise.resolve();class AudioContext{constructor(){this.sampleRate=10;this.currentTime=0;this.state='running';contexts.push(this);}createGain(){return audioNode();}createDynamicsCompressor(){return audioNode();}createBiquadFilter(){return audioNode();}createOscillator(){return audioNode();}createBufferSource(){return audioNode();}createBuffer(){return {getChannelData:()=>new Float32Array(40)};}resume(){return resumeImpl();}close(){this.closed=true;return Promise.resolve();}}
const context={document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){}},window:{AudioContext,addEventListener(){},confirm:()=>true,matchMedia:()=>({matches:true})},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},atob:s=>Buffer.from(s,'base64').toString(),crypto:{getRandomValues:b=>{b[0]=random.length>1?random.shift():random[0];}},MutationObserver:class{observe(){}},setTimeout:f=>{timers.set(++timerID,f);return timerID;},clearTimeout:id=>timers.delete(id)};
vm.createContext(context);let source=fs.readFileSync(path.join(root,'playrooms.js'),'utf8');source=source.replace('sync();renderSound();renderChoice();\n})();','sync();renderSound();renderChoice();window.test={state,optionsOf,randomIndex,start,stop,spin,sync,renderSound};\n})();');vm.runInContext(source,context);const api=context.window.test;
const flush=()=>{const all=[...timers.values()];timers.clear();all.forEach(f=>f());};
(async()=>{
 assert.deepEqual(Array.from(api.optionsOf(' A\nA\n B ')),['A','B']);assert.throws(()=>api.optionsOf('one'));assert.throws(()=>api.optionsOf('a'.repeat(81)+'\nb'));assert.throws(()=>api.optionsOf(Array.from({length:41},(_,i)=>i).join('\n')));
 random=[4294967295,4];assert.equal(api.randomIndex(3),1);random=[0];
 api.state.options='A\nB';api.state.unique=true;api.spin();api.spin();assert.equal(timers.size,1);flush();assert.equal(api.state.history.length,1);api.spin();flush();assert.equal(api.state.used.length,2);api.spin();assert.equal(timers.size,0);assert(node('#choice-status').textContent.includes('抽完'));
 node('#choice-reset').handlers.click();assert.equal(api.state.used.length,0);api.state.unique=false;for(let i=0;i<35;i++){api.spin();flush();}assert.equal(api.state.history.length,30);
 api.state.scenes=[{name:'<img src=x>',levels:[1,2,3,4],master:25}];api.renderSound();assert(!node('#sound-scenes').innerHTML.includes('<img'));assert(node('#sound-scenes').innerHTML.includes('&lt;img'));
 api.spin();storage.set('studyflow.token',token('bob'));flush();assert.equal(api.state.history.length,0);assert.equal(api.state.scenes.length,0);
 await api.start();assert.equal(node('#sound-start').disabled,true);assert.equal(timers.size,1);flush();assert(contexts.at(-1).closed);assert.equal(node('#sound-start').disabled,false);
 let release;resumeImpl=()=>new Promise(r=>release=r);const pending=api.start();const old=contexts.at(-1);api.stop();resumeImpl=()=>Promise.resolve();await api.start();release();await pending;assert(old.closed);assert.equal(node('#sound-start').disabled,true);assert(!contexts.at(-1).closed);
 storage.set('studyflow.token',token('carol'));api.sync();assert(contexts.at(-1).closed);assert.equal(api.state.history.length,0);
 resumeImpl=()=>Promise.reject(Error('blocked'));await api.start();assert(node('#sound-status').textContent.includes('播放失败'));assert.equal(node('#sound-start').disabled,false);
 context.localStorage.getItem=()=>{throw Error('denied');};assert.doesNotThrow(()=>api.sync());await api.start();assert(node('#sound-status').textContent.includes('登录'));
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const id of nodes.keys())assert(html.includes(`id="${id.slice(1)}"`),id);
 console.log('Playrooms passed: validation, unbiased sampling, unique rounds, history cap, escaping, account isolation, audio lifecycle/timer, failed playback and storage denial.');
})().catch(e=>{console.error(e);process.exitCode=1;});
