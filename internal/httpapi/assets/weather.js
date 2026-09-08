(() => {
  'use strict';
  const app = document.getElementById('app-view');
  const topbar = document.querySelector('.topbar');
  if (!app || !topbar) return;
  const key = 'studyflow.weather.location';
  let location = null, data = null, loadedAt = 0, generation = 0, busy = false, controller;
  let searchGeneration = 0, searchController;
  const validLocation = value => value && typeof value.name === 'string' && value.name.length <= 160 && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
  try { const saved = JSON.parse(localStorage.getItem(key)); if (validLocation(saved)) location = saved; } catch (_) { /* Storage can be disabled. */ }
  const widget = document.createElement('button');
  widget.type = 'button'; widget.className = 'weather-widget'; widget.setAttribute('aria-haspopup', 'dialog');
  widget.innerHTML = '<span class="weather-symbol" aria-hidden="true">⛅</span><span class="weather-copy"><strong>当前天气</strong><small>选择城市，开启天气小组件</small></span><span class="weather-temp">—</span>';
  topbar.insertBefore(widget, topbar.querySelector('.user-actions'));
  const dialog = document.createElement('dialog'); dialog.className = 'weather-dialog'; dialog.setAttribute('aria-labelledby', 'weather-title');
  dialog.innerHTML = `<header><h3 id="weather-title">此刻的天气</h3><button type="button" class="quiet" data-close aria-label="关闭天气详情">✕</button></header>
    <div class="weather-detail">选择城市后显示天气</div>
    <div class="weather-tools"><button type="button" class="quiet" data-locate>◎ 使用当前位置</button><button type="button" class="quiet" data-refresh>↻ 刷新天气</button></div>
    <form class="weather-search"><input aria-label="城市名称" placeholder="搜索城市，如北京 / Shanghai" minlength="2" maxlength="80" required><button class="primary" type="submit">搜索</button></form>
    <p class="weather-status" role="status" aria-live="polite"></p><div class="weather-results"></div>
    <p class="weather-source">每 15 分钟自动更新 · 位置仅保存在本浏览器<br>天气模型数据：<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> · 地名：GeoNames<br>仅主动定位时请求浏览器授权；查询时经纬度会发送至天气服务。天气仅供日常参考。</p>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const status = message => { $('.weather-status').textContent = message; };
  const active = () => !app.classList.contains('hidden') && !!localStorage.getItem('studyflow.token');
  function description(code, day) {
    if (code === 0) return [day ? '☀️' : '🌙', '晴'];
    if (code <= 2) return [day ? '🌤️' : '☁️', '多云'];
    if (code === 3) return ['☁️', '阴'];
    if ([45,48].includes(code)) return ['🌫️', '雾'];
    if ([71,73,75,77,85,86].includes(code)) return ['❄️', '降雪'];
    if (code >= 95) return ['⛈️', '雷雨'];
    if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return ['🌧️', '降雨'];
    return ['⛅', '天气未知'];
  }
  const number = (value, suffix) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) + suffix : '—';
  function render(message = '') {
    const current = data?.current;
    const [icon, label] = current ? description(current.weather_code, current.is_day) : ['⛅', ''];
    widget.querySelector('.weather-symbol').textContent = icon;
    widget.querySelector('strong').textContent = location?.name || '当前天气';
    widget.querySelector('small').textContent = message || (current ? `${label} · 点击查看详情` : '选择城市，开启天气小组件');
    widget.querySelector('.weather-temp').textContent = current ? number(current.temperature_2m, '°') : '—';
    widget.dataset.night = String(current?.is_day === 0);
    widget.setAttribute('aria-label', `${location?.name || '选择城市'}，${current ? number(current.temperature_2m, '摄氏度') + '，' + label : '天气未加载'}，${message || '查看天气详情'}`);
    let updated = '—';
    if (current) {
      try { updated = new Intl.DateTimeFormat('zh-CN', { timeZone: data.timezone, month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(current.time * 1000)); } catch (_) { updated = new Date(current.time * 1000).toLocaleString(); }
    }
    $('.weather-detail').textContent = current
      ? `${location.name} · ${label}  ${number(current.temperature_2m, '°C')}\n体感 ${number(current.apparent_temperature, '°C')}　湿度 ${number(current.relative_humidity_2m, '%')}\n风速 ${number(current.wind_speed_10m, ' km/h')}\n最高 ${number(data.daily?.temperature_2m_max?.[0], '°C')}　最低 ${number(data.daily?.temperature_2m_min?.[0], '°C')}\n数据时间 ${updated}（当地）${message ? '\n' + message : ''}`
      : message || '选择城市后显示天气';
    $('[data-refresh]').disabled = busy || !location;
  }
  async function request(path, signal) {
    const response = await fetch('/api/v1/weather' + path, { signal, headers: { Authorization: 'Bearer ' + localStorage.getItem('studyflow.token') } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 404 ? '天气接口不存在，请重启 Go 服务后刷新页面' : response.status === 401 ? '登录已过期，请重新登录' : payload.error?.message || `天气请求失败（${response.status}）`);
    if (!payload.data) throw new Error('天气接口返回空数据');
    return payload.data;
  }
  async function refresh() {
    if (!location || !active() || busy) return;
    busy = true; const version = ++generation;
    controller = new AbortController(); const timer = setTimeout(() => controller?.abort(), 14000);
    render(data ? '正在更新…（显示上次数据）' : '正在获取天气…');
    try {
      const result = await request(`?latitude=${location.latitude}&longitude=${location.longitude}`, controller.signal);
      if (version !== generation) return;
      if (!result.current || !Number.isFinite(result.current.temperature_2m)) throw new Error('天气数据不完整');
      data = result; loadedAt = Date.now(); busy = false; render(); status('天气已更新');
    } catch (error) {
      if (version !== generation) return;
      busy = false; loadedAt = Date.now();
      const message = error.name === 'AbortError' ? '天气请求超时，请重试' : error.message;
      render(data ? '更新失败 · 当前显示上次数据' : '天气暂不可用 · 点击重试'); status(message);
      if (!data) $('.weather-detail').textContent = message;
    } finally { clearTimeout(timer); if (version === generation) busy = false; }
  }
  function select(value) {
    if (!validLocation(value)) { status('城市坐标无效，请重新搜索'); return; }
    controller?.abort(); generation++; busy = false; location = value; data = null; loadedAt = 0;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Still usable without persistence. */ }
    $('.weather-results').replaceChildren(); refresh();
  }
  widget.addEventListener('click', () => { dialog.showModal(); if (!location) $('.weather-search input').focus(); });
  $('[data-close]').addEventListener('click', () => dialog.close());
  $('[data-refresh]').addEventListener('click', refresh);
  $('.weather-search').addEventListener('submit', async event => {
    event.preventDefault(); const query = $('.weather-search input').value.trim();
    if (query.length < 2) { status('请至少输入两个字符'); return; }
    searchController?.abort(); const version = ++searchGeneration; const abort = new AbortController(); searchController = abort;
    const timer = setTimeout(() => abort.abort(), 14000);
    status('正在搜索城市…'); $('.weather-results').replaceChildren();
    try {
      const result = await request('/locations?q=' + encodeURIComponent(query), abort.signal);
      if (version !== searchGeneration) return;
      const results = Array.isArray(result.results) ? result.results.filter(validLocation) : [];
      status(results.length ? '请选择城市' : '未找到城市，请尝试拼音或英文名称');
      for (const item of results) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = [item.name, item.admin1, item.country].filter(Boolean).join(' · ');
        button.addEventListener('click', () => select({ name: item.name, latitude: item.latitude, longitude: item.longitude }));
        $('.weather-results').append(button);
      }
    } catch (error) { if (version === searchGeneration) status(error.name === 'AbortError' ? '城市搜索超时，请重试' : error.message); }
    finally { clearTimeout(timer); }
  });
  $('[data-locate]').addEventListener('click', () => {
    if (!navigator.geolocation) { status('浏览器不支持定位，请搜索城市'); return; }
    const button = $('[data-locate]'); button.disabled = true; status('等待定位授权…');
    navigator.geolocation.getCurrentPosition(position => {
      button.disabled = false;
      if (!active()) return;
      select({ name:'当前位置', latitude:Math.round(position.coords.latitude * 1000)/1000, longitude:Math.round(position.coords.longitude * 1000)/1000 });
    }, () => { button.disabled = false; status('定位失败或未授权，请搜索城市（定位需 HTTPS 或 localhost）'); }, { timeout:10000, maximumAge:300000, enableHighAccuracy:false });
  });
  function sync() {
    if (!active()) { controller?.abort(); searchController?.abort(); searchGeneration++; generation++; busy = false; data = null; loadedAt = 0; dialog.close(); render(); return; }
    if (!document.hidden && Date.now() - loadedAt >= 15 * 60 * 1000) refresh();
  }
  new MutationObserver(sync).observe(app, { attributes:true, attributeFilter:['class'] });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('online', () => { loadedAt = 0; sync(); });
  setInterval(sync, 60 * 1000);
  render(); sync();
})();
