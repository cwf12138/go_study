(() => {
  'use strict';
  const privateIP = host => {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
    const p = host.split('.').map(Number); if (p.some(n => n > 255)) return false;
    return p[0] === 10 || p[0] === 192 && p[1] === 168 || p[0] === 172 && p[1] >= 16 && p[1] <= 31;
  };
  function server(raw) {
    const text = String(raw || '').trim();
    if (!/^https?:\/\//i.test(text) || text.length > 500 || /[\\\u0000-\u0020]/.test(text)) throw Error('请填写完整电脑地址，如 http://192.168.1.10:8080');
    const u = new URL(text);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('服务器地址只能包含协议、主机与端口，不能含账号、路径或参数。');
    if (['localhost','127.0.0.1','[::1]','0.0.0.0'].includes(u.hostname)) throw Error('手机上的 localhost 指手机自己，请填写电脑的局域网 IP。模拟器可用 10.0.2.2。');
    if (u.protocol === 'http:' && !privateIP(u.hostname)) throw Error('未加密 HTTP 只允许明确的局域网 IPv4 地址；其他主机请使用可信 HTTPS。');
    if (!['http:','https:'].includes(u.protocol)) throw Error('只支持 HTTP 或 HTTPS。');
    return u.origin;
  }
  function apiPath(value, origin) {
    const url = new URL(String(value), origin);
    if (url.origin !== origin || url.hash || /[\\\u0000-\u001f]/.test(String(value)) || !url.pathname.startsWith('/api/v1/')) throw Error('拒绝向未选择的地址发送应用请求。');
    return url.pathname + url.search;
  }
  function metadata(value) {
    return value && value.application === 'daynest' && value.mobile_protocol === 1 && typeof value.requires_secure_secret === 'boolean';
  }
  function filename(value) { return String(value || 'daynest-file').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-').slice(0,160) || 'daynest-file'; }
  window.DaynestMobileCore = { privateIP, server, apiPath, metadata, filename };
})();
