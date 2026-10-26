// Real shared shell in a small DOM model. No browser, account or network access.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const base='internal/httpapi/assets/',html=fs.readFileSync(base+'index.html','utf8'),script=fs.readFileSync(base+'product-shell.js','utf8'),css=fs.readFileSync(base+'product-polish.css','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for(const [,id]of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has(id),'missing shell DOM '+id);
assert(html.indexOf('/static/product-shell.js')<html.indexOf('/static/app.js'));
assert(html.indexOf('/static/product-polish.css')<html.indexOf('/static/layout.css'));
for(const marker of ['focus-visible','prefers-reduced-motion','pointer:coarse','font-size:16px','navigation-backdrop','product-field-error'])assert(css.includes(marker));
class Node{
 constructor(id=''){this.id=id;this.attrs={};this.classes=new Set();this.listeners={};this.children=[];this.hidden=false;this.value='';this.checked=false;this.type='text';this.textContent='';this.inert=false;this.classList={add:(...a)=>a.forEach(s=>this.classes.add(s)),remove:(...a)=>a.forEach(s=>this.classes.delete(s)),contains:s=>this.classes.has(s),toggle:(s,b)=>{b??=!this.classes.has(s);if(b)this.classes.add(s);else this.classes.delete(s);return b;}};}
 set className(s){this.classes=new Set(s.split(/\s+/).filter(Boolean));}get className(){return [...this.classes].join(' ');}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,f){(this.listeners[k]??=[]).push(f);}emit(k,e={}){for(const f of this.listeners[k]||[])f({target:this,...e});}
 append(n){if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(c=>c!==n);this.children.push(n);n.parentElement=this;}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null;}
 contains(n){return !!n&&(n===this||this.children.some(c=>c.contains(n)));}
 focus(){doc.activeElement=this;}scrollIntoView(){}closest(s){return s==='form[data-draft-guard]'?this.guardForm||null:s==='dialog[open]'?this.dialogHost||null:null;}
 matches(s){return s==='form[data-draft-guard]'&&this.guarded;}
 querySelector(s){return s==='[aria-current="page"]'?nav:s===':invalid'?this.firstInvalid:null;}
 querySelectorAll(){return this.controls||[];}
 insertAdjacentElement(_where,n){this.errorSibling=n;}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);};
const doc=new Node(),body=new Node(),workspace=new Node(),skip=new Node(),nav=new Node(),last=new Node();doc.body=body;doc.activeElement=null;doc.getElementById=get;doc.createElement=()=>new Node();let dialogs=[];
doc.querySelector=s=>s==='.workspace'?workspace:s==='.skip-to-content'?skip:null;doc.querySelectorAll=s=>s==='dialog[open]'?dialogs:[];
get('app-sidebar').controls=[nav,last];get('app-sidebar').append(nav);get('app-sidebar').append(last);get('toast').append(get('toast-message'));get('toast').append(get('toast-dismiss'));body.append(get('toast'));
let nextTimer=1,confirmed=false;const timers=new Map(),win=new Node(),media=new Node();media.matches=true;
win.matchMedia=()=>media;win.confirm=()=>confirmed;win.setTimeout=(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,delay});return id;};win.clearTimeout=id=>timers.delete(id);
vm.runInNewContext(script,{window:win,document:doc,MutationObserver:class{observe(){}},queueMicrotask});
const ui=win.DaynestUI,event=target=>({target,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}});
(async()=>{
 assert(get('app-sidebar').inert);ui.setMenu(true);assert(!get('app-sidebar').inert);assert(workspace.inert);assert(!get('navigation-backdrop').hidden);assert.equal(get('mobile-menu').getAttribute('aria-expanded'),'true');assert.equal(doc.activeElement,nav);
 last.focus();const tab={key:'Tab',preventDefault(){this.prevented=true;}};doc.emit('keydown',tab);assert.equal(doc.activeElement,nav);
 doc.emit('keydown',{key:'Escape',preventDefault(){}});assert(!workspace.inert);assert(get('navigation-backdrop').hidden);assert.equal(doc.activeElement,get('mobile-menu'));
 ui.setMenu(true);media.matches=false;media.emit('change');assert(!workspace.inert);assert(!get('app-sidebar').inert);
 ui.notify('<b>literal</b>');assert.equal(get('toast-message').textContent,'<b>literal</b>');assert([...timers.values()].some(t=>t.delay===6000));
 get('toast').emit('mouseenter');assert.equal(timers.size,0);get('toast').emit('mouseleave');assert.equal(timers.size,1);
 ui.notify('An error','error');assert.equal(timers.size,0);assert.equal(get('toast-message').getAttribute('role'),'alert');ui.notify('background saved');assert.equal(get('toast-message').textContent,'An error');get('toast-dismiss').emit('click');assert.equal(get('toast-message').textContent,'background saved');
 const modal=new Node();dialogs=[modal];ui.notify('inside');assert.equal(get('toast').parentElement,modal);doc.emit('close',{target:modal});assert.equal(get('toast').parentElement,body);dialogs=[];
 ui.reset();assert(get('toast').hidden);
 const form=new Node('todo-form'),field=new Node('todo-title');form.guarded=true;form.elements=[field];field.guardForm=form;field.value='';
 doc.emit('focusin',{target:field});field.value='unfinished';doc.emit('input',{target:field});let leaving=event();win.emit('beforeunload',leaving); // emit makes a copy, so use a shared flag.
 let warned=false;win.emit('beforeunload',{preventDefault(){warned=true;}});assert(warned);
 const logout=event(get('logout'));get('logout').emit('click',logout); // Capture handler must prevent destructive logout.
 let prevented=false,stopped=false;get('logout').emit('click',{preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});assert(prevented&&stopped);
 field.value='';warned=false;win.emit('beforeunload',{preventDefault(){warned=true;}});assert(!warned,'typing back to baseline is clean');
 doc.emit('reset',{target:form});await Promise.resolve();field.value='new after reset';doc.emit('input',{target:field});warned=false;win.emit('beforeunload',{preventDefault(){warned=true;}});assert(warned,'reset must protect later input without refocusing');
 field.value='';let writing=true;ui.registerGuard('memo',()=>writing);warned=false;win.emit('beforeunload',{preventDefault(){warned=true;}});assert(warned);writing=false;
 const details=new Node();details.tagName='DETAILS';field.parentElement=details;field.form=form;field.validity={valid:false};field.validationMessage='请填写此字段。';field.setAttribute('aria-describedby','existing-help');form.firstInvalid=field;
 doc.emit('invalid',{target:field,preventDefault(){}});await Promise.resolve();assert(details.open);assert.equal(doc.activeElement,field);assert.equal(field.getAttribute('aria-invalid'),'true');assert(field.getAttribute('aria-describedby').startsWith('existing-help field-error-'));assert.equal(field.errorSibling.textContent,'请填写此字段。');
 field.validity.valid=true;doc.emit('input',{target:field});assert.equal(field.getAttribute('aria-describedby'),'existing-help');assert.equal(field.getAttribute('aria-invalid'),null);
 let focused=false;get('main-content').focus=()=>focused=true;skip.emit('click',{preventDefault(){}});assert(focused);
 console.log('Product shell passed: DOM/assets, mobile inert/focus trap/Escape, persistent errors, success queue/pause, modal toast, draft reset/logout/registered guards, inline native validation and skip link.');
})().catch(e=>{console.error(e);process.exitCode=1;});
