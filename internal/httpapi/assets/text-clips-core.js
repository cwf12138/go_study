(() => {
  'use strict';
  const count = value => [...String(value)].length;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const zero = value => typeof value === 'string' && value.startsWith('0001-01-01T00:00:00');
  const expired = (row, now = Date.now()) => !zero(row.expires_at) && Date.parse(row.expires_at) <= now;
  function valid(row) {
    return row && /^[A-Za-z0-9_-]{8,80}$/.test(row.id) && typeof row.user_id === 'string' && typeof row.title === 'string' && count(row.title) <= 80 && typeof row.text === 'string' && row.text.trim() && count(row.text) <= 12000 && [0,1,24,168].includes(row.ttl_hours) && typeof row.pinned === 'boolean' && typeof row.deleted === 'boolean' && Number.isInteger(row.revision) && row.revision > 0 && ['created_at','updated_at','expires_at'].every(k => typeof row[k] === 'string' && Number.isFinite(Date.parse(row[k]))) && (row.ttl_hours === 0 ? zero(row.expires_at) : !zero(row.expires_at));
  }
  const title = row => row.title || [...row.text.trim().split('\n')[0]].slice(0,36).join('');
  function select(rows, {tab='active',query='',sort='updated',now=Date.now()} = {}) {
    const q = query.trim().toLocaleLowerCase();
    return rows.filter(r => (tab === 'trash' ? r.deleted : !r.deleted && (tab === 'expired' ? expired(r,now) : !expired(r,now) && (tab !== 'pinned' || r.pinned))) && (!q || (r.title+'\n'+r.text).toLocaleLowerCase().includes(q))).sort((a,b) => Number(b.pinned)-Number(a.pinned) || Date.parse(b[sort === 'created'?'created_at':'updated_at'])-Date.parse(a[sort === 'created'?'created_at':'updated_at']) || a.id.localeCompare(b.id));
  }
  function expiry(row, now=Date.now()) {
    if (zero(row.expires_at)) return '一直保留';
    const remaining = Date.parse(row.expires_at)-now;
    if (remaining <= 0) return '已过期';
    // Display coarse estimates without a millisecond clock difference adding a whole day.
    const minutes = Math.max(1,Math.round(remaining/60000));
    return minutes < 60 ? `${minutes} 分钟后到期` : minutes < 1440 ? `约 ${Math.ceil(minutes/60)} 小时后到期` : `约 ${Math.ceil(minutes/1440)} 天后到期`;
  }
  const values = row => ({title:row.title,text:row.text,ttl_hours:row.ttl_hours,pinned:row.pinned,deleted:row.deleted,revision:row.revision});
  const same = (row, body) => row && ['title','text','ttl_hours','pinned','deleted'].every(k => row[k] === body[k]);
  window.DaynestTextClips = {count,esc,zero,expired,valid,title,select,expiry,values,same};
})();
