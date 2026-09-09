const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "internal/httpapi/assets/index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "internal/httpapi/assets/literature.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "internal/httpapi/assets/literature.css"), "utf8");

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const selectors = [...script.matchAll(/\$\("#([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
const missing = [...new Set(selectors.filter((id) => !ids.has(id)))];
if (missing.length) throw new Error(`literature.js references missing HTML ids: ${missing.join(", ")}`);

for (const marker of [
  'data-view="literature"', 'id="panel-literature"', 'id="ebook-reader-dialog"',
  'id="classic-reader-dialog"', '/static/literature.js?v=20260909-1',
  '/static/literature.css?v=20260902-1',
]) if (!html.includes(marker)) throw new Error(`missing HTML marker: ${marker}`);

for (const marker of [
  "/api/v1/literature/catalog", "/api/v1/literature/shelf",
  "['classics'", "/api/v1/literature/classic-studies",
  "SpeechSynthesisUtterance", "function renderEBookPage", "function openClassic",
]) if (!script.includes(marker)) throw new Error(`missing script behavior: ${marker}`);

for (const marker of [
  ".literature-books-layout", ".ebook-reader-dialog", ".classic-parallel-text",
  'html[data-theme="dark"]', "@media(max-width:760px)",
]) if (!styles.includes(marker)) throw new Error(`missing responsive style: ${marker}`);

console.log(`literature UI smoke passed: ${selectors.length} selector references, ${ids.size} document ids`);

// Exercise the real reader functions with deterministic HTTP and DOM doubles.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = new Map();
const element = selector => {
  if (!elements.has(selector)) elements.set(selector, {value:'',textContent:'',innerHTML:'',style:{},classList:{toggle(){}},addEventListener(){}});
  return elements.get(selector);
};
const context = {
  window:{setTimeout(){},clearTimeout(){}}, document:{querySelector:element,querySelectorAll:()=>[]},
  localStorage:{getItem:()=>''}, Headers:class{set(){}}, AbortController, URL, Date, Intl, console,
};
const source = script.replace('  bind();\n  setupProduct();', '  window.testReader={state,findInBook,saveProgress,literatureAPI,syncReading};');
assert.notEqual(source,script,'test entry point missing');
vm.runInNewContext(source,context);
const api=context.window.testReader;
assert.equal(api.findInBook([{content:'A quiet WORLD'},{content:'another world'}],'world').length,2);
assert.equal(api.findInBook([{content:'world'}],'x').length,0);
assert.equal(api.findInBook(Array.from({length:80},()=>({content:'world'})),'world').length,60);
async function checkProgress(){
  api.state.currentReading={id:'book-1',book:{title:'Book'}};
  api.state.content={pages:[{content:'a'},{content:'b'}]};api.state.page=0;
  let release,signalStarted;const started=new Promise(resolve=>{signalStarted=resolve});const writes=[];
  context.fetch=async(path,options)=>{
    const payload=JSON.parse(options.body);writes.push(payload);
    if(writes.length===1)await new Promise(resolve=>{release=resolve;signalStarted()});
    return {ok:true,status:200,json:async()=>({data:{id:'book-1',...payload,progress:50}})};
  };
  const first=api.saveProgress();api.state.page=1;const next=api.saveProgress();
  await started;
  release();await first;await next;
  assert.equal(writes.length,2);assert.equal(writes[1].page_index,1);
  context.fetch=async()=>{throw new Error('offline')};
  assert.equal(await api.saveProgress(),false);
  assert.match(element('#reader-save-status').textContent,/保存失败/);
  const currentID=api.state.currentReading.id;
  api.syncReading({id:'another-book',notes:[],bookmarks:[]});
  assert.equal(api.state.currentReading.id,currentID,'response for another book must not replace current reader');
  let account='first',releaseRequest,startedRequest;
  context.localStorage.getItem=()=>account;
  const requestStarted=new Promise(resolve=>{startedRequest=resolve});let requests=0;
  context.fetch=async()=>{
    requests++;await new Promise(resolve=>{releaseRequest=resolve;startedRequest()});
    return {ok:true,status:200,json:async()=>({data:{}})};
  };
  const write=api.literatureAPI('/api/v1/literature/shelf/a/notes',{method:'POST',body:'{}'});
  const queued=api.literatureAPI('/api/v1/literature/shelf/a/notes',{method:'POST',body:'{}'});
  const finished=Promise.allSettled([write,queued]);
  await requestStarted;account='second';releaseRequest();
  const results=await finished;
  assert.equal(requests,1,'queued request must not run with another account');
  assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'rejected');
  console.log('reader behavior passed: full-text search, result cap, serialized saves, failure feedback');
  console.log('reader isolation passed: stale-book responses ignored; account switching cancels queued writes');
}
checkProgress().catch(error=>{console.error(error);process.exitCode=1});
