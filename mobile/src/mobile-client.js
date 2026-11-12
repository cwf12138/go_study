export function boot({ Http, App, Files, defaultServer = '' }) {
  const C = window.DaynestMobileCore, originalFetch = window.fetch.bind(window);
  const configKey = 'daynest.mobile.connection.v1';
  const primaryKey = 'daynest.mobile.primary-server.v1', primaryServer = defaultServer ? C.server(defaultServer) : '';
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
    if (response.status >= 300 && response.status < 400) throw Error('服务返回重定向，请填写最终服务地址；不会自动转发登录令牌。');
    if (response.url && new URL(response.url).origin !== origin) throw Error('服务地址改变，已拒绝展示跨地址响应。');
    if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) throw Error('服务暂时无法响应，请稍后重试。');
    const body = response.status === 204 ? null : typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    return new Response(body, { status: response.status, headers: response.headers || {} });
  }
  window.fetch = function(input, options = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href);
    if (!url.pathname.startsWith('/api/v1/')) return originalFetch(input, options);
    if (!connection) return Promise.reject(Error('请先连接 Daynest 服务。'));
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
  async function todoOutboxRequest(path,options={}) {
    const method=(options.method||'GET').toUpperCase(),allowed=method==='GET'&&(path==='/api/v1/me'||/^\/api\/v1\/todo-imports\/[A-Za-z0-9_-]{16,100}$/.test(path))||method==='POST'&&path==='/api/v1/todo-imports';
    if(!allowed||!connection||connection.server!==options.expectedServer)throw Error('本机收集的请求或电脑地址不匹配。');
    const owner=token(),version=generation,headers=new Headers(options.headers||{});
    if(!owner||headers.get('Authorization')!=='Bearer '+owner)throw Error('账号已变化，请重新核验后提交。');
    const response=await nativeRequest(connection.server,path,{method,headers,body:options.body,signal:options.signal});current(owner,version);return response;
  }
  window.DaynestMobile = { native: true, saveBlob, todoOutboxRequest, downloadServer, uploadFile, maxUploadBytes: 8 * 1024 * 1024,
    copyText: text => Files.writeClipboard({ text }), readText: async () => (await Files.readClipboard()).text };

  document.addEventListener('DOMContentLoaded', async () => {
    document.body.classList.add('daynest-native');
    const setup = document.createElement('dialog'); setup.id = 'mobile-connection'; setup.className = 'mobile-connection'; setup.setAttribute('aria-labelledby', 'mobile-title');
    setup.innerHTML = `<header><span class="mobile-mark" aria-hidden="true">D</span><button id="mobile-close" type="button" aria-label="关闭连接设置" hidden>×</button></header><p class="mobile-eyebrow">DAYNEST · ANDROID</p><h1 id="mobile-title">把日常，带在身边。</h1><p>日程、待办与心情，随时回到你的日常。</p><form id="mobile-form"><details id="mobile-advanced"><summary>连接设置</summary><label>服务地址<input id="mobile-server" type="url" inputmode="url" placeholder="https://111.230.184.144" maxlength="500" required autocomplete="off" spellcheck="false"></label><label id="mobile-http-notice" class="mobile-consent"><input id="mobile-consent" type="checkbox"><span>使用局域网 HTTP 时，我确认只连接可信网络；登录信息和记录不会加密传输。</span></label><p>默认已配置个人云端服务，无需电脑保持开机。只有连接自己的其他服务时，才需要修改地址。</p></details><button id="mobile-connect" type="submit">重新连接</button></form><button id="mobile-offline" type="button" class="mobile-offline-button">离线资料与本机收集 ↗</button><p id="mobile-state" role="status" aria-live="polite"></p><p class="mobile-footnote">账号与记录保存在所连接的服务中。网络恢复后可继续使用，本机草稿会保留供你核对。</p>`;
    document.body.append(setup);
    const reader=document.createElement('dialog');reader.id='mobile-offline-reader';reader.className='mobile-offline-reader';reader.setAttribute('aria-label','离线资料与本机收集');
    reader.innerHTML='<button id="mobile-offline-close" type="button" aria-label="关闭离线资料与本机收集">‹ 返回应用</button><iframe id="mobile-offline-frame" title="离线资料与本机收集"></iframe>';
    document.body.append(reader);

    const $ = id => document.getElementById('mobile-' + id), state = text => { $('state').textContent = text; };
    const bar = document.createElement('button'); bar.type = 'button'; bar.id = 'mobile-server-bar'; bar.className = 'mobile-server-bar'; bar.textContent = '服务连接 · 设置'; bar.hidden = true;
    document.querySelector('.workspace').prepend(bar);
    function controls() { $('connect').disabled = busy; $('connect').textContent = fatal ? '重载界面' : busy ? '正在连接…' : '重新连接'; $('server').disabled = busy; $('consent').disabled = busy; $('close').hidden = !loaded || fatal; $('offline').disabled = !connection; $('http-notice').hidden = !$('server').value.startsWith('http:'); }
    function openSettings() { if (!setup.open) setup.showModal(); controls(); }
    window.DaynestMobile.openConnectionSettings=openSettings;
    window.DaynestMobile.getConnectionInfo=()=>({server:connection?.server||''});
    async function closeReader(){const guard=$('offline-frame').contentWindow?.DaynestLocalInbox;if(guard&&!(await guard.prepareClose()))return;reader.close();$('offline-frame').src='about:blank';}
    window.DaynestMobile.openOfflineReader=section=>{if(!connection){state('请先登录一次，在原账号准备离线资料或本机收集。');return;}$('offline-frame').src='/static/offline-reader.html?server='+encodeURIComponent(connection.server)+(['todos','agenda','capture'].includes(section)?'#'+section:'');if(!reader.open)reader.showModal();};
    $('offline').addEventListener('click',window.DaynestMobile.openOfflineReader);
    $('offline-close').addEventListener('click',closeReader);
    reader.addEventListener('cancel',event=>{event.preventDefault();closeReader();});reader.addEventListener('close',()=>{const frame=$('offline-frame'),guard=frame.contentWindow?.DaynestLocalInbox;Promise.resolve(guard?.beforeDetach?.()).finally(()=>{if(!reader.open)frame.src='about:blank';});});
    window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===$('offline-frame').contentWindow&&event.data?.type==='daynest:offline-close')closeReader();});

    async function activate() {
      if (loaded || loading) return; if (fatal) { location.reload(); return; }
      loading = true;
      try {
        await Files.setSession({ token: token() });
        for (const placeholder of document.querySelectorAll('script[data-mobile-src]')) {
          const src = placeholder.dataset.mobileSrc; if (!src.startsWith('/static/')) throw Error('安装包脚本路径无效');
          await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = () => reject(Error('安装包资源不完整，请重载或重新打包。')); document.body.append(script); });
        }
        loaded = true; bar.hidden = false; bar.dataset.connectionState = 'online'; bar.textContent = '已连接服务 · 连接设置';
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
        state('正在安全连接你的 Daynest…');
        const response = await nativeRequest(origin, '/api/v1/mobile-info');
        const out = await response.json().catch(() => null);
        if (!response.ok || !C.metadata(out?.data)) throw Error('服务暂时不可用或版本不兼容，请稍后重试。');
        if (out.data.requires_secure_secret) throw Error('服务仍使用公开开发密钥，请配置专用 JWT_SECRET 后再连接。');
        const changed = !connection || connection.server !== origin;
        if (changed && pending.size) throw Error('请先完成或取消正在进行的文件操作，再切换服务。');
        if (loaded && changed && !window.confirm('切换服务需要重新登录，请先保存当前编辑。原服务上的记录会保留。确定切换吗？')) return;
        if (changed) { localStorage.removeItem('studyflow.token'); credentialsChanged = true; localStorage.removeItem('studyflow.focus'); await Files.setSession({ token: '' }); }
        await Files.configure({ server: origin });
        const next = { server: origin, httpAcknowledged: $('consent').checked };
        localStorage.setItem(configKey, JSON.stringify(next));
        if (primaryServer) localStorage.setItem(primaryKey, primaryServer);
        connection = next; generation++;
        if (loaded && changed) { history.replaceState(null, '', '/#dashboard'); location.reload(); return; }
        state('已连接，正在准备你的日常…'); await activate(); setup.close();
      } catch (error) { if (credentialsChanged && loaded) fatal = true; state((error.message || '暂时无法连接，请检查手机网络后重试。') + (fatal ? ' 请点击按钮重载界面后重试。' : '')); }
      finally { busy = false; controls(); }
    }
    $('form').addEventListener('submit', connect); bar.addEventListener('click', openSettings); $('close').addEventListener('click', () => setup.close());
    setup.addEventListener('cancel', event => { if (!loaded || busy || fatal) event.preventDefault(); });
    $('server').addEventListener('input', () => { $('consent').checked = false; controls(); });
    try {
      const saved = JSON.parse(localStorage.getItem(configKey) || 'null');
      const adoptPrimary = primaryServer && localStorage.getItem(primaryKey) !== primaryServer;
      if (saved && (!adoptPrimary || C.server(saved.server) === primaryServer)) {
        connection = { server: C.server(saved.server), httpAcknowledged: saved.httpAcknowledged === true };
        $('server').value = connection.server; $('consent').checked = connection.httpAcknowledged;
      } else if (primaryServer) { $('server').value = primaryServer; }
    } catch (_) { state('已忽略无效的本机连接设置，请重新选择服务。'); if (primaryServer) $('server').value = primaryServer; }
    openSettings(); if (connection || primaryServer) connect();

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
      if (window.DaynestMobileUX?.back()) return;
      if (canGoBack) history.back(); else App.minimizeApp();
    });
    await App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) { window.dispatchEvent(new Event('daynest:mobile-pause')); return; }
      if (!loaded || !connection || busy || fatal) return;
      try { const res = await nativeRequest(connection.server, '/api/v1/mobile-info'); if (!res.ok) throw Error(); bar.dataset.connectionState = 'online'; bar.textContent = '已连接服务 · 连接设置'; if (token()) document.getElementById('app-sync-retry')?.click(); }
      catch (_) { bar.dataset.connectionState = 'offline'; bar.textContent = '服务暂不可达 · 检查连接'; }
    });
  });
}
