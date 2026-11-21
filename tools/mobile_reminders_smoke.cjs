const assert = require('node:assert/strict');

(async () => {
  const { calendarReminderEntries } = await import('../mobile/src/mobile-reminders.js');
  const now = Date.parse('2026-11-20T15:55:00Z');
  const start = '2026-11-20', end = '2026-12-26';
  const event = (id, occurrence, reminder) => ({
    occurrence_id: id, occurrence_start: new Date(occurrence).toISOString(), reminder_minutes: reminder,
  });
  const events = [
    event('recurring@slot', now + 20 * 60_000, 10),
    event('late-but-pending', now + 5 * 60_000, 10),
    event('too-far', now + 8 * 86_400_000, 10),
    event('off', now + 20 * 60_000, 0),
    event('past', now - 60_000, 10),
  ];
  const result = calendarReminderEntries({ start, end, events }, start, end, now);
  assert.deepEqual(result.entries.map(row => row.id), ['recurring@slot', 'late-but-pending']);
  assert.equal(result.entries[0].date, '2026-11-21');
  assert.equal(result.entries[0].at, now + 10 * 60_000);
  assert.deepEqual(calendarReminderEntries({ start, end, events: null }, start, end, now).entries, []);
  assert.throws(() => calendarReminderEntries({ start, end }, start, end, now), /不完整/);
  assert.throws(() => calendarReminderEntries({ start, end, events: [events[0], events[0]] }, start, end, now), /异常/);
  assert.throws(() => calendarReminderEntries({ start, end, events: [event('bad', now + 1000, -1)] }, start, end, now), /异常/);
  const many = Array.from({ length: 260 }, (_, i) => event('next-' + i, now + 20 * 60_000 + i, 10));
  const capped = calendarReminderEntries({ start, end, events: many }, start, end, now);
  assert.equal(capped.entries.length, 256);
  assert.equal(capped.limited, true);
  console.log('Android calendar reminders: completed snapshot, timezone, deadline, recurring key, invalid response and queue limit checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
