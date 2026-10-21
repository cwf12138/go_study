(() => {
  'use strict';
  // Device-local scheduling: wall-clock deadlines, no interval accumulation.
  const MINUTE = 60000, KINDS = ['water', 'move'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const clock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  function fresh() {
    const channel = minutes => ({ enabled: true, minutes, dueAt: 0, remaining: minutes * MINUTE, pendingAt: 0, notified: false, cycle: 1 });
    return { version: 1, revision: 0, configRevision: 0, running: false, deferFocus: true,
      notifications: false, snoozeMinutes: 5, window: { enabled: false, start: '09:00', end: '22:00' },
      channels: { water: channel(45), move: channel(60) }, history: [] };
  }
  function validateSettings(s) {
    if (!s || typeof s.deferFocus !== 'boolean' || typeof s.notifications !== 'boolean' ||
        typeof s.window?.enabled !== 'boolean' || !clock(s.window.start) || !clock(s.window.end) ||
        (s.window.enabled && s.window.start === s.window.end)) throw Error('请设置有效且不同的开始、结束时间。');
    for (const kind of KINDS) {
      const c = s.channels?.[kind];
      if (!c || typeof c.enabled !== 'boolean' || !integer(c.minutes, 5, 180)) throw Error('提醒间隔请填写 5–180 之间的整数分钟。');
    }
    if (![5, 10, 15].includes(s.snoozeMinutes)) throw Error('稍后提醒间隔请选择 5、10 或 15 分钟。');
    if (!KINDS.some(k => s.channels[k].enabled)) throw Error('请至少开启一种提醒。');
  }
  function parse(raw) {
    if (raw === null) return fresh();
    if (typeof raw !== 'string' || raw.length > 1000000) throw Error('本机提醒数据过大或格式不正确。');
    const s = JSON.parse(raw);
    validateSettings(s);
    if (s.version !== 1 || !integer(s.revision, 0, 1e12) || !integer(s.configRevision, 0, 1e12) ||
        typeof s.running !== 'boolean' || !Array.isArray(s.history) || s.history.length > 5000) throw Error('提醒数据格式不正确。');
    for (const k of KINDS) {
      const c = s.channels[k];
      if (![c.dueAt, c.pendingAt].every(n => integer(n, 0, 9e15)) || !integer(c.remaining, 0, 180 * MINUTE) ||
          !integer(c.cycle, 1, 1e12) || typeof c.notified !== 'boolean') throw Error('提醒计时数据不正确。');
    }
    if (!s.history.every(h => KINDS.includes(h.kind) && integer(h.at, 1, 9e15))) throw Error('提醒记录格式不正确。');
    return s;
  }
  const dateKey = at => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  function inWindow(s, now) {
    if (!s.window.enabled) return true;
    const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const d = new Date(now), current = d.getHours() * 60 + d.getMinutes(), start = minutes(s.window.start), end = minutes(s.window.end);
    return start < end ? current >= start && current < end : current >= start || current < end;
  }
  function focusBlocked(focus, owner, now) {
    if (!focus || focus.userID !== owner || focus.status !== 'running' ||
        !['focus', 'focus_first', 'focus_second'].includes(focus.phase)) return false;
    const start = Date.parse(focus.phaseStartedAt), remaining = focus.phaseRemainingSeconds;
    return Number.isFinite(start) && Number.isFinite(remaining) && remaining > 0 && now < start + remaining * 1000;
  }
  function blocked(s, now, focus) {
    if (!s.running) return 'paused';
    if (!inWindow(s, now)) return 'quiet';
    return s.deferFocus && focus ? 'focus' : '';
  }
  function remaining(s, kind, now) {
    const c = s.channels[kind];
    return s.running ? Math.max(0, c.dueAt - now) : c.remaining;
  }
  // Pending reminders remain one per channel, even after hours asleep.
  function tick(input, now) {
    const s = copy(input);
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 6); cutoff.setHours(0, 0, 0, 0);
    s.history = s.history.filter(h => h.at >= cutoff.getTime());
    if (s.running) for (const k of KINDS) {
      const c = s.channels[k];
      if (c.enabled && c.dueAt <= now && !c.pendingAt) { c.pendingAt = now; c.notified = false; }
    }
    return s;
  }
  function restart(s, kind, now, delay) {
    const c = s.channels[kind];
    c.remaining = delay ?? c.minutes * MINUTE;
    c.dueAt = s.running && c.enabled ? now + c.remaining : 0;
    c.pendingAt = 0; c.notified = false; c.cycle++;
  }
  function change(input, action, now) {
    const s = copy(input);
    if (action.type === 'settings') {
      validateSettings(action.settings);
      if (action.configRevision !== s.configRevision) throw Error('设置已在另一个窗口修改。请点击“重新载入设置”后再编辑。');
      const v = action.settings;
      s.deferFocus = v.deferFocus; s.notifications = v.notifications; s.snoozeMinutes = v.snoozeMinutes; s.window = copy(v.window);
      for (const k of KINDS) {
        const c = s.channels[k], v2 = v.channels[k], reset = c.minutes !== v2.minutes || c.enabled !== v2.enabled;
        c.enabled = v2.enabled; c.minutes = v2.minutes;
        if (reset) restart(s, k, now);
      }
      s.configRevision++;
    } else if (action.type === 'start') {
      if (!s.running) {
        s.running = true;
        for (const k of KINDS) if (s.channels[k].enabled) s.channels[k].dueAt = now + s.channels[k].remaining;
      }
    } else if (action.type === 'pause') {
      if (s.running) {
        for (const k of KINDS) {
          const c = s.channels[k]; c.remaining = Math.min(180 * MINUTE, remaining(s, k, now));
          c.dueAt = 0; c.pendingAt = 0; c.notified = false;
        }
        s.running = false;
      }
    } else if (['done', 'snooze', 'skip'].includes(action.type)) {
      if (!KINDS.includes(action.kind)) throw Error('无效的提醒类型。');
      const c = s.channels[action.kind];
      // A stale button in another tab must not count twice or dismiss a new cycle.
      if (!c.enabled || action.cycle !== c.cycle) return s;
      if (action.type === 'snooze' && (!c.pendingAt || !s.running)) return s;
      if (action.type === 'done') {
        // A double click on the always-available manual confirmation is one act.
        if (s.history.some(h => h.kind === action.kind && now >= h.at && now - h.at < 2000)) return s;
        const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 6); cutoff.setHours(0, 0, 0, 0);
        s.history = s.history.filter(h => h.at >= cutoff.getTime()).concat({ kind: action.kind, at: now }).slice(-5000);
      }
      if (action.type === 'snooze' && ![5, 10, 15].includes(action.minutes)) throw Error('请选择 5、10 或 15 分钟后提醒。');
      restart(s, action.kind, now, action.type === 'snooze' ? action.minutes * MINUTE : undefined);
    } else throw Error('无效的提醒操作。');
    return s;
  }
  function today(s, now) {
    const key = dateKey(now), rows = s.history.filter(h => dateKey(h.at) === key);
    return { water: rows.filter(h => h.kind === 'water').length, move: rows.filter(h => h.kind === 'move').length, rows };
  }
  const duration = ms => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; };
  window.DaynestReminders = { MINUTE, KINDS, fresh, parse, validateSettings, inWindow, focusBlocked, blocked, remaining, tick, change, today, duration };
})();
