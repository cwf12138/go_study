import { mallPlaceIdentity } from './mobile-malls-core.js';
import { downloadMallPhoto, findMallPhoto } from './mobile-mall-photo-source.js';

const photoLimit = 3;
const inputLimit = 24 * 1024 * 1024;
const storedLimit = 600 * 1024;

export function visitPhotos(visit) {
  return Array.isArray(visit.photos) ? visit.photos : [];
}

export function mallPhotoURLs() {
  const urls = new Map();
  return {
    get(photo) {
      if (!urls.has(photo.id)) urls.set(photo.id, URL.createObjectURL(photo.blob));
      return urls.get(photo.id);
    },
    release() {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

function mallPhotoCredit(photo) {
  if (photo.source !== 'commons') return document.createTextNode('');
  const credit = document.createElement('small');
  credit.className = 'mall-photo-credit';
  const source = document.createElement('a');
  source.href = photo.sourceURL;
  source.rel = 'noreferrer';
  source.textContent = 'Wikimedia Commons';
  credit.append(source, ` · ${photo.credit ? photo.credit + ' · ' : ''}`);
  if (photo.licenseURL) {
    const license = document.createElement('a');
    license.href = photo.licenseURL;
    license.rel = 'noreferrer';
    license.textContent = photo.license;
    credit.append(license);
  } else credit.append(photo.license);
  credit.append(' · 已缩放');
  return credit;
}

export function mallPhotoTiles(photos, urls, preview, remove) {
  const tiles = document.createElement('div');
  tiles.className = 'mall-photo-tiles';
  photos.forEach((photo, index) => {
    const tile = document.createElement('div');
    tile.className = 'mall-photo-tile';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mall-photo-thumb';
    button.setAttribute('aria-label', `查看第 ${index + 1} 张照片`);
    const image = document.createElement('img');
    image.src = urls.get(photo);
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    button.append(image);
    button.addEventListener('click', () => preview(photo));
    tile.append(button);
    if (remove) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'mall-photo-remove';
      action.textContent = '移除';
      action.setAttribute('aria-label', `移除第 ${index + 1} 张照片`);
      action.addEventListener('click', () => remove(photo));
      tile.append(action);
    }
    tile.append(mallPhotoCredit(photo));
    tiles.append(tile);
  });
  return tiles;
}

export function createMallPhotoViewer(parent) {
  const dialog = document.createElement('dialog');
  dialog.className = 'mall-photo-viewer';
  dialog.setAttribute('aria-label', '照片预览');
  dialog.innerHTML = '<button type="button" aria-label="关闭照片预览">关闭</button><div></div>';
  parent.after(dialog);
  const urls = mallPhotoURLs();
  const content = dialog.querySelector('div');
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    urls.release();
    content.replaceChildren();
  });
  return {
    show(photo) {
      if (!parent.open || dialog.open) return;
      const image = new Image();
      image.src = urls.get(photo);
      image.alt = photo.title || '商场到访照片';
      content.replaceChildren(image, mallPhotoCredit(photo));
      dialog.showModal();
    },
    close() { if (dialog.open) dialog.close(); },
  };
}

async function preparePhoto(input) {
  if (!input.size || input.size > inputLimit || (input.type && !input.type.startsWith('image/')) || input.type === 'image/svg+xml') {
    throw Error('请选择每张不超过 24 MB 的普通照片。');
  }
  const url = URL.createObjectURL(input);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > 60_000_000) throw Error('照片分辨率过大，请选择较小的图片。');
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 1280 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.68, 0.48]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= storedLimit) return blob;
    }
    throw Error('照片较大，无法压缩。请选另一张照片。');
  } finally { URL.revokeObjectURL(url); }
}

