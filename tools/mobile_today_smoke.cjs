const assert = require('node:assert/strict');
process.env.TZ = 'Asia/Shanghai';

(async () => {
  const { classifyToday } = await import('../mobile/src/mobile-today.js');
  const day = '2026-11-22', now = new Date(day + 'T10:00:00+08:00');
  const todo = (title, values) => ({ title, status: 'open', priority: 'medium', ...values });
  const slot = (title, start, end, all_day = false) => ({ title, occurrence_start: start, occurrence_end: end, all_day });
  const model = classifyToday([
    todo('planned', { my_day_date: day }),
    todo('early', { my_day_date: day, due_at: day + 'T09:00:00+08:00' }),
    todo('later', { due_at: day + 'T16:00:00+08:00' }),
    todo('future', { due_at: '2026-11-23T00:00:00+08:00' }),
    todo('done', { status: 'completed', completed_at: day + 'T08:00:00+08:00' }),
    todo('yesterday', { status: 'completed', completed_at: '2026-11-21T23:59:00+08:00' }),
  ], { events: [
    slot('overnight', '2026-11-21T23:00:00+08:00', day + 'T01:00:00+08:00'),
    slot('all-day', day + 'T00:00:00+08:00', '2026-11-23T00:00:00+08:00', true),
    slot('ongoing', day + 'T09:00:00+08:00', day + 'T11:00:00+08:00'),
    slot('tomorrow', '2026-11-23T00:00:00+08:00', '2026-11-23T01:00:00+08:00'),
  ], plan_blocks: [{ title: 'study', start_at: day + 'T11:00:00+08:00', end_at: day + 'T11:45:00+08:00' }] }, day, now);
  assert.deepEqual(model.lists.pending.map(item => item.todo.title), ['later', 'planned']);
  assert.deepEqual(model.lists.overdue.map(item => item.todo.title), ['early']);
  assert.deepEqual(model.lists.done.map(item => item.todo.title), ['done']);
  assert.deepEqual(model.agenda.map(row => row.item.title), ['all-day', 'overnight', 'ongoing', 'study']);
  assert.deepEqual(model.upcoming.map(row => row.item.title), ['all-day', 'ongoing', 'study']);
  assert.equal(model.lead.item.title, 'ongoing');
  assert.equal(model.upcoming.at(-1).type, 'plan');
  const before = classifyToday([], { events: model.agenda.map(row => row.item) }, day, new Date(day + 'T08:00:00+08:00'));
  assert.equal(before.lead.item.title, 'ongoing', 'finished and all-day events cannot be the next timed event');
  assert.deepEqual(classifyToday([], null, day, now).agenda, []);
  console.log('Android Today model passed: day boundary, overdue time, completed scope, overnight, all-day, and ongoing/next.');
})().catch(error => { console.error(error); process.exitCode = 1; });
