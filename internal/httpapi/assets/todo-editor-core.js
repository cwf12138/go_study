(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.DaynestTodoEditorCore = core;
})(typeof window === 'undefined' ? globalThis : window, () => {
  'use strict';
  const id = value => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
  function valid(todo, userID) {
    return !!todo && id(todo.id) && todo.user_id === userID && id(todo.list_id) &&
      typeof todo.title === 'string' && typeof todo.notes === 'string' &&
      ['open', 'completed'].includes(todo.status) && ['low', 'medium', 'high'].includes(todo.priority) &&
      ['none', 'daily', 'weekly', 'monthly'].includes(todo.repeat_rule) &&
      typeof todo.updated_at === 'string' && Number.isFinite(Date.parse(todo.updated_at)) &&
      (!todo.steps || Array.isArray(todo.steps) && todo.steps.length <= 30 && todo.steps.every(s => id(s.id) && typeof s.title === 'string' && typeof s.completed === 'boolean')) &&
      (!todo.tags || Array.isArray(todo.tags) && todo.tags.every(t => typeof t === 'string')) &&
      (!todo.due_at || Number.isFinite(Date.parse(todo.due_at)));
  }
  const version = todo => todo.id + '@' + todo.updated_at;
  const headers = todo => ({ 'If-Match': '"' + version(todo) + '"' });
  function localTime(value) {
    if (!value) return '';
    const date = new Date(value), pad = v => String(v).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function editable(todo) {
    return { title: todo.title, notes: todo.notes, list_id: todo.list_id, priority: todo.priority,
      due: localTime(todo.due_at), my_day_date: todo.my_day_date || '', repeat_rule: todo.repeat_rule,
      tags: (todo.tags || []).join(', '), steps: (todo.steps || []).map(s => ({ id: s.id, title: s.title, completed: s.completed })) };
  }
  function payload(value, base) {
    const title = value.title.trim(), notes = value.notes.trim();
    if (!title || [...title].length > 200 || [...notes].length > 6000) throw Error('标题需为 1–200 字，备注最多 6000 字。');
    if (value.steps.length > 30 || value.steps.some(s => !s.title.trim() || [...s.title.trim()].length > 200)) throw Error('最多 30 个步骤，每项标题为 1–200 字。');
    if (value.repeat_rule !== 'none' && !value.due) throw Error('重复待办需要设置截止时间。');
    const due = value.due === localTime(base.due_at) ? base.due_at || null : value.due ? new Date(value.due).toISOString() : null;
    return { title, notes, list_id: value.list_id, priority: value.priority, due_at: due,
      my_day_date: base.status === 'completed' ? '' : value.my_day_date, repeat_rule: value.repeat_rule,
      tags: value.tags.split(',').map(t => t.trim()).filter(Boolean),
      steps: value.steps.map(s => ({ id: s.id || '', title: s.title.trim(), completed: !!s.completed })) };
  }
  function describe(todo) {
    return [todo.title, `状态：${todo.status === 'completed' ? '已完成' : '未完成'}`, `优先级：${({ high: '重要', medium: '普通', low: '低' })[todo.priority]}`,
      `截止：${todo.due_at ? new Date(todo.due_at).toLocaleString('zh-CN') : '未设置'}`, `我的一天：${todo.my_day_date || '未加入'}`,
      `重复：${({ none: '不重复', daily: '每天', weekly: '每周', monthly: '每月' })[todo.repeat_rule]}`,
      `标签：${(todo.tags || []).join('、') || '无'}`, '', todo.notes || '无备注', '',
      ...(todo.steps || []).map(s => `${s.completed ? '☑' : '☐'} ${s.title}`)].join('\n');
  }
  return { valid, version, headers, localTime, editable, payload, describe };
});
