export function boot({ Http, App, Files }) {
  const C = window.DaynestMobileCore, originalFetch = window.fetch.bind(window);
  const configKey = 'daynest.mobile.connection.v1';
  let connection = null, loaded = false, loading = false, busy = false, generation = 0, session = '', fileBusy = false, fatal = false;
  const dialogs = [], pending = new Set();
  const abortError = () => new DOMException('操作已取消；服务端结果仍需核对。', 'AbortError');
  function race(promise, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { promise.catch(() => {}); reject(abortError()); return; }
      const abort = () => reject(abortError()); signal?.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
    });
  }
  async function nativeRequest(origin, path, options = {}) {
    if (options.signal?.aborted) throw abortError();
    const headers = Object.fromEntries(new Headers(options.headers || {}));
    const response = await race(Http.request({ url: origin + path, method: options.method || 'GET', headers, data: options.body, connectTimeout: 8000, readTimeout: 25000, disableRedirects: true, responseType: 'text' }), options.signal);
    if (response.status >= 300 && response.status < 400) throw Error('电脑服务返回重定向，请直接填写最终服务地址；不会自动转发登录令牌。');
    if (response.url && new URL(response.url).origin !== origin) throw Error('服务地址改变，已拒绝展示跨地址响应。');
    if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) throw Error('电脑服务没有返回有效 HTTP 状态。');
    const body = response.status === 204 ? null : typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    return new Response(body, { status: response.status, headers: response.headers || {} });
  }
  window.fetch = function(input, options = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href);
    if (!url.pathname.startsWith('/api/v1/')) return originalFetch(input, options);
    if (!connection) return Promise.reject(Error('请先连接电脑上的 Daynest 服务。'));
    if (url.origin !== location.origin && url.origin !== connection.server) return Promise.reject(Error('拒绝向未选择的服务器发送应用请求。'));
    const path = C.apiPath(url.pathname + url.search, location.origin), version = generation;
    if (path.startsWith('/api/v1/ai/')) return Promise.resolve(new Response(JSON.stringify({ error: { code: 'desktop_only', message: '此 AI 授权功能仅限电脑本机使用；手机版请使用本地推荐。' } }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    if (options.body != null && typeof options.body !== 'string') return Promise.reject(Error('二进制上传请使用手机版文件通道。'));
    const operation = input instanceof Request ? { method: input.method, headers: input.headers, signal: input.signal, ...options } : options;
    return nativeRequest(connection.server, path, operation).then(response => { if (version !== generation) throw abortError(); return response; });
  };
  const token = () => localStorage.getItem('studyflow.token') || '';
  function current(owner, version) { if (owner !== token() || version !== generation) throw abortError(); }
  function base64(bytes) { let out = ''; for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(out); }
  async function saveBlob(blob, name, owner = token()) {
    if (fileBusy) throw Error('另一个文件正在保存，请稍候。');
    if (blob.size > 64 * 1024 * 1024) throw Error('手机版单次导出最多 64 MiB，请在电脑网页端导出更大的文件。');
    fileBusy = true; const version = generation; let id;
    try {
      current(owner, version); await Files.setSession({ token: owner });
      ({ id } = await Files.beginExport({ filename: C.filename(name), mime: blob.type || 'application/octet-stream', size: blob.size, token: owner })); pending.add(id);
      for (let offset = 0; offset < blob.size; offset += 192 * 1024) {
        current(owner, version); const chunk = new Uint8Array(await blob.slice(offset, offset + 192 * 1024).arrayBuffer());
        await Files.appendExport({ id, offset, data: base64(chunk) });
      }
      current(owner, version); await Files.finishExport({ id }); current(owner, version);
    } finally { if (id) { pending.delete(id); await Files.cancel({ id }).catch(() => {}); } fileBusy = false; }
  }
  async function downloadServer(path, name, signal, expectedSize) {
    if (!connection || !token()) throw Error('请先连接并登录。');
    if (fileBusy) throw Error('另一个文件正在保存，请稍候。');
    const route = C.apiPath(path, location.origin), owner = token(), version = generation, id = crypto.randomUUID();
    const cancel = () => Files.cancel({ id }).catch(() => {});
    fileBusy = true; pending.add(id); signal?.addEventListener('abort', cancel, { once: true });
    try { current(owner, version); if (signal?.aborted) throw abortError(); await Files.setSession({ token: owner }); await Files.download({ id, path: route, filename: C.filename(name), token: owner, expectedSize: expectedSize ?? -1 }); current(owner, version); }
    catch (error) { if (error.code === 'CANCELLED') throw abortError(); throw error; }
    finally { fileBusy = false; pending.delete(id); signal?.removeEventListener('abort', cancel); }
  }
  async function uploadFile(item, onProgress, signal) {
    if (item.file.size > 8 * 1024 * 1024) throw Error('手机版上传单文件最多 8 MiB；较大文件请在电脑网页端上传。');
    if (signal?.aborted) throw abortError();
    const owner = token(), version = generation, id = item.id; pending.add(id);
    const cancel = () => Files.cancel({ id }).catch(() => {}); signal?.addEventListener('abort', cancel, { once: true });
    let listener;
    try {
      listener = await Files.addListener('uploadProgress', event => { if (event.id === id && owner === token() && version === generation) onProgress(event.loaded, event.total); });
      current(owner, version); if (signal?.aborted) throw abortError(); await Files.setSession({ token: owner });
      const data = base64(new Uint8Array(await item.file.arrayBuffer())); current(owner, version); if (signal?.aborted) throw abortError();
      return await race(Files.upload({ id, path: '/api/v1/transfers/' + id, filename: item.name, ttl: item.ttl, token: owner, data }), signal);
    } finally { if (listener) await listener.remove(); pending.delete(id); signal?.removeEventListener('abort', cancel); }
  }
  window.DaynestMobile = { native: true, saveBlob, downloadServer, uploadFile, maxUploadBytes: 8 * 1024 * 1024 };

  document.addEventListener('DOMContentLoaded', async () => {
    document.body.classList.add('daynest-native');
    const setup = document.createElement('dialog'); setup.id = 'mobile-connection'; setup.className = 'mobile-connection'; setup.setAttribute('aria-labelledby', 'mobile-title');
    setup.innerHTML = `<header><span class="mobile-mark" aria-hidden="true">D</span><button id="mobile-close" type="button" aria-label="关闭连接设置" hidden>×</button></header><p class="mobile-eyebrow">DAYNEST · ANDROID</p><h1 id="mobile-title">把日常，带在身边。</h1><p>连接电脑上的 Daynest，继续使用同一账号与记录。</p><form id="mobile-form"><label>电脑服务地址<input id="mobile-server" type="url" inputmode="url" placeholder="http://192.168.1.10:8080" maxlength="500" required autocomplete="off" spellcheck="false"></label><label class="mobile-consent"><input id="mobile-consent" type="checkbox"><span>若使用 HTTP，我确认只在可信 Wi-Fi 中连接；登录信息和记录不会加密传输。</span></label><button id="mobile-connect" type="submit">检查并连接</button></form><p id="mobile-state" role="status" aria-live="polite"></p><details><summary>连接前请检查</summary><ol><li>手机和电脑位于同一可信局域网，电脑 Go 服务保持运行。</li><li>填写电脑局域网 IP，不是手机上的 localhost。</li><li>电脑需使用专用 JWT_SECRET；更换后已有网页需要重新登录，历史记录不变。</li><li>由你确认监听地址与防火墙端口，本 App 不会自动修改这些设置。</li></ol><p>这不是离线版。文件与业务记录仍保存在电脑，电脑关机后无法读取或保存；尚未确认保存的内容请保留并核对。</p></details>`;
    document.body.append(setup);
    const $ = id => document.getElementById('mobile-' + id), state = text => { $('state').textContent = text; };
    const bar = document.createElement('button'); bar.type = 'button'; bar.className = 'mobile-server-bar'; bar.textContent = '电脑连接 · 设置'; bar.hidden = true;
    document.querySelector('.workspace').prepend(bar);
    function controls() { $('connect').disabled = busy; $('connect').textContent = fatal ? '重载界面' : busy ? '正在检查…' : '检查并连接'; $('server').disabled = busy; $('consent').disabled = busy; $('close').hidden = !loaded || fatal; }
    function openSettings() { if (!setup.open) setup.showModal(); controls(); }
    async function activate() {
      if (loaded || loading) return; if (fatal) { location.reload(); return; }
      loading = true;
      try {
        await Files.setSession({ token: token() });
        for (const placeholder of document.querySelectorAll('script[data-mobile-src]')) {
          const src = placeholder.dataset.mobileSrc; if (!src.startsWith('/static/')) throw Error('安装包脚本路径无效');
          await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = () => reject(Error('安装包资源不完整，请重载或重新打包。')); document.body.append(script); });
        }
        loaded = true; bar.hidden = false; bar.textContent = '已连接电脑 · 连接设置';
        window.DaynestUI?.registerGuard?.('mobile-files', () => fileBusy || pending.size > 0);
        const transferIntro = document.querySelector('#ft-drop p'); if (transferIntro) transferIntro.textContent = '支持多选 · 当前 App 单文件最多 8 MiB，电脑网页为 32 MiB';
      } catch (error) { fatal = true; state(error.message); throw error; }
      finally { loading = false; }
    }
    async function connect(event) {
      event?.preventDefault(); if (busy) return; if (fatal) { location.reload(); return; } busy = true; controls();
      let credentialsChanged = false;
      try {
        const origin = C.server($('server').value);
        if (origin.startsWith('http:') && !$('consent').checked) throw Error('请先确认 HTTP 的明文传输提示，或改用可信 HTTPS。');
        state('正在检查电脑服务…');
        const response = await nativeRequest(origin, '/api/v1/mobile-info');
        const out = await response.json().catch(() => null);
        if (!response.ok || !C.metadata(out?.data)) throw Error('电脑服务不兼容或地址不正确，请重启新版 Go 服务后再试。');
        if (out.data.requires_secure_secret) throw Error('电脑仍使用公开开发密钥，请设置专用 JWT_SECRET 并重启 Go 服务，再连接手机。');
        const changed = !connection || connection.server !== origin;
        if (changed && pending.size) throw Error('请先完成或取消正在进行的文件操作，再切换电脑。');
        if (loaded && changed && !window.confirm('切换电脑会重新登录，未保存内容可能丢失；原电脑上的记录不会删除。确定切换吗？')) return;
        if (changed) { localStorage.removeItem('studyflow.token'); credentialsChanged = true; localStorage.removeItem('studyflow.focus'); await Files.setSession({ token: '' }); }
        await Files.configure({ server: origin });
        const next = { server: origin, httpAcknowledged: $('consent').checked };
        localStorage.setItem(configKey, JSON.stringify(next));
        connection = next; generation++;
        if (loaded && changed) { history.replaceState(null, '', '/#dashboard'); location.reload(); return; }
        state('电脑已连接，正在准备界面…'); await activate(); setup.close();
      } catch (error) { if (credentialsChanged && loaded) fatal = true; state((error.message || '连接失败，请检查同一 Wi-Fi、IP、端口和电脑服务。') + (fatal ? ' 请点击按钮重载界面后重试。' : '')); }
      finally { busy = false; controls(); }
    }
    $('form').addEventListener('submit', connect); bar.addEventListener('click', openSettings); $('close').addEventListener('click', () => setup.close());
    setup.addEventListener('cancel', event => { if (!loaded || busy || fatal) event.preventDefault(); });
    $('server').addEventListener('input', () => { $('consent').checked = false; });
    try { const saved = JSON.parse(localStorage.getItem(configKey) || 'null'); if (saved) { connection = { server: C.server(saved.server), httpAcknowledged: saved.httpAcknowledged === true }; $('server').value = connection.server; $('consent').checked = connection.httpAcknowledged; } } catch (_) { state('已忽略无效的本机连接设置，请重新输入电脑地址。'); }
    openSettings(); if (connection) connect();

    function syncSession() { const next = token(); if (next !== session) { session = next; for (const id of pending) Files.cancel({ id }).catch(() => {}); pending.clear(); Files.setSession({ token: next }).catch(() => {}); } }
    document.addEventListener('daynest:account-ready', syncSession);
    document.getElementById('logout').addEventListener('click', () => { queueMicrotask(syncSession); });
    window.addEventListener('storage', event => { if (event.key === 'studyflow.token' || event.key === null) syncSession(); });
    document.addEventListener('click', event => {
      const anchor = event.target.closest?.('a[download]'); if (!anchor || !/^(blob:|data:)/.test(anchor.href)) return;
      event.preventDefault(); const owner = token();
      originalFetch(anchor.href).then(response => response.blob()).then(blob => saveBlob(blob, anchor.download || 'daynest-export', owner)).then(() => window.DaynestUI?.notify('文件已保存到你选择的位置。')).catch(error => { if (error.code !== 'CANCELLED' && error.name !== 'AbortError') window.DaynestUI?.notify(error.message || '保存失败，请重试。', 'error'); });
    }, true);
    new MutationObserver(records => { for (const record of records) if (record.target.tagName === 'DIALOG') { const index = dialogs.indexOf(record.target); if (index >= 0) dialogs.splice(index, 1); if (record.target.open) dialogs.push(record.target); } }).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
    await App.addListener('backButton', ({ canGoBack }) => {
      const top = dialogs.filter(dialog => dialog.open).at(-1) || [...document.querySelectorAll('dialog[open]')].at(-1);
      if (top === setup && (!loaded || fatal)) { App.minimizeApp(); return; }
      if (top) { const event = new Event('cancel', { cancelable: true }); if (top.dispatchEvent(event)) top.close(); return; }
      if (document.querySelector('.sidebar.open')) { window.DaynestUI?.setMenu(false); return; }
      if (canGoBack) history.back(); else App.minimizeApp();
    });
    await App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) { window.dispatchEvent(new Event('daynest:mobile-pause')); return; }
      if (!loaded || !connection || busy || fatal) return;
      try { const res = await nativeRequest(connection.server, '/api/v1/mobile-info'); if (!res.ok) throw Error(); bar.textContent = '已连接电脑 · 连接设置'; if (token()) document.getElementById('app-sync-retry')?.click(); }
      catch (_) { bar.textContent = '电脑暂不可达 · 检查连接'; }
    });
  });
}
