const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const core = fs.readFileSync('mobile/src/core.js', 'utf8');
const client = fs.readFileSync('mobile/src/mobile-client.js', 'utf8').replace('export function boot', 'function boot') + '\nwindow.testBoot=boot;';
const key = 'daynest.mobile.connection.v1', origin = 'http://192.168.1.10:8080';
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
class Event {
  constructor(type, options = {}) { this.type = type; this.cancelable = options.cancelable; this.defaultPrevented = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}
class Headers {
  constructor(value = {}) { this.map = new Map(Object.entries(value)); }
  *[Symbol.iterator]() { yield* this.map; }
}
class Response {
  constructor(body, options = {}) { this.body = body; this.status = options.status || 200; this.ok = this.status >= 200 && this.status < 300; }
  async json() { return JSON.parse(this.body); }
}
function harness(saved, existingToken = '') {
  const nodes = new Map(), events = {}, appEvents = {}, requests = [], files = [], scripts = [], store = new Map();
  if (saved !== undefined) store.set(key, saved);
  if (existingToken) store.set('studyflow.token', existingToken);
  let reloads = 0, minimized = 0, backs = 0, answer, failStorage = false, confirm = true, scriptFailure = false;
  class Node {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.events = {}; this.dataset = {}; this.value = ''; this.checked = false; this.open = false; this.hidden = false; this.disabled = false; this.textContent = ''; this.classList = { add() {} }; }
    set innerHTML(html) { for (const [, id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id, new Node()); }
    setAttribute() {}
    addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
    dispatchEvent(event) { for (const handler of this.events[event.type] || []) handler(event); return !event.defaultPrevented; }
    async fire(type) { for (const handler of this.events[type] || []) await handler(new Event(type, { cancelable: true })); }
    append(node) { if (node.id) nodes.set(node.id, node); if (node.tagName === 'SCRIPT') { scripts.push(node.src); queueMicrotask(() => scriptFailure ? node.onerror() : node.onload()); } }
    prepend(node) { nodes.set('server-bar', node); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const body = new Node('body'), workspace = new Node(), placeholders = ['/static/ui-core.js', '/static/app.js'].map(src => ({ dataset: { mobileSrc: src } }));
  nodes.set('logout', new Node()); nodes.set('app-sync-retry', { click() { nodes.set('refreshed', true); } });
  const document = {
    body, createElement: tag => new Node(tag), getElementById: id => nodes.get(id),
    addEventListener: (type, handler) => { (events[type] ||= []).push(handler); },
    querySelector: selector => selector === '.workspace' ? workspace : null,
    querySelectorAll: selector => selector === 'script[data-mobile-src]' ? placeholders : selector === 'dialog[open]' ? [...nodes.values()].filter(n => n.tagName === 'DIALOG' && n.open) : []
  };
  const location = { href: 'https://localhost/', origin: 'https://localhost', reload() { reloads++; } };
  const window = { location, fetch: async () => new Response('{}'), addEventListener() {}, dispatchEvent() {}, confirm: () => confirm };
  const Http = { async request(options) { requests.push(options); if (answer) return answer(options); return { status: 200, data: { data: { application: 'daynest', mobile_protocol: 1, requires_secure_secret: false, ai_requires_loopback: true } }, headers: {}, url: options.url }; } };
  const Files = { async setSession(value) { files.push(['session', value]); }, async configure(value) { files.push(['configure', value]); } };
  const App = { async addListener(type, handler) { appEvents[type] = handler; }, minimizeApp() { minimized++; } };
  const ctx = vm.createContext({ window, document, location, console, URL, Request: class {}, Headers, Response, Event, queueMicrotask,
    localStorage: { getItem: k => store.get(k) || null, setItem(k, value) { if (failStorage) throw Error('存储空间不足'); store.set(k, value); }, removeItem: k => store.delete(k) },
    history: { replaceState() {}, back() { backs++; } }, MutationObserver: class { observe() {} }
  });
  vm.runInContext(core, ctx); vm.runInContext(client, ctx); window.testBoot({ Http, Files, App });
  return { nodes, store, requests, files, scripts, appEvents,
    init: async () => { for (const handler of events.DOMContentLoaded) await handler(); await settle(); },
    submit: () => nodes.get('mobile-form').fire('submit'),
    server: (value, ack = true) => { nodes.get('mobile-server').value = value; nodes.get('mobile-consent').checked = ack; },
    get reloads() { return reloads; }, get minimized() { return minimized; }, get backs() { return backs; },
    set answer(value) { answer = value; }, set failStorage(value) { failStorage = value; }, set confirm(value) { confirm = value; }, set scriptFailure(value) { scriptFailure = value; }
  };
}
(async () => {
  const h = harness('{bad JSON', 'orphaned-token'); await h.init();
  assert(h.nodes.get('mobile-connection').open); assert.equal(h.scripts.length, 0); assert.match(h.nodes.get('mobile-state').textContent, /已忽略/);
  h.appEvents.backButton({ canGoBack: false }); assert.equal(h.minimized, 1, 'setup screen can leave app via Android back');
  h.server('http://localhost:8080'); await h.submit(); assert.equal(h.requests.length, 0);
  h.server(origin, false); await h.submit(); assert.equal(h.requests.length, 0); assert.match(h.nodes.get('mobile-state').textContent, /明文传输/);
  h.server(origin); h.answer = () => ({ status: 200, data: { data: { application: 'daynest', mobile_protocol: 1, requires_secure_secret: true } } });
  await h.submit(); assert.equal(h.scripts.length, 0); assert.equal(h.files.length, 0); assert.match(h.nodes.get('mobile-state').textContent, /公开开发密钥/);
  h.answer = null; await h.submit(); assert.equal(h.store.get('studyflow.token'), undefined); assert.equal(h.scripts.length, 2); assert(!h.nodes.get('mobile-connection').open);
  assert.equal(h.files[0][0], 'session'); assert.equal(h.files[0][1].token, '', 'clear orphaned token before selecting a server'); assert.equal(h.files[1][0], 'configure');
  assert(h.requests.every(r => !('Authorization' in r.headers)), 'compatibility probes must not forward login credentials');
  h.appEvents.backButton({ canGoBack: true }); assert.equal(h.backs, 1);
  h.appEvents.backButton({ canGoBack: false }); assert.equal(h.minimized, 2);

  const restore = harness(JSON.stringify({ server: origin, httpAcknowledged: true }), 'same-server-token'); await restore.init();
  assert.equal(restore.scripts.length, 2); assert.equal(restore.store.get('studyflow.token'), 'same-server-token');
  await restore.nodes.get('server-bar').fire('click'); restore.server('http://192.168.1.11:8080'); restore.confirm = false; await restore.submit();
  assert.equal(restore.files.filter(f => f[0] === 'configure').length, 1); assert.equal(restore.store.get('studyflow.token'), 'same-server-token'); assert.equal(restore.reloads, 0);
  restore.confirm = true; await restore.submit(); assert.equal(restore.store.get('studyflow.token'), undefined); assert.equal(restore.reloads, 1); assert.equal(JSON.parse(restore.store.get(key)).server, 'http://192.168.1.11:8080');

  const offline = harness(JSON.stringify({ server: origin, httpAcknowledged: true }), 'retain-token'); offline.answer = () => { throw Error('无法连接电脑'); }; await offline.init();
  assert.equal(offline.scripts.length, 0); assert.equal(offline.store.get('studyflow.token'), 'retain-token'); assert.match(offline.nodes.get('mobile-state').textContent, /无法连接电脑/);
  offline.answer = null; await offline.submit(); assert.equal(offline.scripts.length, 2); assert.equal(offline.store.get('studyflow.token'), 'retain-token');
  offline.answer = () => { throw Error('offline'); }; await offline.appEvents.appStateChange({ isActive: true }); assert.match(offline.nodes.get('server-bar').textContent, /暂不可达/); assert.equal(offline.store.get('studyflow.token'), 'retain-token');

  const storage = harness(JSON.stringify({ server: origin, httpAcknowledged: true }), 'first-server-token'); await storage.init();
  await storage.nodes.get('server-bar').fire('click'); storage.server('http://192.168.1.12:8080'); storage.failStorage = true; await storage.submit();
  assert.equal(storage.store.get('studyflow.token'), undefined); assert(storage.nodes.get('mobile-close').hidden); assert.equal(storage.nodes.get('mobile-connect').textContent, '重载界面');
  const cancel = new Event('cancel', { cancelable: true }); assert.equal(storage.nodes.get('mobile-connection').dispatchEvent(cancel), false);
  storage.appEvents.backButton({ canGoBack: false }); assert.equal(storage.minimized, 1); await storage.submit(); assert.equal(storage.reloads, 1);

  const partial = harness(); await partial.init(); partial.scriptFailure = true; partial.server(origin); await partial.submit();
  assert.match(partial.nodes.get('mobile-state').textContent, /安装包资源不完整/); assert(partial.nodes.get('mobile-close').hidden); await partial.submit(); assert.equal(partial.reloads, 1); assert.equal(partial.scripts.length, 1, 'partial script initialization must require a clean reload');
  console.log('Android connection flows passed: setup/back, consent, development-key refusal, orphaned-token clearing, same-server restore, confirmed switch, offline retry, storage failure, partial-script failure. Mocked native bridge/DOM; no device test.');
})().catch(error => { console.error(error); process.exitCode = 1; });
