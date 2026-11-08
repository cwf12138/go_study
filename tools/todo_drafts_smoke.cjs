const assert = require('node:assert/strict');
const core = require('../internal/httpapi/assets/todo-drafts-core.js');
const editor = require('../internal/httpapi/assets/todo-editor-core.js');
class Storage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index]; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}
const base = { id: 'todo-a', user_id: 'alice', list_id: 'inbox', title: '任务', notes: '', status: 'open', priority: 'medium', repeat_rule: 'none', updated_at: '2026-11-09T00:00:00Z', steps: [] };
const make = (id, generation = 1) => ({ version: 1, id, generation, savedAt: Date.now(), base, value: editor.editable(base) });
const storage = new Storage();
const alice = core.create(storage, core.scope('http://fixture', 'alice'));
const bob = core.create(storage, core.scope('http://fixture', 'bob'));
const otherServer = core.create(storage, core.scope('http://other', 'alice'));
const original = make('writer-one');
original.value.title = ''; // Partially edited forms must remain recoverable.
original.value.steps = [{ id: '', title: '', completed: false }];
assert(core.valid(original));
alice.put(original);
assert.equal(bob.list().records.length, 0);
assert.equal(otherServer.list().records.length, 0);
const next = { ...original, generation: 2, value: { ...original.value, notes: '更新后的文字' } };
alice.put(next);
alice.remove(original);
assert.equal(alice.list().records[0].value.notes, '更新后的文字');
assert.throws(() => alice.put(original));
const anotherTab = make('writer-two');
alice.put(anotherTab);
assert.equal(alice.list().records.length, 2);
alice.setEnabled(false);
assert.equal(alice.enabled(), false);
assert.equal(bob.enabled(), true);
alice.clear();
for (let index = 0; index < 40; index++) alice.put(make('writer-' + index));
assert.throws(() => alice.put(make('over-capacity')), /空间/);
assert.equal(alice.list().records.length, 40);
assert(!core.valid({ ...make('bad'), value: { ...editor.editable(base), steps: [{ id: '', title: '', completed: 'yes' }] } }));
assert(core.readable(next).includes('更新后的文字'));
console.log('Todo drafts preserve incomplete fields, account/server isolation, independent writers, immutable generations, settings and bounded capacity.');
