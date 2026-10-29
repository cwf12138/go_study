const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='internal/httpapi/assets/',html=fs.readFileSync(root+'index.html','utf8'),core=fs.readFileSync(root+'diagnostics-core.js','utf8'),source=fs.readFileSync(root+'diagnostics.js','utf8');
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));for(const [,id]of source.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('dg-'+id),id);
const zero='0001-01-01T00:00:00Z',now=new Date().toISOString();
function sample(){return {application:'daynest',server_time:now,mobile_protocol:1,build:{version:'dev',commit:'unknown',dirty:null},runtime:{go:'go1.25.6',os:'windows',arch:'amd64',uptime_seconds:10},security:{development_key:true,ai_requires_loopback:true},persistence:{mode:'periodic_json',observed:true,state:'awaiting_first_write',interval_seconds:15,response_means_immediate_disk_write:false,observation:{last_attempt_at:zero,last_success_at:zero,last_failure_at:zero,loaded_at:now,loaded_snapshot_at:now,recovered_from_backup:false,in_progress:false,last_result:'not_attempted',last_duration_ms:0,consecutive_failures:0}},backup:{json_includes_transfer_files:false,json_includes_transfer_metadata:false,complete_backup_requires_stopped_service:true,restore_verified:false}};}
function harness(){
 const nodes=new Map(),events={},downloads=[];let owner='alice',data=sample(),fail=false,release,defer=false;
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',hidden:false,disabled:false,open:false,dataset:{},listeners:{},classList:{contains:()=>false},addEventListener(type,handler){this.listeners[type]=handler;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},focus(){},remove(){},click(){if(this.download)downloads.push(this.download);},});return nodes.get(id);}
 const window={addEventListener:(k,f)=>events[k]=f},document={getElementById:node,createElement:()=>node('download'),body:{append(){}},addEventListener:(k,f)=>events[k]=f};
 const ctx=vm.createContext({window,document,console,location:{origin:'http://192.168.1.5:8080'},localStorage:{getItem:()=>owner},AbortController,Blob:require('node:buffer').Blob,URL:{createObjectURL:()=> 'blob:diagnostic',revokeObjectURL(){}},setTimeout:()=>1,clearTimeout(){},MutationObserver:class{observe(){}},fetch:async()=>{if(fail)throw Error('offline');const response={ok:true,status:200,json:async()=>({data})};if(defer){defer=false;return new Promise(r=>release=()=>r(response));}return response;}});
 vm.runInContext(core,ctx);vm.runInContext(source,ctx);
 const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
 return {C:window.DaynestDiagnostics,E:id=>node('dg-'+id),downloads,data,
  open:async()=>{node('diagnostics-open').listeners.click();await settle();},click:async id=>{await node('dg-'+id).listeners.click();await settle();},
  account:value=>{owner=value;events.storage({key:'studyflow.token'});},set fail(v){fail=v;},set defer(v){defer=v;},release:()=>release(),settle};
}
(async()=>{
 const h=harness(),{C,E}=h;assert(C.valid(h.data));assert.equal(C.summary(h.data)[0],'等待首次写盘');assert.equal(C.time(zero),'尚无确认记录');
 const reportInput=sample();reportInput.token='TOP-SECRET';reportInput.path='C:/private';reportInput.user={name:'PRIVATE_NAME'};reportInput.persistence.observation.last_error='C:/private with token';
 const report=C.report(reportInput,{kind:'web',origin:'http://192.168.1.5',token:'TOP-SECRET'},false),encoded=JSON.stringify(report);for(const word of ['TOP-SECRET','PRIVATE_NAME','C:/private','192.168.1.5','last_error'])assert(!encoded.includes(word));assert.equal(report.last_check_succeeded,false);assert.equal(report.backup.json_includes_transfer_files,false);
 assert(!C.valid({...sample(),persistence:{...sample().persistence,response_means_immediate_disk_write:true}}));assert(!C.client({application:'daynest',client:'android',version:'0.1.0',commit:'unknown',dirty:false,version_code:0}));
 const client={application:'daynest',client:'android',version:'0.1.0',commit:'a'.repeat(40),dirty:false,version_code:1,built_at:now,extra_secret:'TOP-SECRET'};const normalized=C.client(client);assert(normalized);assert(!JSON.stringify(C.report(sample(),normalized,true)).includes('TOP-SECRET'));
 await h.open();assert(E('dialog').open);assert.equal(E('connection-badge').textContent,'接口可达');assert.equal(E('snapshot-badge').textContent,'等待首次写盘');assert.equal(E('last-success').textContent,'尚无确认记录');
 h.fail=true;await h.click('refresh');assert.equal(E('connection-badge').textContent,'上次记录');assert.equal(E('snapshot-badge').textContent,'上次记录');assert(E('status').textContent.includes('offline'));assert(E('snapshot-summary').textContent.includes('上次成功读取'));
 await h.click('export');assert.equal(h.downloads.length,1);
 h.account('bob');assert(!E('dialog').open);assert.equal(E('last-success').textContent,'—');assert(E('export').disabled);
 h.fail=false;h.defer=true;const loading=h.open();await h.settle();h.account('charlie');h.release();await loading;assert(E('export').disabled);assert.equal(E('last-success').textContent,'—');
 console.log('Diagnostics passed: required DOM, truthful first-write/stale status, strict redacted export, client metadata filtering, auth switching and late response isolation. Mocked browser/HTTP.');
})().catch(error=>{console.error(error);process.exitCode=1;});
