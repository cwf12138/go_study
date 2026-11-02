(function (root, factory) {
  "use strict";
  const api = factory(typeof module === "object" && module.exports ? require("./draft-store.js") : root.DaynestDraftStore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DaynestRecordDraftCore = api;
})(typeof window === "undefined" ? globalThis : window, function (S) {
  "use strict";
  const prefix = "daynest.record-draft.v1:", moods = {awful:"很糟",low:"低落",neutral:"平静",good:"不错",great:"很好"};
  const text = (v, max) => typeof v === "string" && v.length <= max;
  const lines = v => Array.isArray(v) ? v.slice() : String(v || "").split(/\r?\n/);
  const labels = v => Array.isArray(v) ? v.slice() : String(v || "").split(/[,，]/);
  const clean = (values, lower = false) => [...new Map(values.map(v => String(v).trim()).filter(Boolean).map(v => [v.toLowerCase(), lower ? v.toLowerCase() : v])).values()];
  function dateKey(key) { const d = new Date(key + "T00:00:00Z"); return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === key; }
  function fields(kind, v = {}) {
    if (kind === "mood") return {mood:v.mood || "neutral",note:v.note || "",activities:[...(v.activities || [])],tags:Array.isArray(v.tags)?v.tags.join(", "):v.tags || "",stress:Number(v.stress || 3),energy:Number(v.energy || 3)};
    return {satisfaction:Number(v.satisfaction || 0),wins:v.wins || "",challenges:v.challenges || "",lessons:v.lessons || "",priorities:Array.isArray(v.next_week_priorities)?v.next_week_priorities.join("\n"):v.priorities || ""};
  }
  function payload(kind, value) {
    const v = fields(kind, value);
    if (kind === "mood") return {...v,note:v.note.trim(),activities:clean(v.activities,true),tags:clean(labels(v.tags),true)};
    return {satisfaction:v.satisfaction,wins:v.wins.trim(),challenges:v.challenges.trim(),lessons:v.lessons.trim(),next_week_priorities:clean(lines(v.priorities))};
  }
  function equal(kind, a, b) {
    const x = payload(kind, a), y = payload(kind, b);
    if (kind === "mood") { x.tags.sort(); y.tags.sort(); x.activities.sort(); y.activities.sort(); }
    return JSON.stringify(x) === JSON.stringify(y);
  }
  function version(record) { return record?.id && record.updated_at ? record.id + "@" + record.updated_at : ""; }
  function validFields(kind, v) {
    if (!v) return false;
    if (kind === "mood") return Object.hasOwn(moods,v.mood) && text(v.note,12000) && text(v.tags,2400) && Array.isArray(v.activities) && v.activities.length <= 40 && v.activities.every(x => text(x,96)) && Number.isInteger(v.stress) && v.stress >= 1 && v.stress <= 5 && Number.isInteger(v.energy) && v.energy >= 1 && v.energy <= 5;
    return kind === "weekly" && Number.isInteger(v.satisfaction) && v.satisfaction >= 0 && v.satisfaction <= 5 && [v.wins,v.challenges,v.lessons].every(x => text(x,8000)) && text(v.priorities,2400);
  }
  function valid(r) {
    return r && r.version === 1 && /^[\w-]{1,100}$/.test(r.id) && ["mood","weekly"].includes(r.kind) && dateKey(r.key) &&
      (r.kind !== "weekly" || new Date(r.key+"T00:00:00Z").getUTCDay() === 1) && Number.isSafeInteger(r.generation) && r.generation > 0 && Number.isFinite(r.savedAt) &&
      text(r.baseVersion,256) && validFields(r.kind,r.base) && validFields(r.kind,r.value);
  }
  function readable(kind, key, value) {
    const v = fields(kind,value);
    return kind === "mood" ? `${key} · 心情日记\n心情：${moods[v.mood]}　压力：${v.stress}/5　精力：${v.energy}/5\n活动：${v.activities.join("、") || "无"}\n关键词：${labels(v.tags).join("、") || "无"}\n\n${v.note}` : `${key} 起的一周 · 每周复盘\n满意度：${v.satisfaction ? v.satisfaction+"/5" : "尚未选择"}\n\n本周做得好的事\n${v.wins}\n\n遇到的困难\n${v.challenges}\n\n得到的经验\n${v.lessons}\n\n下周优先事项\n${v.priorities}`;
  }
  return {prefix,fields,payload,equal,version,valid,dateKey,readable,scope:S.scope,writerID:S.writerID,
    create:(storage,owner)=>S.create(storage,owner,{prefix,settingPrefix:"daynest.record-draft-setting.v1:",valid})};
});
