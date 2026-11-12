(() => {
  'use strict';
  const groups = [...document.querySelectorAll('[data-workspace-views]')];
  function update() {
    const view = document.querySelector('.panel.active')?.id.replace('panel-', '');
    for (const group of groups) {
      const views = group.dataset.workspaceViews.split(' ');
      group.hidden = !views.includes(view);
      for (const button of group.querySelectorAll('[data-view]')) {
        if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    }
  }
  const observer = new MutationObserver(update);
  for (const panel of document.querySelectorAll('.panel')) observer.observe(panel, {attributes: true, attributeFilter: ['class']});
  update();
})();
