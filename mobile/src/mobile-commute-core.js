export const stages = [
  { key: 'leave', label: '出门' },
  { key: 'work', label: '上班' },
  { key: 'finish', label: '下班' },
  { key: 'home', label: '到家' },
];

export function dayKey(date, offset = 0) {
  const day = new Date(date);
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    dayKey(new Date(value + 'T12:00:00')) === value;
}

export function clockMinute(day, date) {
  const offset = day === dayKey(date) ? 0 : day === dayKey(date, -1) ? 1440 : null;
  return offset === null ? null : offset + date.getHours() * 60 + date.getMinutes();
}

export function formatMinute(value) {
  if (value == null) return '—';
  const hour = String(Math.floor(value / 60) % 24).padStart(2, '0');
  const minute = String(value % 60).padStart(2, '0');
  return `${value >= 1440 ? '次日 ' : ''}${hour}:${minute}`;
}

export function setStamp(stamps, key, value) {
  if (!stages.some(stage => stage.key === key) ||
      (value !== null && (!Number.isInteger(value) || value < 0 || value >= 2880))) {
    throw Error('请选择有效的时间。');
  }
  const next = { ...stamps };
  if (value === null) delete next[key];
  else next[key] = value;
  let previous;
  for (const stage of stages) {
    const minute = next[stage.key];
    if (minute == null) continue;
    if (previous && minute < previous.minute) {
      throw Error(`${stage.label}时间应晚于或等于${previous.label}时间。`);
    }
    previous = { minute, label: stage.label };
  }
  return next;
}

export function durations(stamps) {
  return [
    ['去程', stamps.leave, stamps.work],
    ['在岗跨度', stamps.work, stamps.finish],
    ['回程', stamps.finish, stamps.home],
  ].map(([label, from, to]) => ({ label, minutes: from == null || to == null ? null : to - from }));
}

export function summarize(rows) {
  return stages.map(({ key, label }) => {
    const minutes = rows.map(row => row.stamps[key]).filter(Number.isInteger);
    const average = minutes.length ? Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length) : null;
    return { label, average, count: minutes.length };
  });
}

export function createCommuteStore(indexedDB) {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(Error('此设备暂时无法保存通勤记录。')); return; }
      const request = indexedDB.open('daynest.commute.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('days', { keyPath: ['scope', 'day'] });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
    }).catch(error => { opening = undefined; throw error; });
    return opening;
  }

  async function read(scope, day) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('days').objectStore('days').get([scope, day]);
      request.onsuccess = () => resolve(request.result?.stamps || {});
      request.onerror = () => reject(request.error);
    });
  }

  async function between(scope, start, end) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound([scope, start], [scope, end]);
      const request = db.transaction('days').objectStore('days').getAll(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function write(scope, day, key, value, expected) {
    if (!validDay(day)) throw Error('请选择有效的记录日期。');
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('days', 'readwrite'), rows = transaction.objectStore('days');
      const query = rows.get([scope, day]);
      let stamps, reason;
      query.onsuccess = () => {
        try {
          const previous = query.result?.stamps || {};
          if ((previous[key] ?? null) !== expected) throw Error('这个时间已更新，请重新查看后再改。');
          stamps = setStamp(previous, key, value);
          if (Object.keys(stamps).length) rows.put({ scope, day, stamps });
          else rows.delete([scope, day]);
        } catch (error) { reason = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(stamps);
      transaction.onabort = () => reject(reason || transaction.error || Error('本机保存未完成。'));
    });
  }
  return { read, between, write };
}
