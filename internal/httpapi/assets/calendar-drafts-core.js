(function (root, factory) {
  const store = typeof module === 'object' && module.exports ? require('./draft-store.js') : root.DaynestDraftStore;
  const editor = typeof module === 'object' && module.exports ? require('./calendar-editor-core.js') : root.DaynestCalendarEditorCore;
  const core = factory(store, editor);
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.DaynestCalendarDraftCore = core;
})(typeof window === 'undefined' ? globalThis : window, (store, editor) => {
  'use strict';
  const prefix = 'daynest.calendar-draft.v1:';
  const text = (value, limit) => typeof value === 'string' && value.length <= limit;
  function valid(record) {
    const value = record?.value;
    return record?.version === 1 && typeof record.id === 'string' && /^[\w-]{1,100}$/.test(record.id) &&
      Number.isSafeInteger(record.generation) && record.generation > 0 && Number.isFinite(record.savedAt) &&
      editor.valid(record.base, record.base?.user_id) && typeof record.base.user_id === 'string' && /^[\w-]{1,160}$/.test(record.base.user_id) &&
      (record.submitted === undefined || typeof record.submitted === 'boolean') &&
      JSON.stringify(record.base).length <= 100000 && !!value &&
      text(value.title, 400) && text(value.description, 12000) && text(value.location, 400) && text(value.category, 160) &&
      /^#[a-f0-9]{6}$/i.test(value.color) && typeof value.all_day === 'boolean' &&
      text(value.start, 32) && text(value.end, 32) && text(value.repeat_until, 10) &&
      ['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(value.repeat_rule) &&
      Number.isInteger(value.reminder_minutes) && value.reminder_minutes >= 0 && value.reminder_minutes <= 40320 &&
      (value.timed == null || text(value.timed.start, 32) && text(value.timed.end, 32));
  }
  function readable(record) {
    const value = record.value;
    return [value.title || '未命名日程', `原日程 ${record.base.id}`, `原版本 ${editor.version(record.base)}`,
      '北京时间（UTC+08:00）', `${value.all_day ? '全天日期（含结束日）' : '时间'} ${value.start} 至 ${value.end}`,
      `重复 ${value.repeat_rule}`, `重复截止 ${value.repeat_until || '无'}`, `地点 ${value.location}`,
      `分类 ${value.category}`, `颜色 ${value.color}`, `提前提醒 ${value.reminder_minutes} 分钟`, '', value.description].join('\n');
  }
  return { valid, readable, prefix, scope: store.scope, writerID: store.writerID,
    create(storage, owner) { return store.create(storage, owner, { prefix, settingPrefix: 'daynest.calendar-draft-setting.v1:', valid }); } };
});
