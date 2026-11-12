// Real packaged UI + isolated Go service; native bridge is mocked, not a device test.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), net = require('node:net'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'mobile/www'), out = path.join(root, '.local/checks/mobile-ux');
fs.mkdirSync(out, { recursive: true });
const report = { fixtures_only: true, native_bridge: 'mocked', passed: false, checks: [], errors: [] };
const pass = name => { report.checks.push({ name, passed: true }); console.log('PASS ' + name); };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
let api, server, browser, page;
async function contained(locator, label) {
  const box = await locator.boundingBox(), viewport = page.viewportSize();
  assert(box && box.x >= -1 && box.x + box.width <= viewport.width + 1 && box.y >= -1 && box.y + box.height <= viewport.height + 1, label + ': ' + JSON.stringify(box));
}
async function go(view) {
  await page.evaluate(view => document.querySelector('.nav-link[data-view="' + view + '"]').click(), view);
  await page.waitForFunction(view => document.body.dataset.mobileView === view, view);
}
(async () => {
  const reservation = net.createServer(), port = await listen(reservation); await new Promise(resolve => reservation.close(resolve));
  const origin = 'http://127.0.0.1:' + port, chosen = 'https://mobile-fixture.daynest.test';
  const data = fs.mkdtempSync(path.join(root, '.local/mobile-ux-fixture-'));
  api = spawn(process.env.DAYNEST_TEST_API || path.join(root, '.local/offline-api.exe'), [], { cwd: root, windowsHide: true, env: { ...process.env, HTTP_ADDR: '127.0.0.1:' + port, JWT_SECRET: crypto.randomBytes(32).toString('hex'), DATA_FILE: path.join(data, 'fixture.json'), SNAPSHOT_INTERVAL: '2s' }, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/healthz')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert(ready, 'isolated API starts');
  const account = (await (await fetch(origin + '/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mobile UX', email: 'mobile-ux@example.test', password: crypto.randomBytes(24).toString('hex') }) })).json()).data;
  const bridge = fs.readFileSync(path.join(root, 'mobile/src/core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'mobile/src/mobile-client.js'), 'utf8').replace('export function boot', 'function boot') + '\n' + fs.readFileSync(path.join(root, 'mobile/src/mobile-ux.js'), 'utf8').replace('export function installMobileUX', 'function installMobileUX') + `
    window.__nativeEvents={}; window.__nativeSaved=[]; window.__nativeCopied=[]; let exportName='',parts=[];
    boot({Http:{request:options=>window.__nativeHTTP(options)},Files:{configure:async()=>{},setSession:async()=>{},cancel:async()=>{},writeClipboard:async value=>window.__nativeCopied.push(value.text),beginExport:async value=>{exportName=value.filename;parts=[];return{id:'ux-export'};},appendExport:async value=>parts.push(value.data),finishExport:async()=>window.__nativeSaved.push({name:exportName,data:parts.join('')})},App:{addListener:async(name,handler)=>{window.__nativeEvents[name]=handler;},minimizeApp:async()=>{}}}); installMobileUX();`;
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/mobile-bridge.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(bridge); return; }
    const file = path.resolve(web, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(web + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  const webPort = await listen(server);
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE });
  page = await browser.newPage({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
  page.on('pageerror', error => report.errors.push(error.message)); page.on('dialog', dialog => dialog.dismiss());
  await page.exposeFunction('__nativeHTTP', async options => {
    const url = new URL(options.url); assert.equal(url.origin, chosen);
    const response = await fetch(origin + url.pathname + url.search, { method: options.method, headers: options.headers, body: options.data });
    return { status: response.status, data: response.status === 204 ? '' : await response.text(), headers: Object.fromEntries(response.headers.entries()), url: options.url };
  });
  await page.addInitScript(({ server, token }) => { localStorage.setItem('daynest.mobile.connection.v1', JSON.stringify({ server, httpAcknowledged: false })); localStorage.setItem('studyflow.token', token); }, { server: chosen, token: account.token });
  await page.goto('http://127.0.0.1:' + webPort); await page.waitForFunction(() => !!window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden);
  const views = await page.locator('.nav-link[data-view]').evaluateAll(nodes => nodes.map(node => node.dataset.view));
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const view of views) {
      await go(view); await page.waitForTimeout(150);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), view + ' page overflow at ' + width);
      await contained(page.locator('#mobile-tabs'), 'bottom tabs');
      pass('layout_' + view + '_' + width);
    }
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.click('[data-mobile-view=all]'); await page.waitForFunction(() => document.getElementById('mobile-functions').open);
  assert.equal(await page.locator('[data-mobile-target]').count(), views.length);
  await page.fill('#mobile-functions-query', '运动'); assert.equal(await page.locator('[data-mobile-target]').count(), 1);
  await page.click('[data-mobile-target=fitness]'); await page.waitForFunction(() => document.body.dataset.mobileView === 'fitness');
  assert.equal(await page.locator('dialog[open]').count(), 0); pass('all_functions_search_and_actual_page_navigation');
  await page.click('#mobile-menu'); await page.fill('#mobile-functions-query', '不存在的功能');
  assert.equal(await page.locator('[data-mobile-target]').count(), 0);
  await page.evaluate(() => window.__nativeEvents.backButton({ canGoBack: true }));
  assert.equal(await page.locator('dialog[open]').count(), 0); pass('all_functions_empty_state_and_android_back');
  await page.click('[data-mobile-view=memos]'); await page.waitForFunction(() => document.body.dataset.mobileView === 'memos');
  await page.click('#memo-new'); await page.waitForFunction(() => document.body.classList.contains('mobile-memo-editor') && !document.getElementById('memo-editor').classList.contains('hidden'));
  await page.waitForFunction(() => Math.abs(document.querySelector('.memo-editor-pane').getBoundingClientRect().left) < 1);
  await contained(page.locator('.memo-workspace'), 'full screen memo workspace'); await contained(page.locator('#memo-save'), 'memo save control');
  await page.fill('#memo-title', '手机布局保存验证'); await page.fill('#memo-content', '保留正在编辑的内容，并通过独立服务端回读。');
  await page.click('#memo-save');
  for (let i = 0; i < 50; i++) {
    const data = await (await fetch(origin + '/api/v1/memos', { headers: { Authorization: 'Bearer ' + account.token } })).json();
    if (JSON.stringify(data).includes('保留正在编辑的内容')) break;
    if (i === 49) throw Error('memo not saved to API');
    await page.waitForTimeout(100);
  }
  pass('full_screen_memo_has_reachable_save_and_persists_to_real_api');
  await page.click('#mobile-memo-tools'); assert.equal(await page.getByRole('button', { name: '永久删除', exact: true }).count(), 0);
  await page.getByRole('button', { name: '阅读预览', exact: true }).click();
  assert.equal(await page.locator('#memo-preview').isVisible(), true); pass('memo_more_actions_preserve_visibility_and_preview');
  await page.click('#mobile-memo-tools'); await page.getByRole('button', { name: '返回编辑', exact: true }).click();
  await page.focus('#memo-content'); await page.setViewportSize({ width: 360, height: 420 });
  await page.waitForFunction(() => document.body.classList.contains('mobile-keyboard-open'));
  assert.equal(await page.locator('#mobile-tabs').isVisible(), false); await contained(page.locator('#memo-save'), 'save above keyboard');
  pass('keyboard_resize_preserves_reachable_editor_actions');
  await page.setViewportSize({ width: 360, height: 800 }); await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => !document.body.classList.contains('mobile-keyboard-open'));
  await page.evaluate(() => window.__nativeEvents.backButton({ canGoBack: true })); await page.waitForFunction(() => !document.body.classList.contains('mobile-memo-editor'));
  assert.equal(await page.inputValue('#memo-content'), '保留正在编辑的内容，并通过独立服务端回读。'); pass('android_back_returns_to_memo_list_without_clearing_editor');
  await page.screenshot({ path: path.join(out, 'memo-list.png') });
  for (const [view, open] of [['bookmarks','bookmark-new'],['ledger','ledger-new'],['subscriptions','sub-new'],['care','care-new'],['fitness','fit-log-open']]) {
    await go(view); await page.click('#' + open); const dialog = page.locator('dialog[open]').last(); await dialog.waitFor();
    await contained(dialog, view + ' dialog');
    await page.evaluate(() => window.__nativeEvents.backButton({ canGoBack: true }));
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
    pass('dialog_' + view + '_fits_and_back_closes');
  }
  await go('transfers'); const chooser = page.waitForEvent('filechooser'); await page.click('#mobile-upload'); await chooser;
  pass('file_upload_shortcut_opens_system_file_chooser');
  await page.click('#ft-connect'); assert.equal(await page.inputValue('#mobile-share-address'), chosen);
  await page.click('#mobile-share-copy'); await page.waitForFunction(() => window.__nativeCopied.length === 1);
  assert.equal(await page.evaluate(() => window.__nativeCopied[0]), chosen);
  await page.evaluate(() => window.__nativeEvents.backButton({ canGoBack: true }));
  pass('cross_device_address_uses_selected_server_and_native_clipboard_without_credentials');
  await page.click('#mobile-send-text'); await page.waitForFunction(() => !document.getElementById('tc-board').hidden);
  assert.equal(await page.locator('#tc-text').isVisible(), true); pass('text_transfer_shortcut_opens_composer');
  await page.click('#theme-toggle'); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.click('[data-mobile-view=all]'); await contained(page.locator('#mobile-functions'), 'dark function list');
  await page.screenshot({ path: path.join(out, 'functions-dark.png') }); pass('dark_mode_function_list');
  await page.click('[data-mobile-action=connection]'); await page.waitForFunction(() => document.getElementById('mobile-connection').open);
  await page.evaluate(() => window.__nativeEvents.backButton({ canGoBack: true })); pass('connection_settings_remain_reachable');
  await page.setViewportSize({ width: 800, height: 390 }); await go('dashboard');
  assert(await page.locator('#mobile-menu').isVisible()); await page.click('#mobile-menu'); await contained(page.locator('#mobile-functions'), 'landscape function list');
  await page.evaluate(() => window.__nativeEvents.backButton({ canGoBack: true })); pass('landscape_keeps_function_navigation_reachable');
  await page.setViewportSize({ width: 360, height: 800 }); await page.click('[data-mobile-view=all]'); await page.click('[data-mobile-action=logout]');
  await page.waitForFunction(() => document.getElementById('mobile-tabs').hidden && !document.getElementById('mobile-functions').open);
  pass('logout_hides_authenticated_navigation_and_function_list');
  assert.deepEqual(report.errors, []); report.passed = true;
})().catch(async error => { console.error(error); report.error = error.message; process.exitCode = 1; try { await page?.screenshot({ path: path.join(out, 'failure.png') }); } catch {} }).finally(async () => {
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); api?.kill();
});
