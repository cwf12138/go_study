(() => {
  'use strict';
  window.DaynestCalendarDrafts = window.DaynestEditorDrafts.create({
    core: window.DaynestCalendarDraftCore, editorCore: window.DaynestCalendarEditorCore,
    kind: '日程', namespace: 'cd', beforeID: 'calendar-recovery-open'
  });
})();
