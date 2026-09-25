const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function element(){return {textContent:'',value:'',open:false,children:[],listeners:{},classList:{toggle(){}},setAttribute(){},scrollIntoView(){},focus(){},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},addEventListener(name,fn){this.listeners[name]=fn},click(){this.listeners.click?.({target:this})},showModal(){this.open=true},close(){this.open=false},contains(){return false}}}
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
let token='one',nav=0,searchEvent=null;
const memoNav=element();memoNav.textContent='备忘录';memoNav.click=()=>nav++;
const doc={activeElement:null,body:element(),listeners:{},getElementById:get,createElement:element,
  querySelector(){return memoNav},querySelectorAll(){return [memoNav]},addEventListener(name,fn){this.listeners[name]=fn},dispatchEvent(event){searchEvent=event}};
vm.runInNewContext(fs.readFileSync('internal/httpapi/assets/commands.js','utf8'),{document:doc,localStorage:{getItem(){return token}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}});
get('command-trigger').click();assert(get('command-dialog').open);assert(get('command-results').children.length>=4);
const input=get('command-input');input.value='<script>notes</script>';input.listeners.input();
assert.equal(get('command-results').children.length,1);assert.equal(get('command-results').children[0].children[0].textContent,'搜索备忘录：<script>notes</script>');
input.listeners.keydown({key:'Enter',isComposing:true,preventDefault(){}});assert.equal(nav,0);
input.listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(nav,1);assert.equal(searchEvent.type,'daynest:search-memos');assert.equal(searchEvent.detail.query,'<script>notes</script>');assert(!get('command-dialog').open);
get('command-trigger').click();input.listeners.keydown({key:'ArrowUp',preventDefault(){}});input.listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(nav,2);
get('command-trigger').click();token='';input.listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(nav,2);assert(!get('command-dialog').open);
get('command-trigger').click();assert(!get('command-dialog').open);
get('logout').click();assert.equal(get('command-results').children.length,0);
console.log('Commands passed: independent navigation, keyboard wrap, IME protection, text-safe memo query handoff and logout guard.');
