(() => {
  'use strict';
  const recommended = ['dashboard','calendar','todo','toolkit','meals','fitness','care','memos','moods','ledger','inventory','focus'];
  function defaults(ids) { return { version: 1, compact: true, primary: recommended.filter(id => ids.includes(id)) }; }
  function normalize(value, ids) {
    if (!value || value.version !== 1 || typeof value.compact !== 'boolean' || !Array.isArray(value.primary) || value.primary.length > 64 || !value.primary.every(id => typeof id === 'string' && /^[a-z-]{1,80}$/.test(id))) throw Error('导航偏好格式不正确');
    return { version: 1, compact: value.compact, primary: [...new Set(['dashboard', ...value.primary])].filter(id => ids.includes(id)) };
  }
  function read(raw, ids) {
    if (raw == null) return { value: defaults(ids), recovered: false };
    try { if (raw.length > 16000) throw Error(); return { value: normalize(JSON.parse(raw), ids), recovered: false }; }
    catch (_) { return { value: defaults(ids), recovered: true }; }
  }
  window.DaynestNavigation = { defaults, normalize, read };
})();
