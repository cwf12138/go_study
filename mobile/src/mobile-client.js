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
    const readTimeout = path === '/api/v1/meals/ai/recommend' ? 65000 : 25000;
    const response = await race(Http.request({ url: origin + path, method: options.method || 'GET', headers, data: options.body, connectTimeout: 8000, readTimeout, disableRedirects: true, responseType: 'text' }), options.signal);
    if (response.status >= 300 && response.status < 400) throw Error('服务返回重定向，请填写最终服务地址；不会自动转发登录令牌。');
    if (response.url && new URL(response.url).origin !== origin) throw Error('服务地址改变，已拒绝展示跨地址响应。');
    if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) throw Error('服务暂时无法响应，请稍后重试。');
    const body = response.status === 204 ? null : typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    return new Response(body, { status: response.status, headers: response.headers || {} });
  }
  async function checkServer(origin, signal) {
    const response = await nativeRequest(origin, '/api/v1/mobile-info', { signal });
    const result = await response.json().catch(() => null);
    if (!response.ok || !C.metadata(result?.data)) throw Error('服务暂时不可用或版本不兼容，请稍后重试。');
    if (result.data.requires_secure_secret) throw Error('服务仍使用公开开发密钥，请配置专用 JWT_SECRET 后再连接。');
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
    const authView = document.getElementById('auth-view');
    const authVisible = () => !authView.classList.contains('hidden');
    const setup = document.createElement('dialog'); setup.id = 'mobile-connection'; setup.className = 'mobile-connection'; setup.setAttribute('aria-labelledby', 'mobile-title');
    setup.innerHTML = `<header><h2 id="mobile-title">服务连接</h2><button id="mobile-close" type="button" aria-label="关闭连接设置">×</button></header><form id="mobile-form"><details id="mobile-advanced"><summary>编辑服务地址</summary><label>服务地址<input id="mobile-server" type="url" inputmode="url" placeholder="https://example.com" maxlength="500" required autocomplete="off" spellcheck="false"></label><label id="mobile-http-notice" class="mobile-consent"><input id="mobile-consent" type="checkbox"><span>我确认正在使用可信的局域网。通过 HTTP 传输的登录信息和记录不会加密。</span></label></details><p id="mobile-state" role="status" aria-live="polite"></p><button id="mobile-connect" type="submit">连接服务</button></form><button id="mobile-offline" type="button" class="mobile-offline-button">离线资料与本机收集</button>`;
    document.body.append(setup);
    const reader=document.createElement('dialog');reader.id='mobile-offline-reader';reader.className='mobile-offline-reader';reader.setAttribute('aria-label','离线资料与本机收集');
    reader.innerHTML='<button id="mobile-offline-close" type="button" aria-label="关闭离线资料与本机收集">‹ 返回应用</button><iframe id="mobile-offline-frame" title="离线资料与本机收集"></iframe>';
    document.body.append(reader);

    const $ = id => document.getElementById('mobile-' + id), state = text => { $('state').textContent = text; };
    const bar = document.createElement('button'); bar.type = 'button'; bar.id = 'mobile-server-bar'; bar.className = 'mobile-server-bar'; bar.textContent = '服务连接 · 设置'; bar.hidden = true;
    document.querySelector('.workspace').prepend(bar);
    let foregroundCheck;
    function updateConnectionStatus(online) {
      bar.dataset.connectionState = online ? 'online' : 'offline';
      bar.textContent = online ? '已连接服务 · 连接设置' : '服务暂不可达 · 检查连接';
    }
    function controls() { $('connect').disabled = busy; $('connect').textContent = fatal ? '重新加载' : busy ? '正在连接…' : '连接服务'; $('server').disabled = busy; $('consent').disabled = busy; $('close').disabled = busy; $('close').hidden = fatal && !authVisible(); $('offline').disabled = !connection; $('http-notice').hidden = !$('server').value.startsWith('http:'); }
    function openSettings() { if (!setup.open) setup.showModal(); controls(); }
    window.DaynestMobile.openConnectionSettings=openSettings;
    window.DaynestMobile.getConnectionInfo=()=>({server:connection?.server||''});
    async function closeReader(){const guard=$('offline-frame').contentWindow?.DaynestLocalInbox;if(guard&&!(await guard.prepareClose()))return;reader.close();$('offline-frame').src='about:blank';}
    window.DaynestMobile.openOfflineReader=section=>{if(!connection){state('请先登录一次，在原账号准备离线资料或本机收集。');return;}$('offline-frame').src='/static/offline-reader.html?server='+encodeURIComponent(connection.server)+(['todos','agenda','capture'].includes(section)?'#'+section:'');if(!reader.open)reader.showModal();};
    $('offline').addEventListener('click',window.DaynestMobile.openOfflineReader);
    const auth = installMobileAuth({
      openSettings,
      retry: () => fatal ? location.reload() : connect(),
      offline: () => window.DaynestMobile.openOfflineReader(),
    });
    window.DaynestMobile.showAuthError = auth.showError;
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
        loaded = true; bar.hidden = false;
        document.dispatchEvent?.(new Event('daynest:mobile-ready'));
        window.DaynestUI?.registerGuard?.('mobile-files', () => fileBusy || pending.size > 0);
        const transferIntro = document.querySelector('#ft-drop p'); if (transferIntro) transferIntro.textContent = '支持多选 · 当前 App 单文件最多 8 MiB，电脑网页为 32 MiB';
      } catch (error) { fatal = true; state(error.message); throw error; }
      finally { loading = false; }
    }
    async function connect(event) {
      event?.preventDefault(); if (busy) return; if (fatal) { location.reload(); return; } busy = true; controls();
      foregroundCheck?.abort();
      if (!loaded || authVisible()) auth.connection('connecting');
      let credentialsChanged = false;
      let origin, checking = false;
      try {
        origin = C.server($('server').value);
        if (origin.startsWith('http:') && !$('consent').checked) throw Error('请先确认 HTTP 的明文传输提示，或改用可信 HTTPS。');
        state('正在检查服务连接…');
        checking = true;
        await checkServer(origin);
        checking = false;
        const changed = !connection || connection.server !== origin;
        if (changed && pending.size) throw Error('请先完成或取消正在进行的文件操作，再切换服务。');
        if (loaded && changed && !window.confirm('切换服务需要重新登录，请先保存当前编辑。原服务上的记录会保留。确定切换吗？')) { auth.connection('ready', '', !!connection); return; }
        if (changed) {
          await window.DaynestMobileReminders?.clearForAccount();
          localStorage.removeItem('studyflow.token'); credentialsChanged = true; localStorage.removeItem('studyflow.focus'); await Files.setSession({ token: '' });
        }
        if (changed || !loaded) await Files.configure({ server: origin });
        const next = { server: origin, httpAcknowledged: $('consent').checked };
        localStorage.setItem(configKey, JSON.stringify(next));
        if (primaryServer) localStorage.setItem(primaryKey, primaryServer);
        connection = next;
        if (changed) generation++;
        if (loaded && changed) { history.replaceState(null, '', '/#dashboard'); location.reload(); return; }
        await activate(); updateConnectionStatus(true); state('已连接'); auth.connection('ready', '', !!connection); setup.close();
      } catch (error) {
        if (credentialsChanged && loaded) fatal = true;
        const message = (error.message || '暂时无法连接，请检查手机网络后重试。') + (fatal ? ' 请重新加载后再试。' : '');
        state(message);
        if (checking && origin === connection?.server) updateConnectionStatus(false);
        auth.connection(loaded && !fatal ? 'ready' : 'offline', message, !!connection);
      }
      finally { busy = false; controls(); }
    }
    $('form').addEventListener('submit', connect); bar.addEventListener('click', openSettings); $('close').addEventListener('click', () => setup.close());
    setup.addEventListener('cancel', event => { if (busy || (fatal && !authVisible())) event.preventDefault(); });
    $('server').addEventListener('input', () => { $('consent').checked = false; controls(); });
    try {
      const saved = JSON.parse(localStorage.getItem(configKey) || 'null');
      const adoptPrimary = primaryServer && localStorage.getItem(primaryKey) !== primaryServer;
      if (saved && (!adoptPrimary || C.server(saved.server) === primaryServer)) {
        connection = { server: C.server(saved.server), httpAcknowledged: saved.httpAcknowledged === true };
        $('server').value = connection.server; $('consent').checked = connection.httpAcknowledged;
      } else if (primaryServer) { $('server').value = primaryServer; }
    } catch (_) { state('已忽略无效的本机连接设置，请重新选择服务。'); if (primaryServer) $('server').value = primaryServer; }
    if (connection || primaryServer) connect();
    else {
      auth.connection('offline', $('state').textContent || '填写服务地址后即可登录。');
      $('advanced').open = true; openSettings();
    }

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
      if (top === setup && fatal && !authVisible()) { App.minimizeApp(); return; }
      if (top) { const event = new Event('cancel', { cancelable: true }); if (top.dispatchEvent(event)) top.close(); return; }
      if (authVisible() && auth.back()) return;
      if (document.querySelector('.sidebar.open')) { window.DaynestUI?.setMenu(false); return; }
      if (window.DaynestMobileUX?.back()) return;
      if (canGoBack) history.back(); else App.minimizeApp();
    });
    await App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) { foregroundCheck?.abort(); window.dispatchEvent(new Event('daynest:mobile-pause')); return; }
      if (busy || fatal || setup.open || reader.open) return;
      if (!loaded) {
        const expected = connection?.server || primaryServer;
        if (expected && $('server').value === expected) await connect();
        return;
      }
      if (!connection || (foregroundCheck && !foregroundCheck.signal.aborted)) return;
      const check = new AbortController();
      foregroundCheck = check;
      try {
        await checkServer(connection.server, check.signal);
        if (check.signal.aborted) return;
        updateConnectionStatus(true);
        if (token()) document.getElementById('app-sync-retry')?.click();
      } catch (_) {
        if (!check.signal.aborted) updateConnectionStatus(false);
      } finally {
        if (foregroundCheck === check) foregroundCheck = undefined;
      }
    });
  });
}

