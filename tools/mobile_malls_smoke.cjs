const assert = require('node:assert/strict');

(async () => {
  const {
    visitInput, groupsForVisits, filterMalls, visitDetails, parseMallPlaces, exactMallPlace, mallMapURL, mallPickerPlace, placePoint, searchMallPlaces,
  } = await import('../mobile/src/mobile-malls-core.js');
  const { bindMallMapLink } = await import('../mobile/src/mobile-mall-map.js');
  const today = '2026-11-22';
  const visits = [
    visitInput(' ＭｉｘＣ　 Mall ', ' 杭州 ', today, today),
    visitInput('mixc mall', '杭州', '2026-11-19', today),
    visitInput('MixC Mall', '上海', '2026-11-21', today),
    visitInput('银泰', '', '2026-10-30', today),
  ];
  assert.equal(visits[0].mallKey, visits[1].mallKey);
  assert.notEqual(visits[0].mallKey, visits[2].mallKey);
  assert.throws(() => visitInput(' ', '', today, today), /商场名称/);
  assert.throws(() => visitInput('商场', '', '2026-11-23', today), /到访日期/);
  assert.throws(() => visitInput('商场', '', '2026-02-30', today), /到访日期/);
  const groups = groupsForVisits(visits);
  assert.equal(groups.length, 3);
  assert.equal(filterMalls(groups, '', 'visits')[0].visits.length, 2);
  assert.deepEqual(filterMalls(groups, 'Ｍｉｘｃ 上海').map(item => item.city), ['上海']);
  assert.deepEqual(filterMalls(groups, '').map(item => item.latest), [today, '2026-11-21', '2026-10-30']);
  assert.deepEqual(groupsForVisits(visits.slice(1)).find(group => group.city === '杭州').visits.map(item => item.day), ['2026-11-19']);

  const feature = (name, city, osm_id, osm_value = 'mall') => ({
    geometry: { type: 'Point', coordinates: [120.20123456, 30.2501234] },
    properties: { name, city, osm_id, osm_type: 'W', state: '浙江省', street: '富春路', osm_key: 'shop', osm_value },
  });
  const places = parseMallPlaces({ features: [
    feature('万象城', '杭州市', 31),
    feature('万象城', '杭州市', 31),
    feature('万象城', '宁波市', 32),
    { ...feature('Invalid', '杭州', 33), geometry: { type: 'Point', coordinates: [999, 80] } },
  ] });
  assert.equal(places.length, 2);
  assert.equal(exactMallPlace(places, '万象城', ''), null);
  const viaName = exactMallPlace(places, '万象城', '杭州');
  assert.equal(viaName.address, '浙江省 · 杭州市 · 富春路');
  const external = new URL(mallMapURL(viaName));
  assert.equal(external.origin + external.pathname, 'https://uri.amap.com/marker');
  assert.equal(external.searchParams.get('position'), '120.201235,30.250123');
  assert.equal(external.searchParams.get('coordinate'), 'wgs84');
  assert.equal(external.searchParams.get('name'), '万象城');
  assert.equal(mallPickerPlace({ candidate: 1 }, viaName, places, '', ''), places[1]);
  assert.equal(mallPickerPlace({ candidate: 2 }, viaName, places, '', ''), null);
  assert.equal(mallPickerPlace({ existing: true }, viaName, places, '', ''), viaName);
  assert.equal(mallPickerPlace({ cancelled: true }, viaName, places, '', ''), null);
  const pin = mallPickerPlace({ lat: 30.253, lng: 120.206 }, viaName, places, ' 万象城 ', '杭州');
  assert.equal(pin.source, 'map');
  assert.equal(pin.name, '万象城');
  assert.equal(pin.coordinateSystem, 'gcj02');
  assert.equal(new URL(mallMapURL(pin)).searchParams.get('coordinate'), 'gaode');
  assert.equal(new URL(mallMapURL({ ...pin, coordinateSystem: undefined })).searchParams.get('coordinate'), 'wgs84');
  const opened = [];
  const link = new EventTarget();
  let linkedPlace = viaName;
  bindMallMapLink(link, {
    async openPlace(point) { opened.push(point); },
  }, () => linkedPlace, assert.fail);
  const click = () => link.dispatchEvent(new Event('click', { cancelable: true }));
  assert.equal(click(), false, 'native map launch suppresses the browser link');
  await Promise.resolve();
  linkedPlace = pin;
  click();
  assert.deepEqual(opened.map(point => point.coordinateSystem), ['wgs84', 'gcj02']);
  assert.equal(mallMapURL({ lat: 91, lng: 0, osm: 'javascript:alert(1)' }), '');
  assert.deepEqual(placePoint(30.2501234, 120.20123456), { lat: 30.250123, lng: 120.201235 });
  const requests = [];
  const broad = await searchMallPlaces('万象城', '杭州', undefined, (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    requests.push(new URL(url));
    return { ok: true, json: () => ({ features: requests.length === 1 ? [] : [feature('万象城', '杭州市', 34, 'department_store')] }) };
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].origin, 'https://photon.komoot.io');
  assert.equal(requests[0].searchParams.get('osm_tag'), 'shop:mall');
  assert(!requests[1].searchParams.has('osm_tag'));
  assert.equal(exactMallPlace(broad, '万象城', '杭州'), null, 'broader results always require confirmation');
  assert.throws(() => visitDetails({ rating: 7 }), /评分|1 至 5/);
  assert.throws(() => visitDetails({ notes: '字'.repeat(501) }), /500/);
  assert.deepEqual(visitDetails({ notes: '一行\n二行', rating: '' }), { notes: '一行\n二行', rating: null, place: null, photos: [] });
  const enriched = groupsForVisits([
    { ...visits[0], ...visitDetails({ rating: 4, notes: '停车方便', place: viaName }) },
    { ...visits[1], rating: 2 }, visits[2], visits[3],
  ]);
  assert.equal(filterMalls(enriched, '停车方便', 'rating')[0].averageRating, 3);
  assert.equal(filterMalls(enriched, '富春路')[0].place.osm, 'way/31');
  console.log('Android mall visits passed: legacy rows, grouping, ratings, note/address search, location matching and fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
