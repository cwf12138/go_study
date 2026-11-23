const commonsAPI = 'https://commons.wikimedia.org/w/api.php';
const wikiAPI = 'https://zh.wikipedia.org/w/api.php';
const imageFields = {
  prop: 'imageinfo',
  iiprop: 'url|extmetadata|mime',
  iiurlwidth: '640',
  iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription',
};

function matchingText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function metadataText(value) {
  const template = document.createElement('template');
  template.innerHTML = typeof value === 'string' ? value : '';
  return template.content.textContent.replace(/\s+/gu, ' ').trim();
}

function trustedURL(value, host) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host === host && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function attribution(page) {
  const info = page.imageinfo?.[0], metadata = info?.extmetadata;
  const mime = info?.thumbmime || info?.mime;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return null;
  const thumbnail = trustedURL(info.thumburl, 'thumb.wikimedia.org') || trustedURL(info.thumburl, 'upload.wikimedia.org');
  const sourceURL = trustedURL(info.descriptionurl, 'commons.wikimedia.org');
  const license = metadataText(metadata?.LicenseShortName?.value);
  const licenseURL = trustedURL(metadata?.LicenseUrl?.value, 'creativecommons.org');
  const credit = metadataText(metadata?.Artist?.value).slice(0, 200);
  const reusable = /^CC (?:BY(?:-SA)?|0)\s/i.test(license) && licenseURL;
  const publicDomain = /^(?:public domain|cc0)(?:\s|$)/i.test(license);
  if (!thumbnail || !sourceURL || !(publicDomain || (reusable && credit))) return null;
  return { thumbnail, sourceURL, license, licenseURL, credit, title: String(page.title || '').replace(/^File:/i, '').slice(0, 160) };
}

async function wikiQuery(endpoint, parameters, signal) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...parameters });
  const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', signal });
  if (!response.ok) throw Error('公开图片服务暂时不可用。');
  const body = await response.json();
  if (body.error) throw Error('公开图片服务暂时不可用。');
  return Array.isArray(body.query?.pages) ? body.query.pages : [];
}

export async function findMallPhoto(name, city, signal) {
  const mall = matchingText(name), region = matchingText(city).replace(/(?:特别行政区|市)$/u, '');
  if (!mall || !region) return null;
  const expected = mall.includes(region) ? [mall] : [region + mall, mall + region];
  const query = mall.includes(region) ? name : region + name;
  const results = await wikiQuery(commonsAPI, {
    generator: 'search', gsrnamespace: '6', gsrlimit: '8', gsrsearch: query, ...imageFields,
  }, signal);
  for (const page of results.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const title = String(page.title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').replace(/\s+\d+$/, '');
    const description = page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value;
    if (!expected.includes(matchingText(title)) && !expected.includes(matchingText(metadataText(description)))) continue;
    const photo = attribution(page);
    if (photo) return photo;
  }

  const articles = await wikiQuery(wikiAPI, {
    generator: 'search', gsrnamespace: '0', gsrlimit: '5', gsrsearch: query,
    prop: 'pageimages', piprop: 'name', pilicense: 'free',
  }, signal);
  const article = articles.find(page => expected.includes(matchingText(page.title)) && page.pageimage);
  if (!article) return null;
  const files = await wikiQuery(commonsAPI, { titles: 'File:' + article.pageimage, ...imageFields }, signal);
  return files[0] ? attribution(files[0]) : null;
}

export async function downloadMallPhoto(url, signal) {
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal });
  if (!response.ok) throw Error('公开照片暂时无法下载。');
  return response.blob();
}
