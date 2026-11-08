const assert = require('node:assert/strict');
const drafts = require('../internal/httpapi/assets/calendar-drafts-core.js');
const calendar = require('../internal/httpapi/assets/calendar-editor-core.js');
class Storage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index]; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}
const base = {
  id: 'event-one', user_id: 'alice', title: '安排', description: '', location: '', category: '生活', color: '#557766',
  start_at: '2026-11-09T09:00:00.123456789+08:00', end_at: '2026-11-09T10:00:00.123456789+08:00',
  all_day: false, repeat_rule: 'weekly', repeat_until: '2026-12-09T23:59:59.987654321+08:00', reminder_minutes: 15,
  created_at: '2026-11-09T00:00:00Z', updated_at: '2026-11-09T00:00:00Z'
};
const make = (id, generation = 1) => ({ version: 1, id, generation, savedAt: Date.now(), base, value: calendar.editable(base) });
const storage = new Storage();
const alice = drafts.create(storage, drafts.scope('http://fixture', 'alice'));
const bob = drafts.create(storage, drafts.scope('http://fixture', 'bob'));
const other = drafts.create(storage, drafts.scope('http://another', 'alice'));
const record = make('writer-a');
alice.put(record);
const restored = alice.list().records[0];
const payload = calendar.payload(restored.value, restored.base);
assert.equal(payload.start_at, calendar.instant(base.start_at));
assert.equal(payload.repeat_until, calendar.instant(base.repeat_until));
assert.equal(bob.list().records.length, 0);
assert.equal(other.list().records.length, 0);
const newer = { ...record, generation: 2, value: { ...record.value, description: '新文字' } };
alice.put(newer);
alice.remove(record);
assert.equal(alice.list().records[0].value.description, '新文字');
alice.put(make('writer-b'));
assert.equal(alice.list().records.length, 2);
assert(drafts.valid({ ...record, value: { ...record.value, title: '', start: '', end: '' } }));
assert(!drafts.valid({ ...record, value: { ...record.value, all_day: 'true' } }));
assert(!drafts.valid({ ...record, id: undefined }));
assert(!drafts.valid({ ...record, base: { ...base, user_id: undefined } }));
assert(!drafts.valid({ ...record, submitted: 'yes' }));
const allDay = { ...record, value: { ...record.value, all_day: true, start: '2026-11-09', end: '2026-11-11', timed: { start: '2026-11-09T09:00', end: '2026-11-09T10:00' } } };
assert(drafts.valid(allDay));
assert(drafts.readable(allDay).includes('含结束日'));
console.log('Calendar drafts preserve nanoseconds, incomplete forms, all-day fields, independent writers and account/server isolation.');
