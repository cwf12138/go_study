import { validDay } from './mobile-commute-core.js';

function clean(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function searchable(value) { return clean(value).toLowerCase(); }
function cityKey(value) { return searchable(value).replace(/(?:特别行政区|市)$/u, ''); }

export function mallPlaceIdentity(name, city) {
  return JSON.stringify([searchable(name), cityKey(city)]);
}

export function visitInput(name, city, day, today) {
  name = clean(name);
  city = clean(city);
  if (!name || [...name].length > 100) throw Error('请输入 1 至 100 个字的商场名称。');
  if ([...city].length > 40) throw Error('城市最多 40 个字。');
  if (!validDay(day) || day > today) throw Error('请选择今天或更早的到访日期。');
  return { name, city, day, mallKey: JSON.stringify([searchable(name), searchable(city)]) };
}

export function visitDetails({ rating, notes, place, photos = [] }) {
  rating = rating ? Number(rating) : null;
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw Error('请选择 1 至 5 分。');
  notes = String(notes ?? '').trim();
  if ([...notes].length > 500) throw Error('备注最多 500 个字。');
  return { rating, notes, place: place || null, photos: photos.slice(0, 3) };
}

export function placePoint(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

const osmTypes = { N: 'node', W: 'way', R: 'relation' };

export function parseMallPlaces(payload) {
  if (!Array.isArray(payload?.features)) throw Error('地图服务返回的数据格式有误。');
  const places = [], seen = new Set();
  for (const feature of payload.features.slice(0, 12)) {
    const coordinates = feature?.geometry?.coordinates, props = feature?.properties;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(coordinates) || !props) continue;
    const point = placePoint(coordinates[1], coordinates[0]), name = clean(props.name).slice(0, 150);
    if (!point || !name) continue;
    const type = osmTypes[props.osm_type];
    const id = String(props.osm_id ?? '');
    const osm = type && /^\d{1,20}$/.test(id) && id !== '0' ? `${type}/${id}` : '';
    const key = osm || `${name}/${point.lat}/${point.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const regionalCity = /^(北京|上海|天津|重庆)市?$/.test(clean(props.state)) ? props.state : '';
    const city = clean(regionalCity || props.city || props.locality || props.county).slice(0, 40);
    const street = [props.street, props.housenumber].map(clean).filter(Boolean).join(' ');
    const address = [...new Set([props.state, city, props.district, street, props.postcode]
      .map(clean).filter(Boolean))].join(' · ').slice(0, 240);
    places.push({ ...point, name, city, address, osm, source: 'photon', verifiedMall: props.osm_key === 'shop' && props.osm_value === 'mall' });
  }
  return places;
}

export function exactMallPlace(places, name, city) {
  const cityName = cityKey(city);
  const matches = places.filter(place => place.verifiedMall && searchable(place.name) === searchable(name) &&
    (!cityName || cityKey(place.city) === cityName));
  return matches.length === 1 ? matches[0] : null;
}

export async function searchMallPlaces(name, city, signal, request = fetch) {
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({ q: [name, city].filter(Boolean).join(' '), limit: '8', lang: 'default', osm_tag: 'shop:mall' });
  async function read() {
    const response = await request(url.href, { credentials: 'omit', signal, redirect: 'error' });
    if (!response.ok) throw Error(`地图搜索暂时不可用（HTTP ${response.status}）。`);
    return parseMallPlaces(await response.json());
  }
  const malls = await read();
  if (malls.length || signal?.aborted) return malls;
  url.searchParams.delete('osm_tag');
  return await read();
}

export function mallMapURL(place) {
  const point = placePoint(place?.lat, place?.lng);
  if (!point) return '';
  const params = new URLSearchParams({
    position: [point.lng, point.lat].join(','),
    name: clean(place.name) || '商场位置',
    coordinate: place.coordinateSystem === 'gcj02' ? 'gaode' : 'wgs84',
    callnative: '1',
    src: 'Daynest',
  });
  return `https://uri.amap.com/marker?${params}`;
}

export function mallPickerPlace(result, selected, candidates, name, city) {
  if (result?.cancelled) return null;
  if (result?.existing === true) return selected;
  if (Number.isInteger(result?.candidate)) return candidates[result.candidate] || null;
  const point = placePoint(result?.lat, result?.lng);
  return point && { ...point, name: clean(name), city: clean(city), address: '', osm: '', source: 'map', coordinateSystem: 'gcj02' };
}

export function groupsForVisits(rows) {
  const groups = new Map();
  for (const visit of rows) {
    if (!groups.has(visit.mallKey)) groups.set(visit.mallKey, { key: visit.mallKey, visits: [] });
    groups.get(visit.mallKey).visits.push(visit);
  }
  return [...groups.values()].map(group => {
    group.visits.sort((a, b) => b.day.localeCompare(a.day));
    const latest = group.visits[0];
    const rated = group.visits.filter(visit => Number.isInteger(visit.rating) && visit.rating >= 1 && visit.rating <= 5);
    const averageRating = rated.length ? rated.reduce((sum, visit) => sum + visit.rating, 0) / rated.length : null;
    return {
      ...group, name: latest.name, city: latest.city, latest: latest.day,
      place: group.visits.find(visit => visit.place)?.place || null, averageRating, ratings: rated.length,
    };
  });
}

export function filterMalls(groups, query, sort = 'recent') {
  const terms = searchable(query).split(' ').filter(Boolean);
  return groups.filter(group => {
    const text = searchable([group.name, group.city, group.place?.address, ...group.visits.map(visit => visit.notes)].filter(Boolean).join(' '));
    return terms.every(term => text.includes(term));
  }).sort((a, b) => (sort === 'visits' ? b.visits.length - a.visits.length : sort === 'rating' ? (b.averageRating ?? 0) - (a.averageRating ?? 0) : 0) ||
    b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name, 'zh-CN') || a.city.localeCompare(b.city, 'zh-CN'));
}

export function createMallStore(indexedDB) {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(Error('当前设备无法使用本机记录。')); return; }
      const request = indexedDB.open('daynest.mall-visits.v1', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('visits', { keyPath: ['scope', 'mallKey', 'day'] });
        store.createIndex('scope', 'scope');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
    }).catch(error => { opening = undefined; throw error; });
    return opening;
  }

  async function list(scope) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('visits').objectStore('visits').index('scope').getAll(scope);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function change(scope, visit, action, details, updatedVisit) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('visits', 'readwrite'), rows = transaction.objectStore('visits');
      const key = [scope, visit.mallKey, visit.day], existing = rows.get(key);
      let result, reason;
      existing.onsuccess = () => {
        try {
          const previous = existing.result;
          if (action !== 'add') {
            if (!previous || previous.id !== visit.id || (previous.revision || 0) !== (visit.revision || 0)) {
              throw Error('这次到访已变化，请重新打开后再操作。');
            }
            if (action === 'remove') rows.delete(key);
            else {
              const record = { ...previous, ...updatedVisit, ...details, revision: (previous.revision || 0) + 1 };
              if (record.mallKey === previous.mallKey && record.day === previous.day) rows.put(record);
              else {
                const insert = rows.add(record);
                insert.onerror = () => {
                  if (insert.error?.name === 'ConstraintError') reason = Error('这家商场在所选日期已有到访记录，请改选日期。');
                };
                rows.delete(key);
              }
              result = record;
            }
          } else if (previous) {
            result = { visit: previous, added: false };
          } else {
            const record = { ...visit, ...details, scope, id: crypto.randomUUID(), revision: 1 };
            rows.add(record);
            result = { visit: record, added: true };
          }
        } catch (error) { reason = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(reason || transaction.error || Error('写入本机记录失败。'));
    });
  }
  return {
    list,
    add: (scope, visit, details) => change(scope, visit, 'add', details),
    update: (scope, original, visit, details) => change(scope, original, 'update', details, visit),
    remove: (scope, visit) => change(scope, visit, 'remove'),
  };
}
