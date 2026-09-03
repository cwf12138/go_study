(() => {
  "use strict";

  const state = {
    folders: [], notes: [], allNotes: [], overview: {}, current: null,
    view: "all", folderID: "", tag: "", query: "", sort: "updated_at:desc",
    initialized: false, loading: false, dirty: false, saving: false, preview: false,
    searchTimer: null, saveTimer: null, token: "", folderColor: "blue",
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  async function memoAPI(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = localStorage.getItem("studyflow.token") || "";
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body) headers.set("Content-Type", "application/json");
    let response;
    try { response = await fetch(path, { ...options, headers }); }
    catch { throw new Error("无法连接到备忘录服务。"); }
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404 && (path.startsWith("/api/v1/memos") || path.startsWith("/api/v1/memo-folders"))) {
      throw new Error("当前 Go 服务尚未加载备忘录接口，请停止旧进程并重新运行 go run ./cmd/api。");
    }
    if (!response.ok) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
    return payload.data;
  }

  function notify(message, type = "success") {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast visible ${type === "error" ? "error" : ""}`;
    window.setTimeout(() => { if (toast.textContent === message) toast.className = "toast"; }, 3200);
  }

  function syncAccount() {
    const token = localStorage.getItem("studyflow.token") || "";
    if (state.token === token) return token;
    window.clearTimeout(state.saveTimer);
    state.token = token; state.folders = []; state.notes = []; state.allNotes = []; state.current = null;
    state.view = "all"; state.folderID = ""; state.tag = ""; state.query = ""; state.initialized = false; state.dirty = false;
    return token;
  }

  function listURL(view = state.view, includeFilters = true) {
    const query = new URLSearchParams({ view });
    const [sort, order] = state.sort.split(":");
    query.set("sort", sort); query.set("order", order);
    if (includeFilters && state.query) query.set("q", state.query);
    if (includeFilters && state.folderID) query.set("folder_id", state.folderID);
    if (includeFilters && state.tag) query.set("tag", state.tag);
    return `/api/v1/memos?${query}`;
  }

  async function loadMemos({ preserveSelection = true } = {}) {
    if (!syncAccount() || state.loading) return;
    state.loading = true;
    const previousID = preserveSelection ? state.current?.id : "";
    try {
      const [folders, overview, notes, allNotes] = await Promise.all([
        memoAPI("/api/v1/memo-folders"), memoAPI("/api/v1/memos/overview"), memoAPI(listURL()), memoAPI(listURL("all", false)),
      ]);
      state.folders = folders || []; state.overview = overview || {}; state.notes = notes || []; state.allNotes = allNotes || [];
      state.initialized = true;
      renderMemos();
      const keep = previousID && state.notes.some((note) => note.id === previousID);
      if (keep && (!state.current || state.current.id !== previousID)) await selectMemo(previousID, { skipSave: true });
      else if (!keep && state.notes.length) await selectMemo(state.notes[0].id, { skipSave: true });
      else if (!state.notes.length) clearEditor();
    } catch (error) {
      notify(error.message, "error");
      $("#memo-note-list").innerHTML = '<div class="memo-list-empty">备忘录加载失败<br><button class="text-button" type="button" data-memo-retry>重新加载</button></div>';
    } finally { state.loading = false; }
  }

  function renderMemos() {
    renderSidebar(); renderNoteList(); renderFolderSelect();
  }

  function renderSidebar() {
    const overview = state.overview;
    $("#memo-count-all").textContent = overview.total || 0;
    $("#memo-count-pinned").textContent = overview.pinned || 0;
    $("#memo-count-checklists").textContent = overview.checklist_notes || 0;
    $("#memo-count-archived").textContent = overview.archived || 0;
    $("#memo-count-trash").textContent = overview.deleted || 0;
    $$('[data-memo-view]').forEach((button) => button.classList.toggle("active", !state.folderID && !state.tag && button.dataset.memoView === state.view));
    const counts = new Map();
    state.allNotes.forEach((note) => { if (note.folder_id) counts.set(note.folder_id, (counts.get(note.folder_id) || 0) + 1); });
    $("#memo-folder-list").innerHTML = state.folders.length ? state.folders.map((folder) => `<div class="memo-folder-row ${state.folderID === folder.id ? "active" : ""}" role="button" tabindex="0" data-memo-folder="${folder.id}"><i class="memo-folder-dot" style="background:${folderColorValue(folder.color)}"></i><b>${escapeHTML(folder.name)}</b><em>${counts.get(folder.id) || 0}</em><button class="memo-folder-menu" type="button" data-memo-folder-menu="${folder.id}" aria-label="管理文件夹">•••</button></div>`).join("") : '<span class="memo-sidebar-empty">还没有文件夹</span>';
    const tags = overview.tags || [];
    $("#memo-tag-list").innerHTML = tags.length ? tags.map((tag) => `<button class="${state.tag === tag ? "active" : ""}" type="button" data-memo-tag="${escapeHTML(tag)}">#${escapeHTML(tag)}</button>`).join("") : '<span class="memo-sidebar-empty">标签会显示在这里</span>';
  }

  function viewTitle() {
    if (state.folderID) return state.folders.find((folder) => folder.id === state.folderID)?.name || "文件夹";
    if (state.tag) return `#${state.tag}`;
    return { all: "全部备忘录", pinned: "已置顶", checklists: "清单", archived: "归档", trash: "最近删除" }[state.view] || "备忘录";
  }

  function renderNoteList() {
    $("#memo-list-title").textContent = viewTitle();
    $("#memo-list-count").textContent = `${state.notes.length} 条`;
    $("#memo-sort").value = state.sort;
    if (!state.notes.length) {
      const message = state.view === "trash" ? "最近删除中没有备忘录" : state.query ? "没有找到匹配的备忘录" : "这里还没有内容";
      $("#memo-note-list").innerHTML = `<div class="memo-list-empty"><span>${message}</span>${state.view !== "trash" ? '<button class="text-button" type="button" data-memo-create>新建一则</button>' : ""}</div>`;
      return;
    }
    $("#memo-note-list").innerHTML = state.notes.map((note) => {
      const progress = note.checklist_total ? Math.round(note.checklist_done * 100 / note.checklist_total) : 0;
      const checklist = note.checklist_total ? `<span class="memo-check-progress"><i style="--memo-check-progress:${progress}%"></i>${note.checklist_done}/${note.checklist_total}</span>` : "";
      return `<button class="memo-note-card color-${note.color || "default"} ${state.current?.id === note.id ? "active" : ""}" type="button" data-memo-note="${note.id}"><div class="memo-note-card-head">${note.pinned ? "<i>★</i>" : ""}<h4>${escapeHTML(note.title || "新备忘录")}</h4></div><p>${escapeHTML(note.snippet || "还没有内容")}</p><div class="memo-note-card-meta"><div class="memo-note-tags">${(note.tags || []).slice(0, 2).map((tag) => `<span>#${escapeHTML(tag)}</span>`).join("")}</div><span>${checklist || relativeDate(note.updated_at)}</span></div></button>`;
    }).join("");
  }

  function renderFolderSelect() {
    const selected = state.current?.folder_id || "";
    $("#memo-folder-select").innerHTML = `<option value="">备忘录</option>${state.folders.map((folder) => `<option value="${folder.id}">${escapeHTML(folder.name)}</option>`).join("")}`;
    $("#memo-folder-select").value = selected;
  }

  async function selectMemo(id, { skipSave = false } = {}) {
    if (!skipSave && state.dirty) await saveCurrent({ quiet: true });
    try {
      state.current = await memoAPI(`/api/v1/memos/${id}`);
      state.dirty = false; state.preview = false;
      renderNoteList(); renderEditor();
      $(".memo-workspace").classList.add("show-editor");
    } catch (error) { notify(error.message, "error"); }
  }

  function renderEditor() {
    const note = state.current;
    if (!note) return clearEditor();
    $("#memo-editor-empty").classList.add("hidden"); $("#memo-editor").classList.remove("hidden");
    $("#memo-title").value = note.title || ""; $("#memo-content").value = note.content || "";
    $("#memo-tags").value = (note.tags || []).join(", "); $("#memo-folder-select").value = note.folder_id || "";
    $("#memo-updated").textContent = `${note.created_at ? `创建于 ${fullDate(note.created_at)} · ` : ""}编辑于 ${fullDate(note.updated_at)}`;
    $("#memo-pin").classList.toggle("active", note.pinned); $("#memo-pin").textContent = note.pinned ? "★" : "☆";
    $("#memo-archive").classList.toggle("active", note.archived);
    $$('[data-memo-color]').forEach((button) => button.classList.toggle("active", button.dataset.memoColor === (note.color || "default")));
    const trashed = Boolean(note.deleted_at);
    $("#memo-editor-actions").classList.toggle("hidden", trashed); $("#memo-trash-actions").classList.toggle("hidden", !trashed);
    $("#memo-title").disabled = trashed; $("#memo-content").disabled = trashed; $("#memo-folder-select").disabled = trashed; $("#memo-tags").disabled = trashed;
    $(".memo-formatbar").classList.toggle("hidden", trashed);
    setPreview(false); updateEditorMeta(); setSaveState("saved");
  }

  function clearEditor() {
    state.current = null; state.dirty = false;
    $("#memo-editor").classList.add("hidden"); $("#memo-editor-empty").classList.remove("hidden");
    $(".memo-workspace").classList.remove("show-editor"); renderNoteList();
  }

  async function createMemo() {
    if (state.dirty) await saveCurrent({ quiet: true });
    try {
      const note = await memoAPI("/api/v1/memos", { method: "POST", body: JSON.stringify({ folder_id: state.folderID || "", title: "新备忘录", content: "", color: "default", tags: [] }) });
      state.view = "all"; state.tag = "";
      await loadMemos({ preserveSelection: false }); await selectMemo(note.id, { skipSave: true });
      $("#memo-title").select();
    } catch (error) { notify(error.message, "error"); }
  }

  function markDirty() {
    if (!state.current || state.current.deleted_at) return;
    state.dirty = true; updateEditorMeta(); setSaveState("saving", "等待自动保存…");
    window.clearTimeout(state.saveTimer); state.saveTimer = window.setTimeout(() => saveCurrent({ quiet: true }), 700);
  }

  async function saveCurrent({ quiet = false } = {}) {
    if (!state.current || !state.dirty || state.saving || state.current.deleted_at) return;
    state.saving = true; window.clearTimeout(state.saveTimer); setSaveState("saving", "正在保存…");
    const payload = {
      title: $("#memo-title").value, content: $("#memo-content").value,
      folder_id: $("#memo-folder-select").value, tags: splitTags($("#memo-tags").value), color: state.current.color || "default",
    };
    try {
      const updated = await memoAPI(`/api/v1/memos/${state.current.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      state.current = updated; state.dirty = false; setSaveState("saved");
      await refreshLists();
      if (!quiet) notify("备忘录已保存。");
    } catch (error) { setSaveState("error", "保存失败"); if (!quiet) notify(error.message, "error"); }
    finally { state.saving = false; }
  }

  async function refreshLists() {
    const [overview, notes, allNotes] = await Promise.all([memoAPI("/api/v1/memos/overview"), memoAPI(listURL()), memoAPI(listURL("all", false))]);
    state.overview = overview || {}; state.notes = notes || []; state.allNotes = allNotes || [];
    renderSidebar(); renderNoteList();
  }

  function setSaveState(kind, text = "所有更改已保存") {
    const target = $("#memo-save-state"); target.className = kind === "saved" ? "" : kind; target.innerHTML = `<i></i>${text}`;
  }

  function updateEditorMeta() {
    const content = $("#memo-content").value || "";
    $("#memo-word-count").textContent = `${[...content.replace(/\s/g, "")].length} 字 · ${content.trim() ? content.trim().split(/\s+/).length : 0} 词`;
    if (state.preview) $("#memo-preview").innerHTML = renderMarkdown(content);
  }

  function setPreview(enabled) {
    state.preview = enabled;
    $("#memo-content").classList.toggle("hidden", enabled); $("#memo-preview").classList.toggle("hidden", !enabled);
    $("#memo-preview-toggle").classList.toggle("active", enabled);
    if (enabled) $("#memo-preview").innerHTML = renderMarkdown($("#memo-content").value);
  }

  function renderMarkdown(content) {
    const lines = String(content || "").replaceAll("\r\n", "\n").split("\n");
    return lines.map((line, index) => {
      const checklist = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
      if (checklist) { const done = checklist[1].toLowerCase() === "x"; return `<div class="memo-preview-list ${done ? "done" : ""}"><button class="memo-check" type="button" data-memo-check-line="${index}">${done ? "✓" : ""}</button><span>${inlineMarkdown(checklist[2])}</span></div>`; }
      if (/^###\s+/.test(line)) return `<h3>${inlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`;
      if (/^##\s+/.test(line)) return `<h2>${inlineMarkdown(line.replace(/^##\s+/, ""))}</h2>`;
      if (/^#\s+/.test(line)) return `<h1>${inlineMarkdown(line.replace(/^#\s+/, ""))}</h1>`;
      if (/^>\s?/.test(line)) return `<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`;
      if (/^\s*[-*]\s+/.test(line)) return `<div class="memo-preview-list"><span>•</span><span>${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</span></div>`;
      if (/^\s*\d+\.\s+/.test(line)) return `<div class="memo-preview-list"><span>${escapeHTML(line.match(/^\s*(\d+)\./)?.[1] || "1")}.</span><span>${inlineMarkdown(line.replace(/^\s*\d+\.\s+/, ""))}</span></div>`;
      return line.trim() ? `<p>${inlineMarkdown(line)}</p>` : "<br>";
    }).join("");
  }

  function inlineMarkdown(value) {
    return escapeHTML(value).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }

  function insertFormatting(value, wrap = false) {
    const textarea = $("#memo-content"), start = textarea.selectionStart, end = textarea.selectionEnd;
    if (wrap) {
      const selected = textarea.value.slice(start, end) || "文字";
      textarea.setRangeText(`${value}${selected}${value}`, start, end, "end");
    } else {
      const lineStart = textarea.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      textarea.setRangeText(value, lineStart, lineStart, "end");
    }
    textarea.focus(); markDirty();
  }

  async function patchAction(payload, successMessage) {
    if (!state.current) return;
    if (state.dirty) await saveCurrent({ quiet: true });
    try {
      state.current = await memoAPI(`/api/v1/memos/${state.current.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      renderEditor(); await refreshLists(); if (successMessage) notify(successMessage);
    } catch (error) { notify(error.message, "error"); }
  }

  async function trashCurrent() {
    if (!state.current || !window.confirm(`将“${state.current.title}”移到最近删除？`)) return;
    try { await memoAPI(`/api/v1/memos/${state.current.id}`, { method: "DELETE" }); state.current = null; await loadMemos({ preserveSelection: false }); notify("已移到最近删除，可随时恢复。"); }
    catch (error) { notify(error.message, "error"); }
  }

  async function restoreCurrent() {
    if (!state.current) return;
    try { await memoAPI(`/api/v1/memos/${state.current.id}/restore`, { method: "POST" }); state.current = null; state.view = "all"; await loadMemos({ preserveSelection: false }); notify("备忘录已恢复。"); }
    catch (error) { notify(error.message, "error"); }
  }

  async function deletePermanently() {
    if (!state.current || !window.confirm(`永久删除“${state.current.title}”？此操作无法撤销。`)) return;
    try { await memoAPI(`/api/v1/memos/${state.current.id}/permanent`, { method: "DELETE" }); state.current = null; await loadMemos({ preserveSelection: false }); notify("备忘录已永久删除。"); }
    catch (error) { notify(error.message, "error"); }
  }

  async function duplicateCurrent() {
    if (!state.current) return;
    try { const copy = await memoAPI(`/api/v1/memos/${state.current.id}/duplicate`, { method: "POST" }); await loadMemos({ preserveSelection: false }); await selectMemo(copy.id, { skipSave: true }); notify("已创建备忘录副本。"); }
    catch (error) { notify(error.message, "error"); }
  }

  function downloadCurrent() {
    if (!state.current) return;
    const title = $("#memo-title").value || "备忘录";
    const blob = new Blob([`# ${title}\n\n${$("#memo-content").value}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "-")}.md`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function createFolder(event) {
    event.preventDefault();
    try {
      await memoAPI("/api/v1/memo-folders", { method: "POST", body: JSON.stringify({ name: $("#memo-folder-name").value, color: state.folderColor }) });
      $("#memo-folder-dialog").close(); $("#memo-folder-form").reset(); await loadMemos(); notify("文件夹已创建。");
    } catch (error) { notify(error.message, "error"); }
  }

  async function manageFolder(id) {
    const folder = state.folders.find((item) => item.id === id); if (!folder) return;
    const answer = window.prompt(`修改文件夹名称；输入“删除”可移除文件夹（其中的备忘录会保留）：`, folder.name);
    if (answer === null) return;
    try {
      if (answer.trim() === "删除") {
        if (!window.confirm(`删除文件夹“${folder.name}”？其中的备忘录将移到默认位置。`)) return;
        await memoAPI(`/api/v1/memo-folders/${id}`, { method: "DELETE" }); if (state.folderID === id) state.folderID = "";
      } else if (answer.trim() && answer.trim() !== folder.name) await memoAPI(`/api/v1/memo-folders/${id}`, { method: "PATCH", body: JSON.stringify({ name: answer.trim() }) });
      await loadMemos();
    } catch (error) { notify(error.message, "error"); }
  }

  function selectView(view) { state.view = view; state.folderID = ""; state.tag = ""; loadMemos({ preserveSelection: false }); }
  function selectFolder(id) { state.folderID = id; state.view = "all"; state.tag = ""; $(".memo-workspace").classList.remove("show-folders"); loadMemos({ preserveSelection: false }); }
  function selectTag(tag) { state.tag = state.tag === tag ? "" : tag; state.folderID = ""; state.view = "all"; loadMemos({ preserveSelection: false }); }

  function splitTags(value) { return [...new Set(String(value || "").split(/[,，]/).map((tag) => tag.trim().toLowerCase()).filter(Boolean))]; }
  function relativeDate(value) { const date = new Date(value), diff = Date.now() - date.getTime(); if (!Number.isFinite(diff)) return ""; if (diff < 60_000) return "刚刚"; if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`; if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`; return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date); }
  function fullDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "刚刚" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
  function folderColorValue(color) { return { yellow: "#e8b846", orange: "#e7924c", rose: "#de758c", violet: "#8d78d4", blue: "#6595df", mint: "#54b991", gray: "#929cab" }[color] || "#6595df"; }

  function bindEvents() {
    document.querySelector('[data-view="memos"]')?.addEventListener("click", () => loadMemos());
    $("#memo-new").addEventListener("click", createMemo); $("#memo-folder-add").addEventListener("click", () => { $("#memo-folder-dialog").showModal(); $("#memo-folder-name").focus(); });
    $("#memo-folder-cancel").addEventListener("click", () => $("#memo-folder-dialog").close()); $("#memo-folder-form").addEventListener("submit", createFolder);
    $("#memo-search").addEventListener("input", () => { state.query = $("#memo-search").value.trim(); window.clearTimeout(state.searchTimer); state.searchTimer = window.setTimeout(() => loadMemos({ preserveSelection: false }), 260); });
    $("#memo-sort").addEventListener("change", () => { state.sort = $("#memo-sort").value; loadMemos(); });
    ["#memo-title", "#memo-content", "#memo-tags"].forEach((selector) => $(selector).addEventListener("input", markDirty));
    $("#memo-folder-select").addEventListener("change", markDirty);
    $("#memo-preview-toggle").addEventListener("click", () => setPreview(!state.preview));
    $("#memo-pin").addEventListener("click", () => patchAction({ pinned: !state.current?.pinned }, state.current?.pinned ? "已取消置顶。" : "已置顶。"));
    $("#memo-archive").addEventListener("click", async () => { const archived = !state.current?.archived; await patchAction({ archived }, archived ? "已归档。" : "已移出归档。"); if (archived && state.view !== "archived") await loadMemos({ preserveSelection: false }); });
    $("#memo-duplicate").addEventListener("click", duplicateCurrent); $("#memo-download").addEventListener("click", downloadCurrent); $("#memo-trash").addEventListener("click", trashCurrent);
    $("#memo-restore").addEventListener("click", restoreCurrent); $("#memo-delete-permanent").addEventListener("click", deletePermanently);
    $("#memo-mobile-folders").addEventListener("click", () => $(".memo-workspace").classList.toggle("show-folders")); $("#memo-mobile-list").addEventListener("click", () => $(".memo-workspace").classList.remove("show-editor"));
    $("#memo-folder-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });

    document.addEventListener("click", async (event) => {
      const view = event.target.closest("[data-memo-view]"); if (view) return selectView(view.dataset.memoView);
      const folderMenu = event.target.closest("[data-memo-folder-menu]"); if (folderMenu) { event.stopPropagation(); return manageFolder(folderMenu.dataset.memoFolderMenu); }
      const folder = event.target.closest("[data-memo-folder]"); if (folder) return selectFolder(folder.dataset.memoFolder);
      const tag = event.target.closest("[data-memo-tag]"); if (tag) return selectTag(tag.dataset.memoTag);
      const note = event.target.closest("[data-memo-note]"); if (note) return selectMemo(note.dataset.memoNote);
      if (event.target.closest("[data-memo-create]")) return createMemo();
      if (event.target.closest("[data-memo-retry]")) return loadMemos();
      const prefix = event.target.closest("[data-memo-prefix]"); if (prefix) return insertFormatting(prefix.dataset.memoPrefix);
      const wrap = event.target.closest("[data-memo-wrap]"); if (wrap) return insertFormatting(wrap.dataset.memoWrap, true);
      if (event.target.closest("[data-memo-link]")) { const url = window.prompt("输入链接地址", "https://"); if (url && /^https?:\/\//i.test(url)) insertFormatting(`[链接文字](${url})`); return; }
      const color = event.target.closest("[data-memo-color]"); if (color && state.current) { state.current.color = color.dataset.memoColor; $$('[data-memo-color]').forEach((button) => button.classList.toggle("active", button === color)); markDirty(); return; }
      const folderColor = event.target.closest("[data-memo-folder-color]"); if (folderColor) { state.folderColor = folderColor.dataset.memoFolderColor; $$('[data-memo-folder-color]').forEach((button) => button.classList.toggle("active", button === folderColor)); return; }
      const check = event.target.closest("[data-memo-check-line]"); if (check && state.current) { const lines = $("#memo-content").value.split("\n"), index = Number(check.dataset.memoCheckLine); lines[index] = lines[index].replace(/^(\s*[-*]\s+\[)([ xX])(\])/, (_all, before, value, after) => `${before}${value.toLowerCase() === "x" ? " " : "x"}${after}`); $("#memo-content").value = lines.join("\n"); markDirty(); setPreview(true); }
    });

    document.addEventListener("keydown", (event) => {
      if (!$("#panel-memos")?.classList.contains("active")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); createMemo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveCurrent(); }
    });
    window.addEventListener("beforeunload", () => { if (state.dirty) saveCurrent({ quiet: true }); });
  }

  bindEvents();
})();
