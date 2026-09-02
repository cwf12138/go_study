(() => {
  "use strict";

  const state = {
    notes: [], graph: { nodes: [], edges: [], orphan_count: 0, unresolved_count: 0 },
    detail: null, query: "", tag: "", view: "notes", initialized: false,
    loading: false, reloadRequested: false, searchTimer: null, commandItems: [], commandIndex: 0, token: "",
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  async function knowledgeAPI(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = localStorage.getItem("studyflow.token") || "";
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body) headers.set("Content-Type", "application/json");
    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch {
      throw new Error("无法连接到知识库服务。");
    }
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
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

  function shortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const diff = Date.now() - date.getTime();
    if (diff >= 0 && diff < 60_000) return "刚刚更新";
    if (diff >= 0 && diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
    if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date);
  }

  function renderInline(value) {
    return escapeHTML(value)
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, title, alias) => `<button class="knowledge-wiki-link" type="button" data-knowledge-title="${title.trim()}">${(alias || title).trim()}</button>`)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  }

  function renderMarkdown(content) {
    const lines = String(content || "").replaceAll("\r\n", "\n").split("\n");
    let inCode = false;
    return lines.map((line) => {
      if (line.trim().startsWith("```")) {
        inCode = !inCode;
        return inCode ? '<pre class="knowledge-code-block"><code>' : "</code></pre>";
      }
      if (inCode) return `${escapeHTML(line)}\n`;
      if (/^###\s+/.test(line)) return `<h3>${renderInline(line.replace(/^###\s+/, ""))}</h3>`;
      if (/^##\s+/.test(line)) return `<h2>${renderInline(line.replace(/^##\s+/, ""))}</h2>`;
      if (/^#\s+/.test(line)) return `<h1>${renderInline(line.replace(/^#\s+/, ""))}</h1>`;
      if (/^>\s?/.test(line)) return `<blockquote>${renderInline(line.replace(/^>\s?/, ""))}</blockquote>`;
      if (/^\s*[-*]\s+/.test(line)) return `<div class="knowledge-list-item"><i></i><span>${renderInline(line.replace(/^\s*[-*]\s+/, ""))}</span></div>`;
      if (/^\s*\d+\.\s+/.test(line)) return `<div class="knowledge-list-item numbered"><i></i><span>${renderInline(line.replace(/^\s*\d+\.\s+/, ""))}</span></div>`;
      return line.trim() ? `<p>${renderInline(line)}</p>` : '<div class="knowledge-paragraph-space"></div>';
    }).join("");
  }

  function listURL() {
    const query = new URLSearchParams();
    if (state.query) query.set("q", state.query);
    if (state.tag) query.set("tag", state.tag);
    return `/api/v1/knowledge/notes${query.toString() ? `?${query}` : ""}`;
  }

  function syncKnowledgeAccount() {
    const token = localStorage.getItem("studyflow.token") || "";
    if (state.token === token) return token;
    state.token = token;
    state.notes = [];
    state.graph = { nodes: [], edges: [], orphan_count: 0, unresolved_count: 0 };
    state.detail = null;
    state.query = "";
    state.tag = "";
    state.initialized = false;
    return token;
  }

  async function loadKnowledge({ preserveSelection = true } = {}) {
    if (!syncKnowledgeAccount()) return;
    if (state.loading) { state.reloadRequested = true; return; }
    state.loading = true;
    $("#knowledge-note-list").classList.add("loading");
    try {
      const [notes, graph] = await Promise.all([knowledgeAPI(listURL()), knowledgeAPI("/api/v1/knowledge/graph")]);
      state.notes = notes || [];
      state.graph = graph || { nodes: [], edges: [], orphan_count: 0, unresolved_count: 0 };
      state.initialized = true;
      renderKnowledgeChrome();
      const selectedExists = preserveSelection && state.detail && state.notes.some((note) => note.id === state.detail.note.id);
      if (!selectedExists) state.detail = null;
      if (!state.detail && state.notes[0]) await selectKnowledgeNote(state.notes[0].id, false);
      else renderKnowledgeDetail();
    } catch (error) {
      $("#knowledge-note-list").innerHTML = `<div class="knowledge-list-error">${escapeHTML(error.message)}<button type="button" data-knowledge-retry>重新加载</button></div>`;
      notify(error.message, "error");
    } finally {
      state.loading = false;
      $("#knowledge-note-list").classList.remove("loading");
      if (state.reloadRequested) {
        state.reloadRequested = false;
        loadKnowledge({ preserveSelection: false });
      }
    }
  }

  function renderKnowledgeChrome() {
    const nodes = state.graph.nodes || [];
    const tagCounts = new Map();
    nodes.forEach((node) => (node.tags || []).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
    $("#knowledge-total").textContent = nodes.length;
    $("#knowledge-linked").textContent = nodes.filter((node) => !node.orphan).length;
    $("#knowledge-orphans").textContent = state.graph.orphan_count || 0;
    $("#knowledge-tag-count").textContent = tagCounts.size;
    $("#knowledge-clear-filter").classList.toggle("hidden", !state.tag && !state.query);
    $("#knowledge-tags").innerHTML = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([tag, count]) => `<button class="${state.tag === tag ? "active" : ""}" type="button" data-knowledge-tag="${escapeHTML(tag)}"><span># ${escapeHTML(tag)}</span><b>${count}</b></button>`).join("") || '<p class="knowledge-no-tags">添加标签后，可在这里快速聚合主题。</p>';
    renderKnowledgeList();
    renderKnowledgeGraph();
  }

  function renderKnowledgeList() {
    const container = $("#knowledge-note-list");
    if (!state.notes.length) {
      const filtered = state.query || state.tag;
      container.innerHTML = `<div class="knowledge-list-empty"><span>${filtered ? "⌕" : "◇"}</span><h4>${filtered ? "没有匹配的笔记" : "知识花园还是空的"}</h4><p>${filtered ? "换一个关键词或清除筛选。" : "从今天学到的一个概念开始记录。"}</p>${filtered ? '<button class="text-button" type="button" data-knowledge-clear>清除筛选</button>' : '<button class="text-button" type="button" data-knowledge-create>新建笔记</button>'}</div>`;
      return;
    }
    container.innerHTML = state.notes.map((note) => {
      const links = (note.backlink_count || 0) + (note.outgoing_count || 0);
      return `<button class="knowledge-note-card ${state.detail?.note?.id === note.id ? "active" : ""}" type="button" data-knowledge-note="${note.id}"><span class="knowledge-note-card-top"><strong>${note.pinned ? '<i aria-label="已置顶">★</i>' : ""}${escapeHTML(note.title)}</strong><small>${shortDate(note.updated_at)}</small></span><span class="knowledge-note-snippet">${escapeHTML(note.snippet || "空白笔记")}</span><span class="knowledge-note-card-foot"><span>${(note.tags || []).slice(0, 2).map((tag) => `<em>#${escapeHTML(tag)}</em>`).join("")}</span><b>${links ? `↗ ${links}` : "未连接"}</b></span></button>`;
    }).join("");
  }

  async function selectKnowledgeNote(id, focusReader = true) {
    if (!id) return;
    try {
      state.detail = await knowledgeAPI(`/api/v1/knowledge/notes/${encodeURIComponent(id)}`);
      renderKnowledgeList();
      renderKnowledgeDetail();
      if (focusReader && window.innerWidth < 900) $(".knowledge-reader-panel")?.scrollIntoView?.({ behavior: "smooth" });
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function linkList(items, direction) {
    if (!items?.length) return '<div class="empty-state">暂无关联笔记。</div>';
    return items.map((link) => {
      const id = direction === "back" ? link.source_id : link.target_id;
      const title = direction === "back" ? link.source_title : link.target_title;
      return `<button type="button" ${id ? `data-knowledge-note="${id}"` : `data-knowledge-create-title="${escapeHTML(title)}"`}><span>${id ? "↗" : "+"}</span><span><strong>${escapeHTML(title)}</strong><small>${id ? (direction === "back" ? "提到了本文" : "已建立连接") : "尚未创建 · 点击建页"}</small></span></button>`;
    }).join("");
  }

  function renderKnowledgeDetail() {
    const detail = state.detail;
    $("#knowledge-reader-empty").classList.toggle("hidden", Boolean(detail));
    $("#knowledge-reader").classList.toggle("hidden", !detail);
    if (!detail) {
      $("#knowledge-backlink-count").textContent = "0";
      $("#knowledge-outgoing-count").textContent = "0";
      $("#knowledge-backlinks").innerHTML = '<div class="empty-state">选择笔记后查看反向链接。</div>';
      $("#knowledge-outgoing").innerHTML = '<div class="empty-state">尚未建立链接。</div>';
      return;
    }
    const note = detail.note;
    $("#knowledge-reader-title").textContent = note.title;
    $("#knowledge-reader-meta").textContent = `创建于 ${shortDate(note.created_at)} · 更新于 ${shortDate(note.updated_at)}`;
    $("#knowledge-reader-tags").innerHTML = (note.tags || []).map((tag) => `<button type="button" data-knowledge-tag="${escapeHTML(tag)}"># ${escapeHTML(tag)}</button>`).join("") || "<span>未添加标签</span>";
    $("#knowledge-pin").textContent = note.pinned ? "★" : "☆";
    $("#knowledge-pin").classList.toggle("active", note.pinned);
    $("#knowledge-pin").setAttribute("aria-label", note.pinned ? "取消置顶" : "置顶笔记");
    $("#knowledge-content").innerHTML = note.content ? renderMarkdown(note.content) : '<div class="knowledge-blank-note">这则笔记还没有正文，点击“编辑”开始书写。</div>';
    const backlinks = detail.backlinks || [];
    const outgoing = [...(detail.outgoing_links || []), ...(detail.unresolved_links || [])];
    $("#knowledge-backlink-count").textContent = backlinks.length;
    $("#knowledge-outgoing-count").textContent = outgoing.length;
    $("#knowledge-backlinks").innerHTML = linkList(backlinks, "back");
    $("#knowledge-outgoing").innerHTML = linkList(outgoing, "out");
  }

  function openKnowledgeEditor(detail = null, suggestedTitle = "") {
    const note = detail?.note;
    $("#knowledge-editor-heading").textContent = note ? "编辑笔记" : "新建笔记";
    $("#knowledge-note-id").value = note?.id || "";
    $("#knowledge-note-title").value = note?.title || suggestedTitle;
    $("#knowledge-note-tags").value = (note?.tags || []).join(", ");
    $("#knowledge-note-pinned").checked = Boolean(note?.pinned);
    $("#knowledge-note-content").value = note?.content || "";
    updateKnowledgePreview();
    const dialog = $("#knowledge-editor-dialog");
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => (suggestedTitle || note ? $("#knowledge-note-content") : $("#knowledge-note-title")).focus(), 30);
  }

  function updateKnowledgePreview() {
    const content = $("#knowledge-note-content").value;
    $("#knowledge-editor-count").textContent = `${[...content].length} 字`;
    $("#knowledge-editor-preview").innerHTML = content ? renderMarkdown(content) : '<div class="knowledge-preview-empty">预览会随着输入实时更新。</div>';
  }

  async function saveKnowledgeNote(event) {
    event.preventDefault();
    const id = $("#knowledge-note-id").value;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const body = {
      title: $("#knowledge-note-title").value.trim(), content: $("#knowledge-note-content").value,
      tags: $("#knowledge-note-tags").value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      pinned: $("#knowledge-note-pinned").checked,
    };
    button.disabled = true;
    try {
      const detail = await knowledgeAPI(id ? `/api/v1/knowledge/notes/${encodeURIComponent(id)}` : "/api/v1/knowledge/notes", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
      state.detail = detail;
      $("#knowledge-editor-dialog").close();
      await loadKnowledge();
      notify(id ? "笔记已更新，知识图谱也已重新连接。" : "笔记已创建，可以继续添加双向链接。");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function toggleKnowledgePin() {
    if (!state.detail) return;
    try {
      state.detail = await knowledgeAPI(`/api/v1/knowledge/notes/${state.detail.note.id}`, { method: "PATCH", body: JSON.stringify({ pinned: !state.detail.note.pinned }) });
      await loadKnowledge();
      notify(state.detail.note.pinned ? "笔记已置顶。" : "已取消置顶。");
    } catch (error) { notify(error.message, "error"); }
  }

  async function deleteKnowledgeNote() {
    if (!state.detail || !window.confirm(`确定删除“${state.detail.note.title}”吗？其他笔记中的链接会保留为待创建链接。`)) return;
    try {
      await knowledgeAPI(`/api/v1/knowledge/notes/${state.detail.note.id}`, { method: "DELETE" });
      state.detail = null;
      await loadKnowledge({ preserveSelection: false });
      notify("笔记已删除，原有引用已标记为待连接。");
    } catch (error) { notify(error.message, "error"); }
  }

  function setKnowledgeView(view) {
    state.view = view === "graph" ? "graph" : "notes";
    $("#knowledge-notes-view").classList.toggle("hidden", state.view !== "notes");
    $("#knowledge-graph-view").classList.toggle("hidden", state.view !== "graph");
    $$('[data-knowledge-view]').forEach((button) => button.classList.toggle("active", button.dataset.knowledgeView === state.view));
  }

  function graphPosition(index, total) {
    if (index === 0) return { x: 500, y: 300 };
    const perRing = 9;
    const ring = Math.floor((index - 1) / perRing);
    const position = (index - 1) % perRing;
    const count = Math.min(perRing, total - 1 - ring * perRing);
    const radius = 155 + ring * 105;
    const angle = -Math.PI / 2 + (position / Math.max(count, 1)) * Math.PI * 2 + ring * 0.24;
    return { x: 500 + Math.cos(angle) * radius, y: 300 + Math.sin(angle) * Math.min(radius, 245) };
  }

  function renderKnowledgeGraph() {
    const container = $("#knowledge-graph");
    const nodes = state.graph.nodes || [];
    if (!nodes.length) {
      container.innerHTML = '<div class="knowledge-graph-empty">创建两则笔记并用 <code>[[标题]]</code> 连接后，关系会出现在这里。</div>';
      return;
    }
    const positions = new Map(nodes.map((node, index) => [node.id, graphPosition(index, nodes.length)]));
    const edges = (state.graph.edges || []).map((edge) => {
      const from = positions.get(edge.source_id), to = positions.get(edge.target_id);
      return from && to ? `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>` : "";
    }).join("");
    const nodeMarkup = nodes.map((node, index) => {
      const position = positions.get(node.id), connections = (node.backlink_count || 0) + (node.outgoing_count || 0);
      const radius = Math.min(34, 17 + connections * 2.4 + (node.pinned ? 3 : 0));
      const kind = node.pinned ? "pinned" : node.orphan ? "orphan" : "connected";
      const title = node.title.length > 16 ? `${node.title.slice(0, 15)}…` : node.title;
      return `<g class="knowledge-graph-node ${kind} ${state.detail?.note?.id === node.id ? "active" : ""}" role="button" tabindex="0" data-knowledge-note="${node.id}" transform="translate(${position.x} ${position.y})"><circle r="${radius}"></circle><text y="${radius + 17}" text-anchor="middle">${escapeHTML(title)}</text><title>${escapeHTML(node.title)} · ${connections} 个连接</title>${index === 0 && nodes.length > 1 ? '<circle class="node-pulse" r="43"></circle>' : ""}</g>`;
    }).join("");
    container.innerHTML = `<svg viewBox="0 0 1000 600" role="img" aria-label="由 ${nodes.length} 则笔记组成的知识图谱"><g class="knowledge-graph-edges">${edges}</g><g>${nodeMarkup}</g></svg>`;
  }

  const navigationCommands = [
    ["dashboard", "概览", "◫", "首页 今日 数据"], ["goals", "学习目标", "◎", "目标 deadline"],
    ["moods", "心情日记", "☺", "情绪 mood"], ["calendar", "智能日历", "▦", "日程 日期"],
    ["knowledge", "知识花园", "◇", "笔记 图谱 knowledge"], ["tasks", "学习任务", "✓", "任务 task"],
    ["todo", "待办清单", "☑", "todo 清单"], ["planner", "智能规划", "▤", "计划 排程"],
    ["insights", "学习洞察", "⌁", "统计 周报"], ["vocabulary", "单词学习", "Aa", "英语 词书"],
    ["english", "英语精读", "En", "英语 外刊 新闻 阅读"],
    ["literature", "阅读书房", "阅", "电子书 世界名著 古诗词 古文 阅读"],
    ["focus", "专注会话", "◷", "计时 pomodoro"],
  ];

  function commandCatalog() {
    const actions = [
      { type: "action", id: "new-note", title: "新建知识笔记", subtitle: "记录想法并建立双向链接", icon: "+", keywords: "创建 笔记 note" },
      { type: "action", id: "new-task", title: "新建学习任务", subtitle: "跳转并填写一项明确行动", icon: "✓", keywords: "创建 任务 task" },
      { type: "action", id: "new-todo", title: "添加待办", subtitle: "快速进入待办收集箱", icon: "☑", keywords: "创建 todo 待办" },
      { type: "action", id: "start-focus", title: "开始专注", subtitle: "进入专注倒计时", icon: "◷", keywords: "计时 focus" },
    ];
    const pages = navigationCommands.map(([id, title, icon, keywords]) => ({ type: "page", id, title, subtitle: "前往功能页面", icon, keywords }));
    const notes = state.notes.slice(0, 12).map((note) => ({ type: "note", id: note.id, title: note.title, subtitle: note.snippet || "知识笔记", icon: note.pinned ? "★" : "◇", keywords: `${note.title} ${(note.tags || []).join(" ")} ${note.snippet || ""}` }));
    return [...actions, ...pages, ...notes];
  }

  function openCommandPalette() {
    if (!syncKnowledgeAccount()) return;
    const dialog = $("#command-dialog");
    $("#command-input").value = "";
    state.commandIndex = 0;
    renderCommandResults();
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => $("#command-input").focus(), 20);
    if (!state.initialized) loadKnowledge().then(() => { if (dialog.open) renderCommandResults(); });
  }

  function renderCommandResults() {
    const query = $("#command-input").value.trim().toLowerCase();
    state.commandItems = commandCatalog().filter((item) => !query || `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase().includes(query)).slice(0, 12);
    state.commandIndex = Math.min(state.commandIndex, Math.max(0, state.commandItems.length - 1));
    $("#command-results").innerHTML = state.commandItems.length ? state.commandItems.map((item, index) => `<button class="command-result ${index === state.commandIndex ? "active" : ""}" type="button" data-command-index="${index}"><span class="command-result-icon">${item.icon}</span><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.subtitle)}</small></span><kbd>↵</kbd></button>`).join("") : '<div class="command-empty"><span>⌕</span><p>没有匹配的命令或笔记</p></div>';
  }

  function navigateTo(view, focusSelector = "") {
    document.querySelector(`[data-view="${view}"]`)?.click();
    if (focusSelector) window.setTimeout(() => document.querySelector(focusSelector)?.focus(), 80);
  }

  async function executeCommand(index = state.commandIndex) {
    const item = state.commandItems[index];
    if (!item) return;
    $("#command-dialog").close();
    if (item.type === "page") return navigateTo(item.id);
    if (item.type === "note") {
      navigateTo("knowledge");
      if (!state.initialized) await loadKnowledge();
      await selectKnowledgeNote(item.id);
      return;
    }
    if (item.id === "new-note") { navigateTo("knowledge"); openKnowledgeEditor(); }
    if (item.id === "new-task") navigateTo("tasks", "#task-title");
    if (item.id === "new-todo") navigateTo("todo", "#todo-title");
    if (item.id === "start-focus") navigateTo("focus", "#focus-minutes");
  }

  function insertEditorText(prefix, wrap = false) {
    const textarea = $("#knowledge-note-content"), start = textarea.selectionStart, end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const replacement = wrap ? `${prefix}${selected || "文字"}${prefix}` : prefix;
    textarea.setRangeText(replacement, start, end, "end");
    textarea.focus();
    updateKnowledgePreview();
  }

  function clearKnowledgeFilters() {
    state.query = ""; state.tag = ""; $("#knowledge-search").value = "";
    loadKnowledge({ preserveSelection: false });
  }

  function bindKnowledgeEvents() {
    document.querySelector('[data-view="knowledge"]')?.addEventListener("click", () => loadKnowledge());
    $("#knowledge-new").addEventListener("click", () => openKnowledgeEditor());
    $("#knowledge-editor-close").addEventListener("click", () => $("#knowledge-editor-dialog").close());
    $("#knowledge-editor-cancel").addEventListener("click", () => $("#knowledge-editor-dialog").close());
    $("#knowledge-editor-form").addEventListener("submit", saveKnowledgeNote);
    $("#knowledge-note-content").addEventListener("input", updateKnowledgePreview);
    $("#knowledge-search").addEventListener("input", () => {
      state.query = $("#knowledge-search").value.trim();
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => loadKnowledge({ preserveSelection: false }), 260);
    });
    $("#knowledge-clear-filter").addEventListener("click", clearKnowledgeFilters);
    $("#knowledge-pin").addEventListener("click", toggleKnowledgePin);
    $("#knowledge-edit").addEventListener("click", () => openKnowledgeEditor(state.detail));
    $("#knowledge-delete").addEventListener("click", deleteKnowledgeNote);
    $("#command-trigger").addEventListener("click", openCommandPalette);
    $("#command-input").addEventListener("input", () => { state.commandIndex = 0; renderCommandResults(); });
    $("#knowledge-editor-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
    $("#command-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });

    document.addEventListener("click", async (event) => {
      const note = event.target.closest("[data-knowledge-note]");
      if (note) { setKnowledgeView("notes"); await selectKnowledgeNote(note.dataset.knowledgeNote); }
      const create = event.target.closest("[data-knowledge-create]");
      if (create) openKnowledgeEditor();
      const createTitle = event.target.closest("[data-knowledge-create-title]");
      if (createTitle) openKnowledgeEditor(null, createTitle.dataset.knowledgeCreateTitle);
      const wiki = event.target.closest("[data-knowledge-title]");
      if (wiki) {
        const target = (state.graph.nodes || []).find((item) => item.title.toLowerCase() === wiki.dataset.knowledgeTitle.toLowerCase());
        if (target) await selectKnowledgeNote(target.id); else openKnowledgeEditor(null, wiki.dataset.knowledgeTitle);
      }
      const tag = event.target.closest("[data-knowledge-tag]");
      if (tag) { state.tag = tag.dataset.knowledgeTag; state.query = ""; $("#knowledge-search").value = ""; await loadKnowledge({ preserveSelection: false }); }
      const clear = event.target.closest("[data-knowledge-clear]");
      if (clear) clearKnowledgeFilters();
      const retry = event.target.closest("[data-knowledge-retry]");
      if (retry) loadKnowledge();
      const view = event.target.closest("[data-knowledge-view]");
      if (view) setKnowledgeView(view.dataset.knowledgeView);
      const insert = event.target.closest("[data-knowledge-insert]");
      if (insert) insertEditorText(insert.dataset.knowledgeInsert);
      const wrap = event.target.closest("[data-knowledge-wrap]");
      if (wrap) insertEditorText(wrap.dataset.knowledgeWrap, true);
      const command = event.target.closest("[data-command-index]");
      if (command) executeCommand(Number(command.dataset.commandIndex));
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openCommandPalette(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && $("#knowledge-editor-dialog").open) { event.preventDefault(); $("#knowledge-editor-form").requestSubmit(); return; }
      const graphNode = event.target.closest?.(".knowledge-graph-node");
      if (graphNode && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setKnowledgeView("notes"); selectKnowledgeNote(graphNode.dataset.knowledgeNote); return; }
      if (!$("#command-dialog").open) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        state.commandIndex = (state.commandIndex + direction + state.commandItems.length) % Math.max(1, state.commandItems.length);
        renderCommandResults();
        $("#command-results .active")?.scrollIntoView?.({ block: "nearest" });
      }
      if (event.key === "Enter") { event.preventDefault(); executeCommand(); }
    });
  }

  bindKnowledgeEvents();
})();
