// Browserless regression checks for memo selectors, safe Markdown rendering,
// checklist interactions and the responsive visual shell.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "internal/httpapi/assets/index.html"), "utf8");
const scriptPath = path.join(root, "internal/httpapi/assets/memos.js");
const script = fs.readFileSync(scriptPath, "utf8");
const styles = fs.readFileSync(path.join(root, "internal/httpapi/assets/memos.css"), "utf8");

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const duplicateIDs = [...ids].filter((id) => (html.match(new RegExp(`id="${id}"`, "g")) || []).length > 1);
if (duplicateIDs.length) throw new Error(`duplicate HTML ids: ${duplicateIDs.join(", ")}`);
const selectors = [...script.matchAll(/\$\("#([^"]+)"\)/g)].map((match) => match[1]);
const missing = [...new Set(selectors.filter((id) => !ids.has(id)))];
if (missing.length) throw new Error(`memos.js references missing HTML ids: ${missing.join(", ")}`);

for (const marker of ['data-view="memos"', 'id="panel-memos"', 'id="memo-editor"', '/static/memos.js?v=20260925-daynest', '/static/memos-refresh.css?v=20260909-1']) {
  if (!html.includes(marker)) throw new Error(`missing HTML marker: ${marker}`);
}
for (const marker of ["/api/v1/memo-folders", "/api/v1/memos/overview", "/restore", "/duplicate", "/permanent", "saveCurrent", "renderMarkdown"]) {
  if (!script.includes(marker)) throw new Error(`missing memo behavior: ${marker}`);
}
for (const marker of [".memo-workspace", ".memo-note-card", ".memo-editor-pane", ':root[data-theme="dark"]', "@media(max-width:700px)"]) {
  if (!styles.includes(marker)) throw new Error(`missing memo style: ${marker}`);
}

function element() {
  return {
    value: "", textContent: "", innerHTML: "", disabled: false, open: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, focus() {}, select() {}, close() {}, showModal() {},
  };
}
const elements = new Map();
const getElement = (selector) => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
const document = { querySelector: getElement, querySelectorAll() { return []; }, addEventListener() {}, createElement() { return element(); } };
const window = { setTimeout() {}, clearTimeout() {}, addEventListener() {}, confirm() { return false; }, prompt() { return null; } };
class HeadersMock { set() {} }
class BlobMock {}
const context = { console, Date, Intl, URL, URLSearchParams, AbortController, Headers: HeadersMock, Blob: BlobMock, localStorage: { getItem() { return ""; } }, document, window };
const instrumented = script.replace("\n  bindEvents();\n})();", "\n  window.__memoTest = { renderMarkdown, state, markDirty, saveCurrent, selectMemo, loadMemos, memoAPI };\n  bindEvents();\n})();");
if (instrumented === script) throw new Error("memo test instrumentation point was not found");
vm.runInNewContext(instrumented, context, { filename: scriptPath });
const rendered = context.window.__memoTest.renderMarkdown("# 清单\n- [x] 完成 <script>alert(1)</script>\n- [ ] 继续 **学习**");
if (!rendered.includes("&lt;script&gt;") || rendered.includes("<script>") || !rendered.includes('data-memo-check-line="1"') || !rendered.includes("<strong>学习</strong>")) {
  throw new Error(`unsafe or incomplete memo rendering: ${rendered}`);
}
console.log(`memo UI smoke passed: ${selectors.length} selectors, ${ids.size} document ids`);

async function checkSaving() {
  const api = context.window.__memoTest;
  api.state.current = { id: 'test-note', title: 'test' };
  getElement('#memo-title').value = 'test';
  getElement('#memo-content').value = 'first edit';
  api.markDirty();
  let release;
  const writes = [];
  context.fetch = async (url, options = {}) => {
    if (options.method === 'PATCH') {
      const payload = JSON.parse(options.body); writes.push(payload);
      if (writes.length === 1) await new Promise(resolve => { release = resolve; });
      return { status:200, ok:true, json:async () => ({ data:{ id:'test-note', ...payload } }) };
    }
    return { status:200, ok:true, json:async () => ({ data:url.includes('overview') ? {} : [] }) };
  };
  const saving = api.saveCurrent({ quiet:true });
  getElement('#memo-content').value = 'second edit while saving'; api.markDirty();
  release();
  if (!(await saving) || writes.length !== 2 || writes[1].content !== 'second edit while saving' || api.state.dirty) {
    throw new Error('edits made during save were lost or not saved');
  }
  context.fetch = async () => { throw new Error('offline'); };
  getElement('#memo-content').value = 'unsaved offline edit'; api.markDirty();
  await api.selectMemo('another-note');
  if (api.state.current.id !== 'test-note' || !api.state.dirty || getElement('#memo-content').value !== 'unsaved offline edit') {
    throw new Error('failed save allowed switching away from unsaved content');
  }
  console.log('memo save regression passed: concurrent edits persisted; failed save retains editor');
  api.state.dirty=false;api.state.token='test';context.localStorage.getItem=()=> 'test';
  const pending=new Map();
  context.fetch=url=>new Promise(resolve=>pending.set(url,resolve));
  const first=api.selectMemo('first');const second=api.selectMemo('second');
  const response=data=>({status:200,ok:true,json:async()=>({data})});
  pending.get('/api/v1/memos/second')(response({id:'second',content:'latest selection'}));await second;
  pending.get('/api/v1/memos/first')(response({id:'first',content:'stale selection'}));await first;
  if(api.state.current.id!=='second')throw new Error('older note response overwrote latest selection');
  let releaseOld;
  context.fetch=async url=>{
    if(url.includes('q=old'))return new Promise(resolve=>{releaseOld=()=>resolve(response([{id:'second',title:'old'}]))});
    if(url.includes('q=new'))return response([{id:'second',title:'new'}]);
    return response(url.includes('overview')?{}:[]);
  };
  api.state.query='old';const oldLoad=api.loadMemos();
  api.state.query='new';await api.loadMemos();releaseOld();await oldLoad;
  if(api.state.notes[0]?.title!=='new')throw new Error('new search was ignored or overwritten by old results');
  console.log('memo request regression passed: latest note selection and search win');
  const assert = require('node:assert/strict');
  context.fetch=async()=>({ok:false,status:404,json:async()=>({error:{code:'not_found'}})});
  await assert.rejects(api.memoAPI('/api/v1/memos/missing'),/已不存在/);
  context.fetch=async()=>({ok:false,status:404,json:async()=>{throw new Error('not JSON')}});
  await assert.rejects(api.memoAPI('/api/v1/memos'),/接口不可用/);
  context.fetch=async()=>({ok:true,status:200,json:async()=>({})});
  await assert.rejects(api.memoAPI('/api/v1/memos'),/无效数据/);
  context.fetch=async()=>({ok:true,status:200,json:async()=>{context.localStorage.getItem=()=> 'changed';return {data:[]}}});
  await assert.rejects(api.memoAPI('/api/v1/memos'),/账号已切换/);
  let abortRequest;
  context.window.setTimeout=callback=>{abortRequest=callback;return 1};
  context.fetch=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))));
  const request=api.memoAPI('/api/v1/memos');abortRequest();
  await assert.rejects(request,/请求超时/);
  console.log('memo API regression passed: distinct 404 errors, malformed data, account switching and timeout');
}
checkSaving().catch(error => { console.error(error); process.exitCode = 1; });
