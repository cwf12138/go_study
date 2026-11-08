(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DaynestDraftStore = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const prefixes = ["daynest.memo-draft.v1:", "daynest.record-draft.v1:", "daynest.todo-draft.v1:"];
  function scope(server, user) {
    try {
      const url = new URL(server);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || !/^[\w-]{1,160}$/.test(user)) return "";
      return encodeURIComponent(JSON.stringify([url.origin + url.pathname.replace(/\/+$/, ""), user]));
    } catch (_) { return ""; }
  }
  function writerID() {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return "draft-" + [...bytes].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  function create(storage, owner, {prefix, settingPrefix, valid}) {
    if (!owner || !prefixes.includes(prefix)) throw Error("尚未确认草稿所属账号与服务地址。");
    const baseKey = prefix + owner + ":", setting = settingPrefix + owner;
    const key = record => baseKey + record.id + ":" + record.generation;
    function list() {
      const latest = new Map(); let damaged = 0;
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i); if (!name?.startsWith(baseKey)) continue;
        try {
          const record = JSON.parse(storage.getItem(name));
          if (valid(record) && key(record) === name) {
            if (!latest.has(record.id) || latest.get(record.id).generation < record.generation) latest.set(record.id, record);
          } else damaged++;
        } catch (_) { damaged++; }
      }
      return { records: [...latest.values()].sort((a,b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id)), damaged };
    }
    function put(record) {
      if (!valid(record)) throw Error("草稿内容超出本机保存范围，请先导出文字。");
      const name = key(record), json = JSON.stringify(record), obsolete = []; let bytes = 0, count = 0;
      const existing = storage.getItem(name);
      if (existing !== null && existing !== json) throw Error("此草稿版本已有其他内容，请保留页面并导出文字。");
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i); if (!prefixes.some(p => k?.startsWith(p)) || k === name) continue;
        if (k.startsWith(baseKey + record.id + ":")) {
          let prior = null; try { prior = JSON.parse(storage.getItem(k)); } catch (_) { /* Keep damaged data. */ }
          if (valid(prior) && prior.generation > record.generation) throw Error("已有更新的本机草稿，请重新查看后操作。");
          if (valid(prior) && prior.generation < record.generation) { obsolete.push(k); continue; }
        }
        bytes += 2 * (k.length + (storage.getItem(k) || "").length); count++;
      }
      if (count >= 40 || bytes + 2 * (name.length + json.length) > 4 * 1024 * 1024) throw Error("本机草稿空间已满，请先导出并清理草稿。");
      storage.setItem(name, json);
      obsolete.forEach(k => storage.removeItem(k)); // Publish the new generation before pruning.
      return record;
    }
    function remove(record) {
      // Immutable generation keys make a source updated by another tab safe.
      if (storage.getItem(key(record)) === JSON.stringify(record)) storage.removeItem(key(record));
    }
    function clear(predicate = () => true) {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i); if (!k?.startsWith(baseKey)) continue;
        let value = null; try { value = JSON.parse(storage.getItem(k)); } catch (_) { /* Explicit full clear also removes damaged data. */ }
        if (predicate(value)) keys.push(k);
      }
      keys.forEach(k => storage.removeItem(k));
    }
    return { list, put, remove, clear, enabled: () => storage.getItem(setting) !== "off",
      setEnabled: value => storage.setItem(setting, value ? "on" : "off"),
      owns: name => typeof name === "string" && (name.startsWith(baseKey) || name === setting) };
  }
  return {scope, writerID, create};
});
