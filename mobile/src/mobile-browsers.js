export function installMobileBrowsers(Browsers) {
  document.addEventListener('DOMContentLoaded', () => {
    const link = document.getElementById('english-original-link');
    const settings = document.getElementById('english-browser-choice');
    if (!link || !settings) return;
    settings.hidden = false;
    let pending = false;
    const openArticle = async (event, choose) => {
      event.preventDefault();
      const url = link.getAttribute('href');
      if (pending || !url) return;
      pending = true;
      try {
        await Browsers.openArticle({url, choose});
      } catch (error) {
        window.DaynestUI?.notify(error.message || '原文暂时无法打开。', 'error');
      } finally {
        pending = false;
      }
    };
    link.addEventListener('click', event => openArticle(event, false));
    settings.addEventListener('click', event => openArticle(event, true));
  }, {once: true});
}
