import { exactMallPlace, mallMapURL, mallPickerPlace, mallPlaceIdentity, placePoint, searchMallPlaces } from './mobile-malls-core.js';

function describe(place) {
  return place.address || place.city || `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
}

function pickerPoint(place) {
  const point = placePoint(place?.lat, place?.lng);
  return point && { ...point, coordinateSystem: place.coordinateSystem === 'gcj02' ? 'gcj02' : 'wgs84', name: place.name || '' };
}

export function bindMallMapLink(link, maps, currentPlace, onError) {
  let opening = false;
  link.addEventListener('click', async event => {
    event.preventDefault();
    const place = pickerPoint(currentPlace());
    if (!place || opening) return;
    opening = true;
    try {
      await maps.openPlace({ ...place, name: place.name || '商场位置' });
    } catch (error) {
      onError(error?.code === 'BAD_MAP_INPUT' ? '该商场还没有有效位置。' : '手机暂时无法打开高德地图。');
    } finally {
      opening = false;
    }
  });
}

export function createMallLocation(root, name, city, maps, onChoose, onConfirm) {
  const $ = selector => root.querySelector(selector);
  const find = $('[data-mall-find]'), openMap = $('[data-mall-map-toggle]');
  const status = $('[data-mall-location-status]'), results = $('[data-mall-results]');
  const summary = $('[data-mall-location-value]'), clear = $('[data-mall-clear-location]');
  const external = $('[data-mall-open-amap]'), save = $('[data-mall-save]');
  let selected = null, identity, candidates = [], search, picking, blocked = false;

  function message(value) { status.textContent = value; }
  function render() {
    const pending = !!(search || picking);
    summary.textContent = selected ? `已绑定位置 · ${describe(selected)}` : '';
    summary.parentElement.hidden = !selected;
    const link = mallMapURL(selected);
    external.hidden = !link;
    if (link) external.href = link; else external.removeAttribute('href');
    find.disabled = openMap.disabled = save.disabled = clear.disabled = blocked || pending;
    for (const item of results.querySelectorAll('button')) item.disabled = blocked || pending;
  }
  function renderResults() {
    results.replaceChildren();
    results.hidden = !candidates.length;
    for (const place of candidates) {
      const item = document.createElement('button'), label = document.createElement('strong'), address = document.createElement('small');
      item.type = 'button';
      item.setAttribute('aria-pressed', String(place === selected));
      label.textContent = place.name;
      address.textContent = describe(place);
      item.append(label, address);
      item.addEventListener('click', () => choose(place));
      results.append(item);
    }
  }
  function choose(place) {
    selected = place;
    onChoose(place);
    identity = mallPlaceIdentity(name.value, city.value);
    onConfirm?.(place);
    message('');
    renderResults();
    render();
  }
  async function pickOnMap() {
    if (blocked || picking || search) return;
    const current = picking = {};
    const places = candidates.filter(pickerPoint);
    const existing = selected;
    message('');
    render();
    try {
      const result = await maps.pick({ selected: pickerPoint(existing), candidates: places.map(pickerPoint) });
      if (picking !== current || result?.cancelled) return;
      const place = mallPickerPlace(result, existing, places, name.value, city.value);
      if (place) choose(place);
      else message('高德地图没有返回有效位置，请重新选点。');
    } catch (error) {
      if (picking !== current) return;
      if (error?.code === 'MISSING_AMAP_KEY') {
        message('此安装包尚未配置高德地图。可以联网查位置，再点「在高德查看」。');
      } else {
        message('高德地图暂时无法打开，可以先使用联网搜索。');
      }
    } finally {
      if (picking === current) { picking = null; render(); }
    }
  }
  function reset(place = null) {
    search?.abort();
    search = picking = null;
    candidates = [];
    selected = place;
    identity = place ? mallPlaceIdentity(name.value, city.value) : null;
    message('');
    renderResults();
    render();
  }
  async function searchNow() {
    const title = name.value.trim(), region = city.value.trim();
    if (blocked || search || picking) return;
    if (!title) { message('先输入商场名称。'); name.focus(); return; }
    if ([...title].length > 100 || [...region].length > 40) { message('请缩短商场名称或城市后再查找。'); return; }
    const controller = search = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    candidates = [];
    renderResults();
    message('正在联网查找…');
    render();
    try {
      const places = await searchMallPlaces(title, region, controller.signal);
      if (search !== controller) return;
      candidates = places;
      const exact = exactMallPlace(places, title, region);
      if (exact) choose(exact);
      else {
        message(places.length ? '从列表或高德地图的标记中选择商场。' : '暂未找到匹配商场，可换个名称或在高德地图选点。');
        renderResults();
      }
    } catch (error) {
      if (search === controller) message(controller.signal.aborted ? '地图搜索超时，可稍后重试。' : error.message || '地图搜索失败。');
    } finally {
      clearTimeout(timeout);
      if (search === controller) { search = null; render(); }
    }
  }

  openMap.addEventListener('click', pickOnMap);
  bindMallMapLink(external, maps, () => selected, message);
  find.addEventListener('click', searchNow);
  clear.addEventListener('click', () => { selected = null; message(''); renderResults(); render(); });
  for (const input of [name, city]) input.addEventListener('input', () => {
    const changed = selected && identity !== mallPlaceIdentity(name.value, city.value);
    reset(changed ? null : selected);
    if (changed) message('商场名称或城市已更改，请重新确认位置。');
  });
  return {
    get place() { return selected; },
    get searching() { return !!(search || picking); },
    reset,
    disable(value) { blocked = value; render(); },
  };
}
