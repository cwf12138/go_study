(function (root, factory) {
  const cache = typeof module === 'object' && module.exports ? require('./read-cache-core.js') : root.DaynestReadCacheCore;
  const core = factory(cache);
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.DaynestCalendarEditorCore = core;
})(typeof window === 'undefined' ? globalThis : window, R => {
  'use strict';
  const PREFIX = 'daynest.calendar-command.v1:', MAX_ROWS = 20, MAX_BYTES = 65536;
  const id = v => typeof v === 'string' && /^[\w-]{1,160}$/.test(v);
  const trim = v => String(v ?? '').replace(/^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g, '');
  const rules = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
  function instant(value) {
    const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value || '');
    if (!match || !Number.isFinite(Date.parse(value))) throw Error('日期时间格式无效。');
    const fraction = (match[2] || '').replace(/0+$/, '');
    return new Date(value).toISOString().slice(0, 19) + (fraction ? '.' + fraction : '') + 'Z';
  }
  function nanos(value) {
    const text = instant(value), fraction = text.slice(19).replace(/[.Z]/g, '').padEnd(9, '0');
    return BigInt(Date.parse(text.slice(0, 19) + 'Z')) * 1000000n + BigInt(fraction);
  }
  function interval(start, end) { try { const duration = nanos(end) - nanos(start); return duration > 0n && duration <= 31622400000000000n; } catch (_) { return false; } }
  const day = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10);
  const wall = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
  function date(value) {
    if (!/^\d{4}-\d\d-\d\d$/.test(value || '') || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw Error('请选择有效日期。');
    return value;
  }
  const shift = (value, n) => new Date(Date.parse(date(value) + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  function iso(value, midnight = false) {
    const d = value.slice(0, 10); date(d);
    if (!midnight && !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('请选择有效时间。');
    return instant(d + 'T' + (midnight ? '00:00' : value.slice(11)) + ':00+08:00');
  }
  function lastDay(start, end) { const d = day(end); return instant(end) === iso(d, true) ? shift(d, -1) : d; }
  function valid(event, userID) {
    return !!event && id(event.id) && event.user_id === userID && ['title', 'description', 'location', 'category'].every(k => typeof event[k] === 'string') &&
      /^#[a-f0-9]{6}$/i.test(event.color || '') && typeof event.all_day === 'boolean' && rules.includes(event.repeat_rule) &&
      Number.isInteger(event.reminder_minutes) && event.reminder_minutes >= 0 && event.reminder_minutes <= 40320 &&
      ['start_at', 'end_at', 'updated_at', 'created_at'].every(k => typeof event[k] === 'string' && Number.isFinite(Date.parse(event[k]))) && interval(event.start_at, event.end_at) && (!event.repeat_until || Number.isFinite(Date.parse(event.repeat_until)));
  }
  const version = event => event.id + '@' + event.updated_at;
  const headers = event => ({ 'If-Match': '"' + version(event) + '"' });
  function editable(event) {
    return { title: event.title, description: event.description, location: event.location, category: event.category, color: event.color.toLowerCase(),
      start: event.all_day ? day(event.start_at) : wall(event.start_at), end: event.all_day ? lastDay(event.start_at, event.end_at) : wall(event.end_at), all_day: event.all_day,
      repeat_rule: event.repeat_rule, repeat_until: event.repeat_until ? day(event.repeat_until) : '', reminder_minutes: event.reminder_minutes };
  }
  function normalize(value, normalizeAllDay = true) {
    const body = {};
    for (const [key, max] of [['title', 160], ['description', 6000], ['location', 240], ['category', 60]]) {
      body[key] = trim(value[key]); if ([...body[key]].length > max) throw Error(`文字超出限制：标题 160 字、说明 6000 字、地点 240 字、分类 60 字。`);
    }
    if (!body.title) throw Error('请填写日程标题。');
    body.category = body.category || '学习'; body.color = trim(value.color || '#5b81ff').toLowerCase();
    if (!/^#[a-f0-9]{6}$/.test(body.color)) throw Error('颜色格式无效。');
    body.start_at = instant(value.start_at); body.end_at = instant(value.end_at); body.all_day = !!value.all_day;
    if (nanos(body.end_at) <= nanos(body.start_at)) throw Error('结束时间必须晚于开始时间。');
    if (body.all_day && normalizeAllDay) { const first = day(body.start_at), last = lastDay(body.start_at, body.end_at); body.start_at = iso(first, true); body.end_at = iso(shift(last, 1), true); }
    if (!interval(body.start_at, body.end_at)) throw Error('单个日程最多跨越 366 天。');
    body.repeat_rule = value.repeat_rule || 'none'; if (!rules.includes(body.repeat_rule)) throw Error('重复规则无效。');
    body.repeat_until = body.repeat_rule !== 'none' && value.repeat_until ? instant(value.repeat_until) : null;
    if (body.repeat_until && nanos(body.repeat_until) < nanos(body.start_at)) throw Error('重复截止不能早于开始时间。');
    body.reminder_minutes = Number(value.reminder_minutes);
    if (!Number.isInteger(body.reminder_minutes) || body.reminder_minutes < 0 || body.reminder_minutes > 40320) throw Error('提醒时间无效。');
    return body;
  }
  function payload(value, base) {
    const original = base ? editable(base) : null;
    const sameTimes = original && value.all_day === original.all_day && value.start === original.start && value.end === original.end;
    let start, end;
    if (sameTimes) { start = base.start_at; end = base.end_at; }
    else if (value.all_day) { date(value.start); date(value.end); if (value.end < value.start) throw Error('结束日期不能早于开始日期。'); start = iso(value.start, true); end = iso(shift(value.end, 1), true); }
    else { start = iso(value.start); end = iso(value.end); }
    const until = original && value.repeat_until === original.repeat_until ? base.repeat_until || null : value.repeat_until ? instant(date(value.repeat_until) + 'T23:59:59.999999999+08:00') : null;
    return normalize({ ...value, start_at: start, end_at: end, repeat_until: until }, !sameTimes);
  }
  function fingerprint(value) {
    const b = normalize(value);
    return R.hash(['daynest.calendar-create.v1', b.title, b.description, b.location, b.category, b.color, b.start_at, b.end_at, String(b.all_day), b.repeat_rule, b.repeat_until || '', String(b.reminder_minutes)].map(v => R.bytes(v) + ':' + v).join(''));
  }
  function result(value, context, command) {
    const r = value?.receipt, event = value?.event;
    if (typeof value?.created !== 'boolean' || !r || !id(r.id) || r.user_id !== context.userID || r.request_id !== command.request_id || r.schema_version !== 1 || !id(r.event_id) || r.fingerprint !== command.fingerprint || !Number.isFinite(Date.parse(r.created_at)) || event !== null && (!valid(event, context.userID) || event.id !== r.event_id)) throw Error('回执与原提交不一致，请保留本机记录并核对。');
    return value;
  }
  function commands(storage, context) {
    const scope = R.scope(context.server, context.userID), baseKey = PREFIX + scope + ':', prefix = baseKey + 'command:';
    function check(row) {
      if (!row || row.schema_version !== 1 || row.server !== R.origin(context.server) || row.userID !== context.userID || !/^[\w-]{16,100}$/.test(row.request_id || '') || !Number.isFinite(Date.parse(row.created_at)) || row.fingerprint !== fingerprint(row.body) || JSON.stringify(normalize(row.body)) !== JSON.stringify(row.body)) throw Error('本机日程提交记录损坏，未自动覆盖或清理。');
      return row;
    }
    function read() {
      const rows = [];
      for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (!key?.startsWith(prefix)) continue;
        const raw = storage.getItem(key); if (!raw || R.bytes(raw) > MAX_BYTES) throw Error('本机日程提交记录超限。');
        const row = check(JSON.parse(raw)); if (prefix + row.request_id !== key) throw Error('本机提交标识与索引不一致。'); row.known_deleted = storage.getItem(baseKey + 'deleted:' + row.request_id) === '1'; row.confirmed = row.known_deleted || storage.getItem(baseKey + 'confirmed:' + row.request_id) === '1'; row.missing = storage.getItem(baseKey + 'missing:' + row.request_id) === '1'; rows.push(row);
      }
      return rows.sort((a, b) => Number(a.confirmed&&!a.missing) - Number(b.confirmed&&!b.missing) || b.created_at.localeCompare(a.created_at));
    }
    function put(body) {
      if (read().length >= MAX_ROWS) throw Error('已有 20 项日程待核对，请先核对或导出清理。');
      const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
      const request_id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      const row = { schema_version: 1, server: R.origin(context.server), userID: context.userID, request_id, body: normalize(body), fingerprint: fingerprint(body), created_at: new Date().toISOString() };
      const raw = JSON.stringify(row), key = prefix + request_id; if (R.bytes(raw) > MAX_BYTES || storage.getItem(key)) throw Error('无法安全保留新提交。');
      storage.setItem(key, raw); if (storage.getItem(key) !== raw) throw Error('未能保留原始提交，已停止发送。'); return row;
    }
    function remove(row) { const raw = storage.getItem(prefix + row.request_id); if (!raw) return; const current = check(JSON.parse(raw)); if (current.fingerprint !== row.fingerprint) throw Error('本机记录已变化，未清理。'); storage.removeItem(prefix + row.request_id); storage.removeItem(baseKey + 'deleted:' + row.request_id); storage.removeItem(baseKey + 'confirmed:' + row.request_id); storage.removeItem(baseKey + 'missing:' + row.request_id); }
    function markDeleted(row) { if(!storage.getItem(prefix+row.request_id))return; storage.removeItem(baseKey+'missing:'+row.request_id); const key = baseKey + 'deleted:' + row.request_id; storage.setItem(key, '1'); if (storage.getItem(key) !== '1') throw Error('未能保留已删除标记，请导出并清理本机原记录。'); }
    function markConfirmed(row) { if(!storage.getItem(prefix+row.request_id))return; const key = baseKey + 'confirmed:' + row.request_id; storage.setItem(key, '1'); if (storage.getItem(key) !== '1') throw Error('服务已返回确认，但本机确认标记尚未保留；原内容仍在，请稍后核对。'); storage.removeItem(baseKey+'missing:'+row.request_id); }
    function markMissing(row) { if(!storage.getItem(prefix+row.request_id))return; const key=baseKey+'missing:'+row.request_id; storage.setItem(key,'1'); if(storage.getItem(key)!=='1')throw Error('未能保留回执待核对标记。'); }
    return { read, put, remove, markDeleted, markConfirmed, markMissing };
  }
  function covered(start, end, from, to) {
    let first = day(start), last = lastDay(start, end); if (from && first < from) first = from; if (to && last >= to) last = shift(to, -1);
    const rows = []; for (let d = first; d <= last && rows.length < 370; d = shift(d, 1)) rows.push(d); return rows;
  }
  function describe(event) {
    return [event.title, event.all_day ? `全天：${day(event.start_at)} 至 ${lastDay(event.start_at, event.end_at)}（含当天）` : `北京时间：${wall(event.start_at).replace('T', ' ')} 至 ${wall(event.end_at).replace('T', ' ')}`,
      `重复：${({ none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' })[event.repeat_rule]}`, `重复截止：${event.repeat_until ? day(event.repeat_until) : '无'}`, `分类：${event.category}`, `地点：${event.location || '未填写'}`, `提前提醒：${event.reminder_minutes} 分钟`, '', event.description || '无说明'].join('\n');
  }
  return { PREFIX, trim, day, wall, date, shift, iso, instant, lastDay, valid, version, headers, editable, normalize, payload, fingerprint, result, commands, covered, describe };
});