function installMobileAuth(actions) {
  const root = document.getElementById('auth-view');
  const hero = root.querySelector('.hero'), card = root.querySelector('.auth-card');
  const tabs = card.querySelector('.tabs');
  const login = document.getElementById('login-form'), register = document.getElementById('register-form');
  const forms = [login, register];
  hero.innerHTML = `<div class="auth-brand"><span class="auth-brand-mark" aria-hidden="true">✓</span><span>Daynest</span></div>
    <div class="auth-hero-art" aria-hidden="true"><i></i><i></i><i></i></div>
    <p>安排日程，记录生活。</p>`;
  const intro = document.createElement('header');
  intro.innerHTML = '<h1 id="mobile-auth-heading">欢迎回来</h1><p id="mobile-auth-description">使用邮箱登录你的 Daynest 账号。</p>';
  card.prepend(intro);
  root.setAttribute('aria-labelledby', 'mobile-auth-heading');
  tabs.removeAttribute('role');
  const note = document.createElement('span'); tabs.prepend(note);
  card.append(tabs);
  card.querySelector('.hint')?.remove();
  const oldOffline = document.getElementById('auth-offline-open');
  if (oldOffline) oldOffline.hidden = true;
  const status = document.createElement('section');
  status.className = 'mobile-auth-connection';
  status.innerHTML = '<p role="status"></p><button type="button" class="quiet" hidden>重试连接</button>';
  intro.after(status);
  const help = document.createElement('footer');
  help.className = 'mobile-auth-help';
  help.innerHTML = '<button type="button" id="mobile-auth-settings">连接设置</button><button type="button" id="mobile-auth-offline" hidden>离线资料</button>';
  card.append(help);
  const retry = status.querySelector('button'), settings = help.firstElementChild, offline = help.lastElementChild;
  retry.addEventListener('click', actions.retry);
  settings.addEventListener('click', actions.openSettings);
  offline.addEventListener('click', actions.offline);

  const hidePasswords = forms.map(form => {
    const password = form.querySelector('input[type="password"]');
    form.querySelector('input[type="email"]').enterKeyHint = 'next';
    password.enterKeyHint = form === login ? 'go' : 'done';
    const group = document.createElement('div'); group.className = 'mobile-auth-password-field';
    const field = document.createElement('div'); field.className = 'mobile-auth-password';
    const visibility = document.createElement('button'); visibility.type = 'button';
    visibility.setAttribute('aria-controls', password.id);
    const toggle = show => {
      password.type = show ? 'text' : 'password';
      visibility.textContent = show ? '隐藏' : '显示';
      visibility.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    };
    const label = password.closest('label'); label.htmlFor = password.id;
    label.before(group); group.append(label, field); field.append(password, visibility); toggle(false);
    visibility.addEventListener('click', () => toggle(password.type === 'password'));
    visibility.addEventListener('pointerdown', event => { if (document.activeElement === password) event.preventDefault(); });
    const submit = form.querySelector('[type="submit"]');
    submit.textContent = form === login ? '登录' : '创建账号';
    const error = document.createElement('p');
    error.className = 'mobile-auth-error'; error.id = form.id + '-error'; error.setAttribute('role', 'alert'); error.hidden = true;
    submit.before(error);
    form.addEventListener('input', () => { error.hidden = true; });
    form.addEventListener('submit', () => { error.hidden = true; });
    document.addEventListener('daynest:account-ready', () => { toggle(false); error.hidden = true; });
    return () => { if (password.type !== 'password') toggle(false); };
  });
  const heading = intro.querySelector('h1'), description = intro.querySelector('p');
  heading.tabIndex = -1;
  tabs.addEventListener('click', event => {
    if (event.target.closest('[data-auth-tab]')) requestAnimationFrame(() => heading.focus({ preventScroll: true }));
  });
  const submitButtons = forms.map(form => form.querySelector('[type="submit"]'));
  function render() {
    const registering = !register.classList.contains('hidden');
    const restoring = !card.querySelector('#auth-connection').hidden;
    const pending = submitButtons.some(button => button.disabled);
    const ready = root.dataset.mobileConnection === 'ready';
    heading.textContent = registering ? '创建 Daynest 账号' : '欢迎回来';
    description.textContent = registering ? '填写昵称、邮箱和密码。' : '使用邮箱登录你的 Daynest 账号。';
    note.textContent = registering ? '已有账号？' : '第一次使用？';
    for (const [index, button] of [...tabs.querySelectorAll('button')].entries()) {
      button.hidden = (index === 1) === registering;
      button.disabled = pending;
    }
    settings.disabled = pending || root.dataset.mobileConnection === 'connecting';
    offline.disabled = pending;
    tabs.hidden = !ready || restoring;
    for (const [index, form] of forms.entries()) {
      form.inert = !ready || restoring;
      form.setAttribute('aria-busy', String(submitButtons[index].disabled));
      submitButtons[index].textContent = submitButtons[index].disabled ? (index ? '正在创建…' : '正在登录…') : (index ? '创建账号' : '登录');
      if (form.classList.contains('hidden')) {
        hidePasswords[index]();
        form.querySelector('.mobile-auth-error').hidden = true;
      }
    }
  }
  const observer = new MutationObserver(render);
  for (const form of forms) observer.observe(form, { attributes: true, attributeFilter: ['class'] });
  for (const button of submitButtons) observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  observer.observe(card.querySelector('#auth-connection'), { attributes: true, attributeFilter: ['hidden'] });
  return {
    back() {
      if (submitButtons.some(button => button.disabled)) return true;
      if (register.classList.contains('hidden')) return false;
      tabs.querySelector('[data-auth-tab="login"]').click();
      return true;
    },
    connection(phase, message = '', canReadOffline = false) {
      root.dataset.mobileConnection = phase;
      status.hidden = phase === 'ready';
      status.querySelector('p').textContent = phase === 'connecting' ? '正在检查服务连接…' : message;
      retry.hidden = phase !== 'offline';
      offline.hidden = !canReadOffline;
      render();
    },
    showError(formID, error) {
      const slot = document.getElementById(formID + '-error');
      if (!slot) return false;
      slot.textContent = error.status === 401 ? '邮箱或密码不正确，请检查后重试。'
        : error.status === 409 ? '此邮箱已注册，请登录。'
        : error.status === 429 ? '操作太频繁，请稍后再试。'
        : error.status >= 500 || !error.status ? '暂时无法完成请求，请检查连接后重试。' : error.message;
      slot.hidden = false;
      return true;
    },
  };
}
