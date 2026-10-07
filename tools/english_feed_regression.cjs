const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const nodes = new Map();
const node = (selector) => {
  if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', value: '', disabled: false, setAttribute() {}, classList: { toggle() {}, add() {}, contains() { return true; } } });
  return nodes.get(selector);
};
let token = 'account-a', failFeed = false;
const article = { id: 'news', title: 'Latest science', summary: 'A useful summary', source: 'ScienceDaily', category: 'science', difficulty: 'B1' };
const feed = { articles: [article], sources: [{ name: 'ScienceDaily', available: true, count: 1 }], fetched_at: new Date().toISOString() };
const requests = [];
let interval;
const context = vm.createContext({
  Headers: class { set() {} }, AbortController, Date, Intl, console,
  localStorage: { getItem: () => token },
  document: { querySelector: node, hidden: false },
  window: { setTimeout: () => 1, clearTimeout() {}, setInterval: (fn) => { interval = fn; } },
  fetch: async (url) => {
    requests.push(url);
    if (url.includes('/articles')) {
      if (failFeed) return { ok: false, status: 502, json: async () => ({ error: { message: 'upstream failed' } }) };
      return { ok: true, status: 200, json: async () => ({ data: feed }) };
    }
    // A broken reading library must not discard a successfully loaded feed.
    return { ok: false, status: 500, json: async () => ({}) };
  },
});
let source = fs.readFileSync(path.join(__dirname, '../internal/httpapi/assets/english.js'), 'utf8');
source = source.replace('  bindEvents();', '  globalThis.testAPI = { loadEnglish, state };');
vm.runInContext(source, context);
(async () => {
  const { loadEnglish, state } = context.testAPI;
  await loadEnglish(true);
  assert.equal(state.articles[0].id, 'news');
  assert.equal(state.initialized, true);
  assert.match(node('#english-sources').innerHTML, /ScienceDaily/);
  assert.ok(requests.includes('/api/v1/english/articles?refresh=true'));
  assert.equal(node('#english-refresh').disabled, false);
  failFeed = true;
  await loadEnglish(true);
  assert.equal(state.articles[0].id, 'news');
  assert.match(node('#english-feed-status').textContent, /已保留上次内容/);
  assert.equal(state.loading, false);
  assert.equal(node('#english-refresh').disabled, false);
  const before = requests.length;
  interval();
  assert.equal(requests.length, before, 'automatic retry must be throttled');
  token = 'account-b';
  await loadEnglish();
  assert.equal(state.articles.length, 0, 'new account must not retain previous state');
  // A permanently pending library/wordbook must not block a successful refresh.
  let finishFeed;
  context.fetch = (url) => url.includes('/articles')
    ? new Promise((resolve) => { finishFeed = resolve; })
    : new Promise(() => {});
  const pending = loadEnglish(true);
  assert.equal(node('#english-refresh').disabled, true);
  assert.match(node('#english-refresh').textContent, /更新中/);
  finishFeed({ ok: true, status: 200, json: async () => ({ data: feed }) });
  await pending;
  assert.equal(node('#english-refresh').disabled, false);
  assert.match(node('#english-refresh').textContent, /更新内容/);
  assert.match(node('#toast').textContent, /新增 1 篇/);
  const repeated = loadEnglish(true);
  finishFeed({ ok: true, status: 200, json: async () => ({ data: feed }) });
  await repeated;
  assert.match(node('#toast').textContent, /暂无新增/);
  context.fetch = async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; };
  await loadEnglish(true);
  assert.equal(node('#english-refresh').disabled, false);
  assert.match(node('#english-feed-status').textContent, /请求超时/);
  token = '';
  await loadEnglish(true);
  assert.equal(node('#english-refresh').disabled, false);
  assert.match(node('#toast').textContent, /请先登录/);
  console.log('english feed regression passed: isolated loading, refresh busy/recovery, hung auxiliary requests, timeout, unchanged feed feedback, login feedback');
})().catch((error) => { console.error(error); process.exitCode = 1; });
