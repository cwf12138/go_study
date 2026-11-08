(() => {
  'use strict';
  window.DaynestTodoDrafts = window.DaynestEditorDrafts.create({
    core: window.DaynestTodoDraftCore, editorCore: window.DaynestTodoEditorCore,
    kind: '待办', sourceName: '任务', namespace: 'td', beforeID: 'todo-local-open',
    metadata: base => ({ baseDue: window.DaynestTodoEditorCore.localTime(base.due_at) })
  });
})();
