const assert = require('node:assert/strict');
process.env.TZ = 'Asia/Shanghai';

(async () => {
  const { clockMinute, dayKey, durations, formatMinute, setStamp, summarize, validDay } = await import('../mobile/src/mobile-commute-core.js');
  const now = new Date('2026-11-22T01:05:00+08:00');
  assert.equal(dayKey(now, -1), '2026-11-21');
  assert.equal(clockMinute('2026-11-22', now), 65);
  assert.equal(clockMinute('2026-11-21', now), 1505);
  assert.equal(clockMinute('2026-11-20', now), null);
  assert.equal(formatMinute(1505), '次日 01:05');
  assert.equal(formatMinute(0), '00:00');
  assert(!validDay('2026-02-31'));
  assert(!validDay('2026-11-36'));
  assert(validDay('2024-02-29'));

  let stamps = setStamp({}, 'leave', 1305);
  stamps = setStamp(stamps, 'work', 1335);
  stamps = setStamp(stamps, 'finish', 1505);
  stamps = setStamp(stamps, 'home', 1535);
  assert.deepEqual(durations(stamps).map(item => item.minutes), [30, 170, 30]);
  assert.throws(() => setStamp(stamps, 'finish', 65), /下班时间应晚于或等于上班时间/);
  assert.throws(() => setStamp(stamps, 'unknown', 715), /有效的时间/);
  assert.throws(() => setStamp(stamps, 'finish', 2880), /有效的时间/);
  assert.deepEqual(setStamp(stamps, 'finish', null), { leave: 1305, work: 1335, home: 1535 });
  const average = summarize([{ stamps }, { stamps: { leave: 1315, finish: 1515 } }]);
  assert.deepEqual(average.map(item => [item.average, item.count]), [[1310, 2], [1335, 1], [1510, 2], [1535, 1]]);
  assert.deepEqual(durations({ finish: 1000 }).map(item => item.minutes), [null, null, null]);
  console.log('Android commute model passed: timestamp order, dates, overnight duration, corrections, and partial averages.');
})().catch(error => { console.error(error); process.exitCode = 1; });
