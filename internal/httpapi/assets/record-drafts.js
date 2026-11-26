(() => {
  "use strict";
  const C = window.DaynestRecordDraftCore, $ = id => document.getElementById("ld-"+id);
  if (!C || !$("dialog")) return;
  window.DaynestRecordDrafts = {create};
  function create(hooks) {
    let account = "", store = null, records = [], damaged = 0, kind = "mood", selected = null, remote = null, epoch = 0, generation = 0, busy = false, error = "";
    const active = {}, sources = {}, errors = {};
    function identity() { const a = window.DaynestAccount?.current?.(); return a ? C.scope(a.server,a.userID) : ""; }
    const escape = v => String(v || "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    function sync() {
      const next = identity();
      if (next !== account) {
        epoch++; account = next; store = null; selected = remote = null; records = []; damaged = 0; busy = false; error = ""; kind = "mood";
        active.mood = sources.mood = null; errors.mood = "";
        $("dialog").close(); $("preview").hidden = true;
        if (account) { try { store = C.create(localStorage,account); } catch (_) { error = "本机草稿存储不可用，请导出重要文字。"; } }
        render();
      }
      return account;
    }
    function render() {
      try { const result = store?.list(); records = result?.records || []; damaged = result?.damaged || 0; }
      catch (_) { error = "无法读取本机草稿，请保留编辑区并导出文字。"; }
      let enabled = true; try { enabled = store?.enabled() !== false; } catch (_) { /* Capture reports failures. */ }
      const n = records.filter(r=>r.kind==="mood").length;
      $("mood-open").textContent = "本机草稿" + (records.length ? " · "+records.length : ""); $("mood-open").disabled = !account;
      $("mood-state").textContent = errors.mood || error || (!enabled ? "本机保留已关闭" : active.mood ? "本机草稿已保留 · 提交后清理" : n ? `${n} 份未完成草稿，随时继续` : "未提交的文字会保留在本机");
      $("mood-state").dataset.error = String(!!(errors.mood || error));
      const hasArchive = records.some(r=>r.kind==="weekly");
      $("tabs").hidden = !hasArchive;
      if (!hasArchive && kind==="weekly") {
        kind="mood"; selected=remote=null; $("preview").hidden=true;
      }
      $("enabled").checked = enabled; $("enabled").disabled = !store || busy;
      $("health").textContent = error || (damaged ? `${damaged} 份草稿数据无法读取，未自动删除。可清理当前账号的长文草稿。` : "草稿仅保留在此设备；恢复后仍需点击原页面的保存按钮。");
      $("clear").disabled = !store || busy || (!records.length && !damaged);
      document.querySelectorAll("[data-ld-kind]").forEach(b=>{b.setAttribute("aria-pressed",String(b.dataset.ldKind===kind));b.disabled=busy;});
      const filtered = records.filter(r=>r.kind===kind);
      $("list").innerHTML = filtered.length ? filtered.map(r=>`<button type="button" class="${selected?.id===r.id?"active":""}" data-ld-record="${r.id}"><strong>${escape(r.key)}${kind==="weekly"?" 起的一周":""}</strong><small>${escape(new Date(r.savedAt).toLocaleString("zh-CN"))}</small><p>${escape((kind==="mood"?r.value.note:r.value.wins || r.value.lessons).slice(0,90) || "保留了表情、标签或其他字段修改")}</p></button>`).join("") : '<p class="ld-empty">这里还没有草稿。未提交的内容会在输入时保留。</p>';
    }
    function capture(k) {
      if (k!=="mood" || !sync() || !store) return null;
      const snapshot = hooks.read();
      if (!snapshot?.dirty || !snapshot.known) return null;
      try {
        if (!store.enabled()) return null;
        if (!active[k] || active[k].key !== snapshot.key) active[k] = {id:C.writerID(),key:snapshot.key};
        const r = {version:1,id:active[k].id,kind:k,key:snapshot.key,generation:++generation,savedAt:Date.now(),baseVersion:C.version(snapshot.base),base:C.fields(k,snapshot.base || {}),value:C.fields(k,snapshot.value)};
        store.put(r); active[k] = r; errors[k] = ""; render(); return r;
      } catch (e) { errors[k] = e.name==="QuotaExceededError"?"空间不足，最新文字未存入本机草稿，请导出。":e.name==="SecurityError"?"浏览器禁止本机保留，请先导出文字。":e.message; render(); return null; }
    }
    function ack(k, sent, clean) {
      if (!sync() || !store || !clean) return;
      try { if (sent || active[k]?.version) store.remove(sent || active[k]); if (sources[k]) store.remove(sources[k]); active[k]=sources[k]=null; errors[k]=""; }
      catch (_) { errors[k]="服务已接收文字，本机草稿未能清理，可稍后手动删除。"; }
      render();
    }
    async function preview(r) {
      const owner = sync(), version = ++epoch;
      if (!owner || busy) return;
      selected=r; remote=null; $("preview").hidden=false; $("title").textContent=r.key+(r.kind==="weekly"?" 起的一周":" 的心情日记");
      $("local").value=C.readable(r.kind,r.key,r.value); $("server").value=""; $("restore").disabled=true;
      const archived = r.kind === "weekly";
      $("restore").hidden = $("server-label").hidden = archived;
      if (archived) {
        $("status").textContent="历史复盘草稿可导出文字。";
        render();
        return;
      }
      $("status").textContent="正在核对服务端；不会自动提交这份草稿。"; render();
      try {
        const result=await hooks.load(r.key);
        if(owner!==identity() || version!==epoch || !$("dialog").open)return;
        remote=result; const current=result.record;
        $("server").value=current?C.readable(r.kind,r.key,current):"此日期还没有服务端记录。";
        const deleted=!!r.baseVersion&&!current;
        const safe=!deleted && (C.version(current)===r.baseVersion || (!!current && C.equal(r.kind,r.base,current)) || (!!current && C.equal(r.kind,r.value,current)));
        $("restore").disabled=!safe;
        $("status").textContent=deleted?"原记录已不存在。可导出，不会自动重建原记录。":safe?"可以恢复到原日期的编辑区。恢复后，请手动点击保存。":"服务端也有修改。请对照两份内容；可导出，原记录会保留。";
      } catch(e) { if(owner===identity()&&version===epoch){$("status").textContent=e.message+" 本机文字仍可导出。";} }
    }
    function open(k) { if(!sync())return;capture("mood");kind=k;selected=remote=null;$("preview").hidden=true;render();if(!$("dialog").open)$("dialog").showModal();const r=records.find(r=>r.kind===kind&&r.id===active[k]?.id)||records.find(r=>r.kind===kind);if(r)preview(r); }
    async function restore() {
      if(!sync()||busy||!selected||selected.kind!=="mood")return;
      const owner=account,version=++epoch,r=selected,target=remote; busy=true;render();$("restore").disabled=$("discard").disabled=true;
      try {
        if(!hooks.prepare(r))throw Error("编辑区还有其他未提交内容，请先保存、导出或暂存并切换。");
        if(!target)return;
        await hooks.apply(r,target);
        if(owner!==identity()||version!==epoch)return;
        active[r.kind]=null;sources[r.kind]=r;capture(r.kind);$("dialog").close();
      } catch(e){if(owner===identity()&&version===epoch)$("status").textContent=e.message;}
      finally{if(owner===identity()&&version===epoch){busy=false;$("discard").disabled=false;$("restore").disabled=!target||(!target.record&&!!r.baseVersion)||(!C.equal(r.kind,r.base,target.record||{})&&!C.equal(r.kind,r.value,target.record||{})&&r.baseVersion!==C.version(target.record));render();}}
    }
    async function download() {
      if(!sync()||!selected)return;
      const r=selected,owner=account,token=hooks.token(),blob=new Blob([C.readable(r.kind,r.key,r.value)],{type:"text/markdown;charset=utf-8"}),name=`${r.key}-${r.kind==="mood"?"心情日记":"每周复盘"}-草稿.md`;
      try {if(window.DaynestMobile?.saveBlob)await window.DaynestMobile.saveBlob(blob,name,token);else{const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}if(owner===identity())$("status").textContent="已交给文件保存窗口。草稿仍保留，请确认文件已保存。";}
      catch(_){if(owner===identity())$("status").textContent="导出未完成，草稿仍保留。";}
    }
    $("mood-open").addEventListener("click",()=>open("mood"));
    document.querySelectorAll("[data-ld-kind]").forEach(b=>b.addEventListener("click",()=>{if(!busy)open(b.dataset.ldKind);}));
    $("list").addEventListener("click",e=>{const id=e.target.closest("[data-ld-record]")?.dataset.ldRecord,r=records.find(r=>r.id===id);if(r&&!busy)preview(r);});
    $("restore").addEventListener("click",restore);$("export").addEventListener("click",download);
    $("close").addEventListener("click",()=>{if(!busy)$("dialog").close();});$("dialog").addEventListener("cancel",e=>{if(busy)e.preventDefault();});$("dialog").addEventListener("close",()=>{if(!busy)epoch++;});
    $("discard").addEventListener("click",()=>{if(!sync()||busy||!selected||!confirm("删除这份本机草稿？服务端记录不会删除。"))return;try{store.remove(selected);if(active[selected.kind]?.id===selected.id)active[selected.kind]=null;if(sources[selected.kind]?.id===selected.id)sources[selected.kind]=null;selected=remote=null;$("preview").hidden=true;render();}catch(_){$("status").textContent="清理失败，请重试。";}});
    $("clear").addEventListener("click",()=>{if(!sync()||busy||!confirm("清除此账号、此服务地址的心情及历史复盘草稿？重要文字请先导出。正在编辑的内容仍在，继续输入会重新生成草稿。"))return;try{store.clear();active.mood=sources.mood=null;errors.mood="";selected=remote=null;error="";$("preview").hidden=true;render();}catch(_){$("health").textContent="清理失败，请重试。";}});
    $("enabled").addEventListener("change",()=>{if(!sync()||!store)return;try{store.setEnabled($("enabled").checked);if(store.enabled())capture("mood");render();}catch(_){error="本机草稿设置未能保存，请检查浏览器权限。";render();}});
    document.addEventListener("daynest:account-ready",sync);
    window.addEventListener("storage",e=>{if(e.key==="studyflow.token"||!e.key)sync();else if(store?.owns(e.key))render();});
    for(const event of ["pagehide","daynest:mobile-pause"])window.addEventListener(event,()=>capture("mood"));
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")capture("mood");});
    sync();render();
    return {capture,ack,open,sync,detach(k){active[k]=sources[k]=null;render();},
      retained(k){const r=capture(k);return !!r;},reset(){sync();},problem(k,message){errors[k]=message;render();}};
  }
})();
