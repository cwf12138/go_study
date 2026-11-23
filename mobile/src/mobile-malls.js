import { dayKey } from './mobile-commute-core.js';
import { createMallStore, filterMalls, groupsForVisits, mallMapURL, visitDetails, visitInput } from './mobile-malls-core.js';
import { bindMallMapLink, createMallLocation } from './mobile-mall-map.js';
import { createMallPhotos, createMallPhotoViewer, mallPhotoTiles, mallPhotoURLs, visitPhotos } from './mobile-mall-photos.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function installMobileMalls(maps) {
  document.addEventListener('DOMContentLoaded', () => {
    const hero = document.querySelector('#panel-timeline .trail-hero');
    if (!hero) return;
    const store = createMallStore(window.indexedDB);
    const launcher = element('button', '', 'mall-launcher');
    launcher.id = 'mall-open';
    launcher.type = 'button';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-controls', 'mall-dialog');
    launcher.innerHTML = '<span aria-hidden="true">▦</span><strong>商场足迹</strong><span aria-hidden="true">›</span>';
    hero.after(launcher);

    const dialog = document.createElement('dialog');
    dialog.id = 'mall-dialog';
    dialog.className = 'mall-dialog';
    dialog.setAttribute('aria-labelledby', 'mall-title');
    dialog.innerHTML = `
      <header><h2 id="mall-title">商场足迹</h2><button type="button" data-mall-close aria-label="关闭商场足迹">×</button></header>
      <div class="mall-body">
        <dl class="mall-totals">
          <div><dt>去过的商场</dt><dd data-mall-total>—</dd></div>
          <div><dt>到访次数</dt><dd data-visit-total>—</dd></div>
        </dl>
        <form class="mall-form">
          <fieldset>
            <h3 data-mall-form-title>新增到访</h3>
            <label>商场名称<input name="mallName" maxlength="200" required placeholder="例如：万象城" autocomplete="off"></label>
            <div class="mall-suggestions" data-mall-suggestions role="group" aria-label="匹配以前记录过的商场" hidden></div>
            <details data-mall-extra>
              <summary>城市、日期、评分与备注</summary>
              <div class="mall-extra-fields">
                <label>城市（选填）<input name="city" maxlength="80" placeholder="例如：杭州" autocomplete="off"></label>
                <label>到访日期<input name="day" type="date" required></label>
                <label>评分<select name="rating"><option value="">未评分</option><option value="5">5 分</option><option value="4">4 分</option><option value="3">3 分</option><option value="2">2 分</option><option value="1">1 分</option></select></label>
                <label class="mall-notes-field">备注<textarea name="notes" rows="2" maxlength="1000" placeholder="记下这次到访的感受"></textarea></label>
              </div>
            </details>
            <div class="mall-location-actions">
              <button type="button" class="quiet" data-mall-find>联网查位置</button>
              <button type="button" class="quiet" data-mall-map-toggle>高德选点</button>
            </div>
            <div class="mall-location-summary"><span data-mall-location-value></span><button type="button" class="text-button" data-mall-clear-location hidden>清除位置</button></div>
            <p class="mall-status" data-mall-location-status role="status"></p>
            <div class="mall-place-results" data-mall-results hidden></div>
            <a class="mall-amap-link" data-mall-open-amap rel="noreferrer" hidden>在高德查看</a>
            <section class="mall-photo-panel" aria-labelledby="mall-photo-heading">
              <div class="mall-photo-heading"><h4 id="mall-photo-heading">到访照片</h4><span data-mall-photo-count>0/3</span></div>
              <input type="file" accept="image/*" data-mall-photo-input multiple hidden>
              <div class="mall-photo-actions">
                <button type="button" class="quiet" data-mall-photo-add>从手机选照片</button>
                <button type="button" class="quiet" data-mall-photo-find>联网找图</button>
              </div>
              <p class="mall-photo-hint">匹配商场后会尝试查找公开照片。照片保存在本机。</p>
              <p class="mall-status" data-mall-photo-status role="status"></p>
              <div data-mall-photo-gallery></div>
            </section>
            <div class="mall-form-actions">
              <button class="primary" type="submit" data-mall-save>记一次到访</button>
              <button class="quiet" type="button" data-mall-cancel-edit hidden>取消编辑</button>
            </div>
          </fieldset>
        </form>
        <p class="mall-status" data-mall-status role="status" aria-live="polite"></p>
        <div class="mall-list-header">
          <label><span class="product-sr-only">搜索商场</span><input type="search" data-mall-search placeholder="搜商场、城市或备注" maxlength="140"></label>
          <label><span class="product-sr-only">商场排序</span><select data-mall-sort><option value="recent">最近到访</option><option value="visits">到访次数</option><option value="rating">平均评分</option></select></label>
        </div>
        <button type="button" class="quiet mall-photo-filter" data-mall-photo-filter aria-pressed="false">只看有照片</button>
        <div class="mall-list" data-mall-list></div>
        <p class="mall-storage">同一商场每天记一次。记录保存在当前手机。联网搜索会发送商场名和所填城市。地点数据来自 <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">© OpenStreetMap</a>。</p>
      </div>`;
    document.body.append(dialog);

    const $ = selector => dialog.querySelector(selector);
    const form = $('.mall-form'), fields = form.querySelector('fieldset');
    const { mallName, city, day, rating, notes } = form.elements;
    const search = $('[data-mall-search]'), sort = $('[data-mall-sort]');
    const photoFilter = $('[data-mall-photo-filter]');
    const list = $('[data-mall-list]'), suggestions = $('[data-mall-suggestions]'), status = $('[data-mall-status]');
    const viewer = createMallPhotoViewer(dialog);
    const listPhotos = mallPhotoURLs();
    let owner, rows = [], groups = [], busy = false, ready = false, editing = null, photosOnly = false;
    const location = createMallLocation(form, mallName, city, maps, place => {
      if (place.source === 'map') return;
      mallName.value = place.name;
      const cityKey = text => text.trim().replace(/市$/u, '');
      if (place.city && cityKey(city.value) !== cityKey(place.city)) city.value = place.city;
    }, place => {
      photos.placeChanged();
      if (place.source === 'photon') photos.lookupPhoto(true);
    });
    const photos = createMallPhotos(form, mallName, city, viewer.show, syncFormState);

    function syncFormState() {
      location.disable(busy || !ready || photos.processing);
    }

    function account() {
      const value = window.DaynestAccount?.current?.();
      if (!value || window.DaynestHTTP?.authExpired?.()) return null;
      return { key: JSON.stringify([value.server, value.userID]), session: value.sessionID };
    }
    function isCurrent(snapshot) {
      const active = account();
      return dialog.open && owner === snapshot && active?.key === snapshot.key && active.session === snapshot.session;
    }
    function say(message, error = false) {
      status.textContent = message;
      status.dataset.error = String(error);
    }
    function paintSuggestions() {
      const matches = mallName.value.trim() ? filterMalls(groups, mallName.value).slice(0, 4) : [];
      suggestions.replaceChildren();
      suggestions.hidden = !matches.length;
      for (const group of matches) {
        const item = element('button', group.city ? `${group.name} · ${group.city}` : group.name);
        item.type = 'button';
        item.addEventListener('click', () => {
          mallName.value = group.name;
          city.value = group.city;
          location.reset(group.place);
          photos.placeChanged();
          if (group.place) photos.lookupPhoto(true);
          if (group.city) $('[data-mall-extra]').open = true;
          suggestions.hidden = true;
        });
        suggestions.append(item);
      }
    }

    function paintList() {
      const open = new Set([...list.querySelectorAll('details[open]')].map(node => node.dataset.key));
      const visibleGroups = photosOnly ? groups.filter(group => group.visits.some(visit => visitPhotos(visit).length)) : groups;
      const matches = filterMalls(visibleGroups, search.value, sort.value);
      listPhotos.release();
      list.replaceChildren();
      if (!ready) return;
      if (!matches.length) {
        list.append(element('p', groups.length ? '没有找到符合筛选条件的到访。' : '还没有到访记录。', 'mall-empty'));
        return;
      }
      for (const group of matches) {
        const card = element('details', '', 'mall-list-item');
        card.dataset.key = group.key;
        card.open = open.has(group.key);
        const title = element('summary'), info = element('span', '', 'mall-list-name');
        const attached = group.visits.some(visit => visitPhotos(visit).length);
        info.append(element('strong', group.name), element('small', [group.city, '最近 ' + group.latest, attached && '有照片'].filter(Boolean).join(' · ')));
        const hits = [`${group.visits.length} 次`];
        if (group.ratings) hits.push(`★ ${group.averageRating.toFixed(1)}`);
        title.append(info, element('span', hits.join(' · '), 'mall-list-count'));
        card.append(title);
        const link = mallMapURL(group.place);
        if (link) {
          const address = element('div', '', 'mall-list-address'), anchor = element('a', '在高德查看');
          address.append(element('span', group.place.address || `${group.place.lat.toFixed(5)}, ${group.place.lng.toFixed(5)}`));
          anchor.href = link;
          anchor.rel = 'noreferrer';
          bindMallMapLink(anchor, maps, () => group.place, message => say(message, true));
          address.append(anchor);
          card.append(address);
        }
        const dates = element('ul', '', 'mall-list-dates');
        for (const visit of group.visits) {
          const attachments = visitPhotos(visit);
          if (photosOnly && !attachments.length) continue;
          const row = element('li'), copy = element('div', '', 'mall-visit-summary'), actions = element('div', '', 'mall-visit-actions');
          const when = element('time', visit.day), remove = element('button', '删除记录', 'mall-visit-remove');
          when.dateTime = visit.day;
          copy.append(when);
          if (visit.rating) copy.append(element('span', ` · ${visit.rating} 分`));
          if (visit.notes) copy.append(element('small', visit.notes, 'mall-visit-note'));
          const edit = element('button', '编辑记录', 'mall-visit-edit');
          edit.type = 'button';
          edit.dataset.editVisit = visit.id;
          edit.disabled = busy;
          edit.addEventListener('click', () => startEdit(visit));
          remove.type = 'button';
          remove.dataset.removeVisit = visit.id;
          remove.setAttribute('aria-label', `删除${group.name} ${visit.day} 的到访`);
          remove.addEventListener('click', () => removeVisit(visit));
          remove.disabled = busy;
          actions.append(edit, remove);
          row.append(copy);
          if (attachments.length) row.append(mallPhotoTiles(attachments, listPhotos, viewer.show));
          row.append(actions);
          dates.append(row);
        }
        card.append(dates);
        list.append(card);
      }
    }
    function update() {
      groups = groupsForVisits(rows);
      $('[data-mall-total]').textContent = ready ? String(groups.length) : '—';
      $('[data-visit-total]').textContent = ready ? String(rows.length) : '—';
      fields.disabled = busy || !ready;
      syncFormState();
      paintList();
    }
    async function removeVisit(visit) {
      if (!owner || busy || !window.confirm(`删除 ${visit.day} 到访「${visit.name}」的记录和照片？`)) return;
      const snapshot = owner;
      busy = true;
      update();
      try {
        await store.remove(snapshot.key, visit);
        if (!isCurrent(snapshot)) return;
        rows = rows.filter(row => row.id !== visit.id);
        if (editing?.id === visit.id) resetForm();
        say('已删除这次到访。');
      } catch (error) {
        if (isCurrent(snapshot)) say(error.message || '删除失败，请重试。', true);
      } finally {
        if (isCurrent(snapshot)) { busy = false; update(); }
      }
    }
    function resetForm() {
      form.reset();
      editing = null;
      $('[data-mall-form-title]').textContent = '新增到访';
      $('[data-mall-save]').textContent = '记一次到访';
      $('[data-mall-cancel-edit]').hidden = true;
      day.value = day.max = dayKey(new Date());
      $('[data-mall-extra]').open = false;
      suggestions.replaceChildren();
      suggestions.hidden = true;
      location.reset();
      photos.reset();
    }
    function startEdit(visit) {
      if (busy || !ready) return;
      resetForm();
      editing = visit;
      mallName.value = visit.name;
      city.value = visit.city;
      day.value = visit.day;
      rating.value = visit.rating ? String(visit.rating) : '';
      notes.value = visit.notes || '';
      $('[data-mall-form-title]').textContent = '编辑到访';
      $('[data-mall-save]').textContent = '保存本次到访';
      $('[data-mall-cancel-edit]').hidden = false;
      $('[data-mall-extra]').open = true;
      location.reset(visit.place || null);
      photos.reset(visitPhotos(visit));
      say(`正在编辑 ${visit.day} 的到访。`);
      $('.mall-body').scrollTop = 0;
    }
    launcher.addEventListener('click', async () => {
      if (dialog.open) return;
      owner = account();
      if (!owner) { window.DaynestUI?.notify('请先登录，再打开商场足迹。', 'error'); return; }
      const snapshot = owner;
      rows = [];
      ready = false;
      busy = true;
      search.value = '';
      sort.value = 'recent';
      photosOnly = false;
      photoFilter.setAttribute('aria-pressed', 'false');
      resetForm();
      update();
      say('正在读取本机记录…');
      dialog.showModal();
      $('.mall-body').scrollTop = 0;
      try {
        const records = await store.list(snapshot.key);
        if (!isCurrent(snapshot)) return;
        rows = records;
        ready = true;
        say('');
      } catch (_) {
        if (isCurrent(snapshot)) say('读取记录失败，请重新打开再试。', true);
      } finally {
        if (isCurrent(snapshot)) { busy = false; update(); }
      }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!owner || busy || !ready || location.searching || photos.processing) return;
      const snapshot = owner;
      let visit, details;
      const today = dayKey(new Date());
      try {
        visit = visitInput(mallName.value, city.value, day.value, today);
        details = visitDetails({ rating: rating.value, notes: notes.value, place: location.place, photos: photos.photos });
      }
      catch (error) { say(error.message, true); return; }
      busy = true;
      update();
      try {
        const result = editing
          ? { visit: await store.update(snapshot.key, editing, visit, details), edited: true }
          : await store.add(snapshot.key, visit, details);
        if (!isCurrent(snapshot)) return;
        rows = [...rows.filter(row => row.id !== result.visit.id), result.visit];
        if (result.added || result.edited) resetForm();
        say(result.edited ? '已更新这次到访。' : result.added ? `已记录 ${visit.name}。` : '这家商场当天已经记过，可在记录里编辑评分和备注。');
      } catch (error) {
        if (isCurrent(snapshot)) say(error.message || '写入本机失败，请重试。', true);
      } finally {
        if (isCurrent(snapshot)) { busy = false; update(); }
      }
    });
    $('[data-mall-close]').addEventListener('click', () => dialog.close());
    $('[data-mall-cancel-edit]').addEventListener('click', () => { resetForm(); say(''); });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      viewer.close();
      owner = null;
      rows = groups = [];
      ready = false;
      resetForm();
      update();
      say('');
    });
    for (const event of ['daynest:account-leaving', 'daynest:auth-expired']) {
      document.addEventListener(event, () => { if (dialog.open) dialog.close(); });
    }
    mallName.addEventListener('input', paintSuggestions);
    photoFilter.addEventListener('click', () => {
      photosOnly = !photosOnly;
      photoFilter.setAttribute('aria-pressed', String(photosOnly));
      paintList();
    });
    form.addEventListener('invalid', event => {
      if (event.target === day) $('[data-mall-extra]').open = true;
    }, true);
    search.addEventListener('input', paintList);
    sort.addEventListener('change', paintList);
  }, { once: true });
}
