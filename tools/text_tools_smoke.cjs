const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {Blob}=require('node:buffer'),root='internal/httpapi/assets/';
const html=fs.readFileSync(root+'index.html','utf8'),core=fs.readFileSync(root+'text-tools-core.js','utf8'),script=fs.readFileSync(root+'text-tools.js','utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('text-tool-'+m[1]),m[1]);
for(const asset of ['text-tools-core.js','text-tools.js','text-tools.css'])assert(html.includes('/static/'+asset));
assert(html.indexOf('/static/text-tools-core.js')<html.indexOf('/static/text-tools.js'));
let account='one',copied='',rejectCopy=false,delayedCopy=false,finishCopy;
const nodes=new Map(),events={},observers=[],timers=[],downloads=[],urls=new Set();
function el(id){assert(ids.has(id),'missing '+id);if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,hidden:false,listeners:{},addEventListener(t,fn){this.listeners[t]=fn;},focus(){this.focused=true;},select(){this.selected=true;}});return nodes.get(id);}
const E=id=>el('text-tool-'+id);
const context=vm.createContext({console,Blob,localStorage:{getItem:()=>account},navigator:{clipboard:{async writeText(text){if(rejectCopy)throw Error('denied');copied=text;if(delayedCopy)await new Promise(resolve=>finishCopy=resolve);}}},document:{getElementById:el,addEventListener(){},body:{appendChild(){}},createElement(type){assert.equal(type,'a');return{click(){downloads.push(this.download);},remove(){}};}},URL:{createObjectURL(){urls.add('blob:temp');return'blob:temp';},revokeObjectURL(url){urls.delete(url);}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},window:{addEventListener(t,fn){events[t]=fn;},setInterval(){},setTimeout(fn){timers.push(fn);}}});
vm.runInContext(core,context);vm.runInContext(script,context);
const C=context.window.DaynestTextTools;
const input=(id,text)=>{E(id).value=text;E(id).listeners.input({isComposing:false});};
const mode=value=>{E('mode').value=value;E('mode').listeners.change();};
const click=id=>E(id).listeners.click();
(async()=>{
  assert.equal(C.stats('你好😀\r\nhello world').characters,15);assert.equal(C.stats('你好😀\r\nhello world').words,2);assert.equal(C.stats('').lines,0);
  assert.equal(C.transform('  a  b \r\n\r\n\r\n c\t ','clean').text,'a b\n\nc');
  assert.equal(C.transform(' x\n \n\t\ny','blank').text,' x\ny');
  assert.equal(C.transform('a\nA\na\n a\n','unique').text,'a\nA\n a\n');
  assert.equal(C.transform('a.a.a','replace','.','$&').text,'a$&a$&a');
  assert.equal(C.transform('aa','replace','a','').text,'');assert.equal(C.transform('aaa','replace','aa','b').text,'ba');
  assert.equal(C.transform('hello','replace','absent','x').count,0);
  assert.throws(()=>C.transform('x','replace','','y'));assert.throws(()=>C.transform('a'.repeat(50001),'clean'));assert.throws(()=>C.transform('a'.repeat(50000),'replace','a','bb'));assert.throws(()=>C.transform('x','unknown'));
  input('input','  apples  \n\n\n pears ');assert.equal(E('output').value,'apples\n\npears');assert.equal(E('input').value,'  apples  \n\n\n pears ');assert(!E('apply').disabled);
  click('apply');assert.equal(E('input').value,'apples\n\npears');click('undo');assert.equal(E('input').value,'  apples  \n\n\n pears ');click('redo');assert.equal(E('input').value,'apples\n\npears');
  click('clear');assert.equal(E('input').value,'');click('undo');assert.equal(E('input').value,'apples\n\npears');
  mode('unique');input('input','apple\napple\npear');assert.match(E('summary').textContent,/去掉 1 行/);assert.equal(E('output').value,'apple\npear');
  mode('replace');assert(E('copy').disabled);assert(!E('replace-fields').hidden);input('find','apple');input('replacement','<script>$&');assert.equal(E('output').value,'<script>$&\n<script>$&\npear');assert.equal(E('input').value,'apple\napple\npear');
  await click('copy');assert.equal(copied,E('output').value);rejectCopy=true;await click('copy');assert(E('output').selected);assert.match(E('status').textContent,/Ctrl/);rejectCopy=false;
  click('download');assert.equal(downloads[0],'整理后的文字.txt');timers.forEach(fn=>fn());assert.equal(urls.size,0);
  E('find').value='中文';E('find').listeners.compositionend();assert.match(E('summary').textContent,/匹配 0 处/);
  input('input','x'.repeat(50001));assert(E('apply').disabled);assert.equal(E('characters').textContent,'—');
  mode('clean');input('input','hello');delayedCopy=true;const pending=click('copy');account='two';events.storage({key:'studyflow.token'});const cleared=E('status').textContent;finishCopy();await pending;assert.equal(E('status').textContent,cleared);assert.equal(E('input').value,'');assert.equal(E('output').value,'');assert(E('undo').disabled);assert(E('redo').disabled);
  // Keep only the ten most recent tool operations; undo cannot leak the older buffer.
  for(let i=0;i<12;i++){input('input',' '+i+' ');click('apply');}
  for(let i=0;i<10;i++)click('undo');assert(E('undo').disabled);assert(!E('redo').disabled);input('input','new input');assert(E('redo').disabled);
  events.pagehide();assert.equal(E('input').value,'');assert(E('undo').disabled);
  console.log('Text tools passed: Unicode counts, literal replacements, bounds, preview without overwrite, undo/redo, IME, clipboard fallback, downloads and account cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
