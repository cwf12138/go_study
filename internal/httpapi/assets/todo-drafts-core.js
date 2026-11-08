(function (root, factory) {
  const common = typeof module === 'object' && module.exports ? require('./draft-store.js') : root.DaynestDraftStore;
  const editor = typeof module === 'object' && module.exports ? require('./todo-editor-core.js') : root.DaynestTodoEditorCore;
  const api = factory(common, editor);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DaynestTodoDraftCore = api;
})(typeof window === 'undefined' ? globalThis : window, (store, editor) => {
  'use strict';
  const prefix = 'daynest.todo-draft.v1:';
  const text = (value, limit) => typeof value === 'string' && value.length <= limit;
  function valid(record) {
    const value = record?.value;
    return record?.version === 1 && /^[\w-]{1,100}$/.test(record.id) &&
      Number.isSafeInteger(record.generation) && record.generation > 0 && Number.isFinite(record.savedAt) &&
      editor.valid(record.base, record.base?.user_id) && /^[\w-]{1,160}$/.test(record.base.user_id) && JSON.stringify(record.base).length <= 100000 &&
      (record.baseDue === undefined || text(record.baseDue, 32)) &&
      !!value && text(value.title, 400) && text(value.notes, 12000) && text(value.tags, 600) &&
      text(value.list_id, 160) && text(value.due, 32) && text(value.my_day_date, 10) &&
      ['low', 'medium', 'high'].includes(value.priority) && ['none', 'daily', 'weekly', 'monthly'].includes(value.repeat_rule) &&
      Array.isArray(value.steps) && value.steps.length <= 30 && value.steps.every(step => step &&
        text(step.id, 160) && text(step.title, 400) && typeof step.completed === 'boolean');
  }
  function readable(record) {
    const value = record.value;
    return [value.title || '未命名待办', `原任务 ${record.base.id}`, `原版本 ${editor.version(record.base)}`,
      `分类 ${value.list_id}`, `优先级 ${value.priority}`, `截止 ${value.due || '未设置'}`,
      `我的一天 ${value.my_day_date || '未加入'}`, `重复 ${value.repeat_rule}`, `标签 ${value.tags}`, '', value.notes, '',
      ...value.steps.map(step => `${step.completed ? '☑' : '☐'} ${step.title}`)].join('\n');
  }
  return { valid, readable, prefix, scope: store.scope, writerID: store.writerID,
    create(storage, owner) { return store.create(storage, owner, { prefix, settingPrefix: 'daynest.todo-draft-setting.v1:', valid }); } };
});