export function createMallPhotos(form, name, city, preview, onState) {
  const $ = selector => form.querySelector(selector);
  const input = $('[data-mall-photo-input]'), add = $('[data-mall-photo-add]'), find = $('[data-mall-photo-find]');
  const count = $('[data-mall-photo-count]'), gallery = $('[data-mall-photo-gallery]'), status = $('[data-mall-photo-status]');
  const urls = mallPhotoURLs();
  let photos = [], picker, lookup, lookupPlace, draftPhotoID, draftPhotoPlace;

  function announce(value) { status.textContent = value; }
  function stopLookup() { lookup?.abort(); lookup = null; }
  function update() {
    count.textContent = `${photos.length}/${photoLimit}`;
    add.disabled = !!picker || photos.length >= photoLimit;
    find.disabled = !!lookup || !!picker || photos.length >= photoLimit || photos.some(photo => photo.source === 'commons');
    find.textContent = lookup ? '正在找图…' : '联网找图';
    urls.release();
    gallery.replaceChildren();
    if (photos.length) gallery.append(mallPhotoTiles(photos, urls, preview, photo => {
      if (picker) return;
      photos = photos.filter(item => item.id !== photo.id);
      announce('已从这次到访移除照片。');
      update();
    }));
    onState();
  }
  function reset(existing = []) {
    stopLookup();
    photos = existing.slice();
    picker = draftPhotoID = draftPhotoPlace = null;
    input.value = '';
    announce('');
    update();
  }

  async function lookupPhoto(automatic = false) {
    if (lookup || picker || photos.length >= photoLimit || photos.some(photo => photo.source === 'commons')) return;
    if (automatic && photos.length) return;
    const title = name.value.trim(), region = city.value.trim();
    if (!title || !region || [...title].length > 100 || [...region].length > 40) {
      if (!automatic) {
        announce('请填写商场名称和城市，再查找公开照片。');
        if (!region) form.querySelector('[data-mall-extra]').open = true;
        (title ? city : name).focus();
      }
      return;
    }
    const controller = lookup = new AbortController();
    lookupPlace = mallPlaceIdentity(title, region);
    const timeout = setTimeout(() => controller.abort(), 11000);
    announce('正在查找公开照片，可以先保存。');
    update();
    try {
      const found = await findMallPhoto(title, region, controller.signal);
      if (lookup !== controller) return;
      if (!found) { announce('暂无匹配的公开照片，可以添加手机里的照片。'); return; }
      const { thumbnail, ...credit } = found;
      const blob = await preparePhoto(await downloadMallPhoto(thumbnail, controller.signal));
      if (lookup !== controller) return;
      const photo = { ...credit, blob, source: 'commons', id: crypto.randomUUID() };
      photos = [...photos, photo];
      draftPhotoID = photo.id;
      draftPhotoPlace = lookupPlace;
      announce('已找到公开照片，保存到访时会一起保存。');
    } catch {
      if (lookup === controller) announce(controller.signal.aborted ? '查图超时，可以重试或添加自己的照片。' : '暂时无法获取公开照片，可以添加自己的照片。');
    } finally {
      clearTimeout(timeout);
      if (lookup === controller) { lookup = null; update(); }
    }
  }

  add.addEventListener('click', () => input.click());
  find.addEventListener('click', () => lookupPhoto());
  input.addEventListener('change', async () => {
    if (picker || !input.files?.length) return;
    stopLookup();
    const files = Array.from(input.files);
    input.value = '';
    const current = picker = {};
    const space = photoLimit - photos.length;
    let invalid = 0;
    announce('正在处理照片…');
    update();
    try {
      for (const file of files.slice(0, space)) {
        let blob;
        try { blob = await preparePhoto(file); }
        catch { invalid += 1; }
        if (picker !== current) return;
        if (blob) photos = [...photos, { blob, source: 'local', id: crypto.randomUUID() }];
      }
      announce(invalid ? `${invalid} 张照片无法读取，请换一张普通图片。` :
        files.length > space ? `每次到访最多 ${photoLimit} 张照片，已添加 ${space} 张。` : '照片已添加，保存到访时会一起保存。');
    } finally {
      if (picker === current) { picker = null; update(); }
    }
  });
  function placeChanged() {
    const current = mallPlaceIdentity(name.value, city.value);
    const lookupChanged = lookup && lookupPlace !== current;
    const photoChanged = draftPhotoID && draftPhotoPlace !== current;
    if (!lookupChanged && !photoChanged) return;
    if (lookupChanged) stopLookup();
    if (photoChanged) {
      photos = photos.filter(photo => photo.id !== draftPhotoID);
      draftPhotoID = draftPhotoPlace = null;
    }
    if (!lookup) announce('');
    update();
  }
  for (const field of [name, city]) field.addEventListener('input', placeChanged);
  return { get photos() { return photos; }, get processing() { return !!picker; }, reset, lookupPhoto, placeChanged };
}
