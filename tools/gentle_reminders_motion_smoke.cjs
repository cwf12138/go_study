// Deterministic Web Animations harness: no browser permissions or personal data.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('internal/httpapi/assets/gentle-reminders-motion.js','utf8');
const preference={matches:false,addEventListener(_,f){this.changed=f;}},events={},animations=[];
const doc={hidden:false,activeElement:null,addEventListener(k,f){events[k]=f;}};
const win={matchMedia:()=>preference,getComputedStyle:()=>({opacity:'.6',transform:'matrix(1, 0, 0, 1, 0, 4)'})};
vm.runInNewContext(source,{window:win,document:doc,Map,console});const M=win.DaynestReminderMotion;
function node(animated=true){const n={hidden:false,inert:false,open:false,dataset:{},style:{},attrs:{},scrollHeight:240,handlers:{},closed:0,focused:false,setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.handlers[k]=f;},focus(){this.focused=true;},contains(el){return el===this;},getBoundingClientRect:()=>({height:80}),showModal(){this.open=true;},close(){this.open=false;this.closed++;}};
 if(animated)n.animate=(frames,options)=>{let resolve,reject;const a={frames,options,canceled:false,finished:new Promise((r,j)=>{resolve=r;reject=j;}),complete:()=>resolve(),cancel(){this.canceled=true;reject(Error('AbortError'));}};animations.push(a);return a;};return n;}
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
(async()=>{
 const d=node();M.dialog(d,true);assert(d.open);assert.equal(d.dataset.motion,'opening');assert.equal(animations.at(-1).options.duration,280);
 animations.at(-1).complete();await settle();assert.equal(d.dataset.motion,undefined);
 M.dialog(d,false);const closing=animations.at(-1);assert(d.open,'modal remains accessible until exit completes');
 M.dialog(d,false);assert.equal(animations.at(-1),closing,'repeated close does not restart the animation');
 M.dialog(d,true);assert(closing.canceled);closing.complete();await settle();assert(d.open);assert.equal(d.closed,0,'canceled close cannot close a reopened dialog');
 animations.at(-1).complete();await settle();M.dialog(d,false);animations.at(-1).complete();await settle();assert(!d.open);assert.equal(d.closed,1);
 const privateNode=node();privateNode.hidden=true;M.reveal(privateNode,true);assert(!privateNode.hidden);assert(!privateNode.inert);
 M.reveal(privateNode,false);assert(privateNode.inert,'exiting content is immediately removed from keyboard interaction');
 const exit=animations.at(-1);M.reveal(privateNode,false,true);assert(privateNode.hidden,'account cleanup never waits for exit motion');assert(exit.canceled);await settle();
 let removed=false;const row=node();M.remove(row,()=>{removed=true;});assert(!removed);animations.at(-1).complete();await settle();assert(removed);
 removed=false;M.remove(row,()=>{removed=true;});M.reset();await settle();assert(!removed,'stale callback cannot remove a new account row');
 const summary=node(false),body=node(),details=node(false);details.querySelector=s=>s==='summary'?summary:body;
 M.disclosure(details);assert.equal(summary.attrs['aria-expanded'],'false');
 summary.handlers.click({preventDefault(){}});assert(details.open);assert.equal(summary.attrs['aria-expanded'],'true');
 const expand=animations.at(-1);doc.activeElement=body;
 summary.handlers.click({preventDefault(){}});assert(expand.canceled);assert(body.inert);assert(summary.focused);assert.equal(summary.attrs['aria-expanded'],'false');
 animations.at(-1).complete();await settle();assert(!details.open);assert.equal(body.style.overflow,'');
 summary.handlers.click({preventDefault(){}});assert(!body.inert);animations.at(-1).complete();await settle();assert(details.open);
 summary.handlers.click({preventDefault(){}});preference.matches=true;preference.changed();await settle();assert(!details.open,'reduced motion immediately settles a pending close');
 const count=animations.length;M.dialog(d,true);M.dialog(d,false);assert(!d.open);M.pulse(row,'confirm');assert.equal(animations.length,count,'reduced motion starts no animation');
 preference.matches=false;doc.hidden=true;M.dialog(d,true);M.dialog(d,false);assert(!d.open);assert.equal(animations.length,count,'background pages do not wait on animation frames');
 doc.hidden=false;M.dialog(d,true);M.dialog(d,false);events.visibilitychange();assert(d.open);doc.hidden=true;events.visibilitychange();assert(!d.open,'backgrounding settles the modal exit');await settle();
 const plain=node(false);M.dialog(plain,true);M.dialog(plain,false);assert(!plain.open,'unsupported Web Animations degrades to instant controls');
 const throws=node(false);throws.animate=()=>{throw Error('Animation unavailable');};M.dialog(throws,true);M.dialog(throws,false);assert(!throws.open);
 console.log('Reminder motion passed: modal entry/exit, interrupt/reopen, duplicate close, immediate private cleanup, inert exit, stable row removal, rapid disclosure reversal, focus/ARIA, live reduced-motion changes, background settlement, unsupported-browser fallback and handled animation cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
