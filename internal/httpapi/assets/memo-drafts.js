(() => {
  "use strict";
  const C = window.DaynestMemoDrafts, $ = id => document.getElementById("memo-drafts-" + id);
  if (!C || !$("dialog")) return;
  window.DaynestMemoRecovery = { create };
  function create(hooks) {
    let verified = null, owner = "", store = null, active = null, source = null, selected = null, remote = null;
    let sequence = 0, epoch = 0, busy = false, localError = "", list = [], damaged = 0;
    const token = () => localStorage.getItem("studyflow.token") || "";
    function server() { try { return window.DaynestMobile?.getConnectionInfo?.().server || location.origin; } catch (_) { return ""; } }
    function identity() { return verified?.token === token() && verified?.server === server() && token() ? C.scope(server(), verified.userID) : ""; }
    function id() {
      // randomUUID requires HTTPS/localhost. LAN HTTP still provides getRandomValues.
      if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
      const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
      return "draft-" + [...bytes].map(v => v.toString(16).padStart(2, "0")).join("");
    }
    function properties(value) {
      return `标题：${value.title || "未命名"}\n标签：${value.tags?.join("、") || "无"} · 颜色：${({default:"默认",yellow:"黄色",orange:"橙色",rose:"玫红",violet:"紫色",blue:"蓝色",mint:"薄荷绿",gray:"灰色"})[value.color] || "默认"}\n文件夹：${hooks.folderName(value.folder_id)}`;
    }
    const escape = value => String(value || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
    function sync() {
      const next = identity();
      if (next !== owner) {
        epoch++; owner = next; store = null; active = source = selected = remote = null; busy = false; localError = ""; list = []; damaged = 0;
        $("dialog").close(); $("preview").hidden = true;
        if (owner) { try { store = C.create(localStorage, owner); } catch (_) { localError = "本机存储不可用，请保留页面或导出文字。"; } }
        refresh();
      }
      return owner;
    }
    function refresh() {
      try { const result = store?.list(); list = result?.records || []; damaged = result?.damaged || 0; }
      catch (_) { list = []; localError = "无法读取本机草稿，请保留页面或导出文字。"; }
      $("open").textContent = `本机草稿${list.length ? " · " + list.length : ""}`;
      $("open").disabled = !owner;
      $("notice").hidden = !localError && !list.length && !damaged;
      $("notice-text").textContent = localError || (damaged ? `有 ${damaged} 份草稿数据无法读取，未自动删除。` : `本机保留了 ${list.length} 份编辑草稿，可预览并恢复。`);
      let enabled = true; try { enabled = store?.enabled() !== false; } catch (_) { /* Report persistence failure when capturing. */ }
      $("enabled").checked = enabled;
      $("enabled").disabled = !store;
      $("local-state").textContent = localError || (!enabled ? "本机草稿保留已关闭 · 已有草稿可手动清理" : active ? "本机草稿已保留" : "编辑时保留本机草稿");
      $("local-state").dataset.error = String(!!localError);
      $("clear").disabled = busy || !owner || (!list.length && !damaged);
      $("list").innerHTML = list.length ? list.map(r => `<button type="button" data-memo-draft="${r.id}" class="${selected?.id === r.id ? "active" : ""}"><span>${escape(r.value.title || "未命名备忘录")}</span><small>${escape(new Date(r.savedAt).toLocaleString("zh-CN"))} · ${[...r.value.content].length.toLocaleString("zh-CN")} 字</small><p>${escape(r.value.content.slice(0, 85) || "只有标题或属性修改")}</p></button>`).join("") : '<p class="memo-drafts-empty">还没有本机草稿。未提交的文字会在编辑时保留。</p>';
    }
    function snapshot() {
      const entry = hooks.read();
      if (!sync() || !entry?.dirty || !entry.note || entry.note.deleted_at || !store) return null;
      if (!active || active.noteID !== entry.note.id) {
        try { active = { id: id(), noteID: entry.note.id, generation: 0 }; }
        catch (_) { localError = "当前浏览器无法生成草稿标识，请更新浏览器或导出文字。"; refresh(); return null; }
      }
      const record = { version: 1, id: active.id, noteID: entry.note.id, generation: ++sequence, savedAt: Date.now(),
        baseUpdatedAt: entry.note.updated_at || "", base: C.fields(entry.note), value: C.fields(entry.payload) };
      try { if (!store.enabled()) return null; store.put(record); active = record; localError = ""; }
      catch (e) { localError = e.name === "QuotaExceededError" ? "本机空间不足，最新文字尚未存入草稿，请导出或清理。" : e.name === "SecurityError" ? "浏览器禁止本机存储，请保留页面或导出文字。" : e.message; }
      refresh(); return active;
    }
    function saved(record, clean) {
      if (!sync() || !store || !clean) return;
      try {
        if (record || active) store.remove(record || active);
        if (source) store.remove(source);
        active = null;
        source = null; localError = "";
      } catch (_) { localError = "服务已接收文字，本机草稿清理失败，可稍后手动清理。"; }
      refresh();
    }
    async function preview(record) {
      const account = sync(), version = ++epoch;
      if (!account || busy) return;
      selected = record; remote = null; $("preview").hidden = false;
      $("title").textContent = record.value.title || "未命名备忘录";
      $("text").value = record.value.content; $("server-text").value = "";
      $("text-meta").textContent = properties(record.value); $("server-meta").textContent = "等待核对服务端记录";
      $("restore").disabled = $("copy").disabled = true;
      $("status").textContent = "正在核对服务端版本；此时不会提交草稿。"; refresh();
      try {
        const note = await hooks.load(record.noteID);
        if (account !== identity() || version !== epoch || !$("dialog").open) return;
        remote = note; $("server-text").value = note.content || "";
        $("server-meta").textContent = properties(note);
        const same = C.equal(record.base, note), included = C.accepted(record.value, note);
        $("status").textContent = note.deleted_at ? "原记录已在回收站。可以导出，或另存为新备忘录。" : included ? "服务端已包含这份文字。可打开核对，无需再次覆盖。" : same ? "服务端正文与草稿基线一致。恢复到编辑区后，点击保存才会提交。" : "服务端也有修改。请对照两份内容；可以另存为新备忘录，原记录会保留。";
        $("restore").textContent = included ? "打开并核对" : "恢复到编辑区";
        $("restore").disabled = !!note.deleted_at || (!same && !included);
        $("copy").disabled = false;
      } catch (e) {
        if (account !== identity() || version !== epoch) return;
        $("status").textContent = e.message + " 本机文字仍可查看和导出。";
        // Explicit copy is also available if the original was permanently deleted.
        $("copy").disabled = false;
      }
    }
    function open() { if (!sync()) return; snapshot(); refresh(); $("dialog").showModal(); if (list.length) preview(list.find(r => r.id === active?.id) || list[0]); }
    async function restore(copy) {
      if (busy || !selected || !sync()) return;
      const account = owner, version = ++epoch, record = selected, note = remote;
      busy = true; $("copy").disabled = $("restore").disabled = true; $("clear").disabled = true; $("discard").disabled = true;
      try {
        // The editor may contain a different offline edit. Never replace it implicitly.
        if (!(await hooks.prepare(record))) throw Error("编辑区仍有待保存内容，请先保存或导出。草稿没有被替换。");
        if (account !== identity() || version !== epoch) return;
        if (copy) {
          const created = await hooks.copy(record.value);
          if (account !== identity() || version !== epoch) return;
          await hooks.apply(created, null);
          if (account !== identity() || version !== epoch) return;
          store.remove(record); active = source = null;
        } else {
          if (!note || note.deleted_at) return;
          const included = C.accepted(record.value, note);
          await hooks.apply(note, included ? null : record.value);
          if (account !== identity() || version !== epoch) return;
          if (included) { store.remove(record); active = source = null; }
          else {
            active = null; source = record; snapshot(); // Keep the source until a manual save succeeds.
          }
        }
        $("dialog").close(); refresh();
      } catch (e) {
        if (account === identity() && version === epoch) $("status").textContent = e.message + (copy ? " 新建结果未确认时，请先刷新列表核对，避免重复创建。" : "");
      } finally { if (account === identity() && version === epoch) { busy = false; $("discard").disabled = false; $("copy").disabled = false; $("restore").disabled = !remote || !!remote.deleted_at || (!C.equal(selected.base, remote) && !C.accepted(selected.value, remote)); refresh(); } }
    }
    async function download() {
      if (!selected || !sync()) return;
      const record = selected, account = token(), context = owner;
      const blob = new Blob([`# ${record.value.title || "未命名备忘录"}\n\n${record.value.content}\n\n---\n标签：${record.value.tags.join(", ")}\n`], { type: "text/markdown;charset=utf-8" });
      const name = (record.value.title || "本机草稿").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 100) + ".md";
      try {
        if (window.DaynestMobile?.saveBlob) await window.DaynestMobile.saveBlob(blob, name, account);
        else { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
        if (account === token() && context === identity()) $("status").textContent = "已交给文件保存窗口。本机草稿仍保留，请确认文件保存成功。";
      } catch (_) { if (account === token() && context === identity()) $("status").textContent = "导出未完成，本机草稿仍保留。"; }
    }
    $("open").addEventListener("click", open); $("review").addEventListener("click", open);
    $("enabled").addEventListener("change", () => { if (!sync() || !store) return; try { store.setEnabled($("enabled").checked); localError = ""; if (store.enabled()) snapshot(); refresh(); } catch (_) { localError = "本机存储设置无法保存，请检查浏览器权限。"; refresh(); } });
    $("close").addEventListener("click", () => { if (!busy) $("dialog").close(); });
    $("dialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    $("dialog").addEventListener("close", () => { if (!busy) epoch++; });
    $("list").addEventListener("click", event => { const b = event.target.closest("[data-memo-draft]"); const record = b && list.find(r => r.id === b.dataset.memoDraft); if (record && !busy) preview(record); });
    $("restore").addEventListener("click", () => restore(false)); $("copy").addEventListener("click", () => restore(true)); $("export").addEventListener("click", download);
    $("discard").addEventListener("click", () => {
      if (!sync() || busy || !selected || !confirm("删除这份本机草稿？服务端备忘录不会删除。")) return;
      try { store.remove(selected); if (source?.id === selected.id) source = null; if (active?.id === selected.id) active = null; selected = null; $("preview").hidden = true; localError = ""; refresh(); }
      catch (_) { $("status").textContent = "草稿删除失败，请重试。"; }
    });
    $("clear").addEventListener("click", () => {
      if (!sync() || busy || !confirm("清除此账号、此服务地址下的全部本机草稿？建议先导出重要内容。编辑区文字仍保留，继续编辑会重新生成草稿。")) return;
      try { store.clear(); active = source = selected = null; localError = ""; $("preview").hidden = true; refresh(); }
      catch (_) { $("status").textContent = "清理失败，请重试。"; }
    });
    document.addEventListener("daynest:account-ready", event => { verified = { userID: event.detail?.userID, token: token(), server: server() }; sync(); });
    window.addEventListener("storage", event => { if (event.key === "studyflow.token" || !event.key) { hooks.accountChanged(); sync(); } else if (store?.owns(event.key)) refresh(); });
    window.addEventListener("pagehide", snapshot);
    window.addEventListener("daynest:mobile-pause", snapshot);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") snapshot(); });
    verified = window.DaynestAccount?.current?.() || null;
    sync(); refresh();
    return { sync, capture: snapshot, saved, open, resetWriter() { active = source = null; },
      problem(text) { $("notice").hidden = false; $("notice-text").textContent = text; },
      deactivate() { verified = null; sync(); } };
  }
})();
