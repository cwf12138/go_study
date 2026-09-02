(() => {
  "use strict";

  const state = { feed: null, articles: [], library: [], overview: {}, books: [], selected: null, words: [], initialized: false, loading: false, query: "", category: "", level: "", token: "" };
  const $ = (selector) => document.querySelector(selector);
  const escapeHTML = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  async function englishAPI(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = localStorage.getItem("studyflow.token") || "";
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body) headers.set("Content-Type", "application/json");
    let response;
    try { response = await fetch(path, { ...options, headers }); }
    catch { throw new Error("无法连接英语精读服务，请确认后端仍在运行。"); }
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
    return payload.data;
  }

  function notify(message, type = "success") {
    const toast = $("#toast"); if (!toast) return;
    toast.textContent = message; toast.className = `toast visible ${type === "error" ? "error" : ""}`;
    window.setTimeout(() => { if (toast.textContent === message) toast.className = "toast"; }, 3200);
  }

  function formatPublished(value) {
    const date = new Date(value); if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000) return "最新内容";
    const diff = Date.now() - date.getTime();
    if (diff >= 0 && diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
    if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
  }

  const categoryLabel = (value) => ({ world: "世界", science: "科学", technology: "科技", learning: "学习方法" }[value] || "综合");
  const existingReading = (articleID) => state.library.find((item) => item.article?.id === articleID);

  function syncEnglishAccount() {
    const token = localStorage.getItem("studyflow.token") || "";
    if (token === state.token) return token;
    state.token = token; state.feed = null; state.articles = []; state.library = []; state.overview = {}; state.books = []; state.selected = null; state.words = []; state.initialized = false;
    return token;
  }

  function filteredArticles() {
    const query = state.query.toLowerCase();
    return state.articles.filter((article) => (!state.category || article.category === state.category) && (!state.level || article.difficulty === state.level) && (!query || `${article.title} ${article.summary} ${article.source}`.toLowerCase().includes(query)));
  }

  function articleCard(article) {
    const reading = existingReading(article.id);
    return `<article class="english-article-card"><div class="english-card-top"><span class="english-source-label">${escapeHTML(article.source)}</span><span class="english-level">${escapeHTML(article.difficulty)}</span></div><h3>${escapeHTML(article.title)}</h3><p>${escapeHTML(article.summary)}</p><div class="english-card-foot"><span>${categoryLabel(article.category)} · ${article.reading_minutes || 1} 分钟 · ${formatPublished(article.published_at)}</span><button type="button" data-english-open="${escapeHTML(article.id)}">${reading?.status === "completed" ? "再次阅读" : reading ? "继续阅读" : "开始精读"} →</button></div></article>`;
  }

  function renderFeed() {
    const articles = filteredArticles();
    const featured = $("#english-featured"); const grid = $("#english-article-grid");
    if (!articles.length) {
      featured.innerHTML = '<div class="english-loading">没有符合当前筛选条件的内容。</div>';
      grid.innerHTML = '<div class="english-empty">换一个主题、难度或搜索词试试。</div>';
      return;
    }
    const lead = articles[0];
    featured.innerHTML = `<div class="english-featured-content"><p class="eyebrow">TODAY'S PICK · ${escapeHTML(lead.source)}</p><h2>${escapeHTML(lead.title)}</h2><p>${escapeHTML(lead.summary)}</p><div class="english-featured-meta"><span class="english-level">${escapeHTML(lead.difficulty)}</span><span>${categoryLabel(lead.category)}</span><span>约 ${lead.reading_minutes || 1} 分钟</span><span>${formatPublished(lead.published_at)}</span></div><button class="english-featured-open" type="button" data-english-open="${escapeHTML(lead.id)}">进入沉浸阅读 →</button></div>`;
    grid.innerHTML = articles.slice(1).map(articleCard).join("") || '<div class="english-empty">今天先认真读完这一篇吧。</div>';
  }

  function renderSources() {
    const sources = state.feed?.sources || [];
    $("#english-sources").innerHTML = sources.length ? sources.map((source) => `<div class="english-source-row ${source.available ? "available" : ""}"><span><i></i>${escapeHTML(source.name)}</span><b>${source.available ? `${source.count} 篇` : "暂不可用"}</b></div>`).join("") : '<span class="english-loading">暂无状态信息</span>';
    const status = $("#english-feed-status");
    if (state.feed?.degraded) { status.className = "english-feed-status warning"; status.textContent = "实时 RSS 暂时不可达，已切换到 StudyFlow 原创离线精读；恢复联网后点击“更新内容”。"; }
    else { const available = sources.filter((source) => source.available).length; status.className = "english-feed-status"; status.textContent = `已连接 ${available}/${sources.length} 个官方资讯源 · ${state.articles.length} 篇摘要 · ${formatPublished(state.feed?.fetched_at)}`; }
  }

  function renderOverview() {
    $("#english-week-count").textContent = state.overview.completed_this_week || 0;
    $("#english-saved-count").textContent = state.overview.saved || 0;
    $("#english-word-count").textContent = state.overview.new_words || 0;
    $("#english-streak-count").textContent = `${state.overview.streak_days || 0} 天`;
  }

  function renderLibrary() {
    const container = $("#english-library-list");
    if (!state.library.length) { container.innerHTML = '<div class="english-empty">阅读清单还是空的。打开一篇资讯，保存或标记精读后会出现在这里。</div>'; return; }
    container.innerHTML = state.library.map((reading) => `<article class="english-library-row"><div><div><span class="english-library-status ${reading.status}">${reading.status === "completed" ? "已精读" : "稍后读"}</span> <span class="english-source-label">${escapeHTML(reading.article.source)}</span></div><h4>${escapeHTML(reading.article.title)}</h4><p>${reading.article.reading_minutes || 1} 分钟 · ${reading.new_words?.length || 0} 个生词 · 更新于 ${formatPublished(reading.updated_at)}</p></div><div class="english-library-row-actions"><button class="quiet" type="button" data-english-open="${escapeHTML(reading.article.id)}">打开</button><button class="quiet" type="button" data-english-toggle="${escapeHTML(reading.id)}">${reading.status === "completed" ? "转为待读" : "标记完成"}</button><button class="quiet danger-text" type="button" data-english-delete="${escapeHTML(reading.id)}">删除</button></div></article>`).join("");
  }

  async function loadEnglish(refresh = false) {
    if (!syncEnglishAccount()) return;
    if (state.loading) return; state.loading = true;
    try {
      const [feed, library, overview, books] = await Promise.all([englishAPI(`/api/v1/english/articles${refresh ? "?refresh=true" : ""}`), englishAPI("/api/v1/english/library"), englishAPI("/api/v1/english/overview"), englishAPI("/api/v1/word-books")]);
      state.feed = feed; state.articles = feed?.articles || []; state.library = library || []; state.overview = overview || {}; state.books = books || []; state.initialized = true;
      renderFeed(); renderSources(); renderOverview(); renderLibrary(); renderWordBooks();
    } catch (error) { $("#english-article-grid").innerHTML = `<div class="english-empty">${escapeHTML(error.message)}<br><button class="quiet" type="button" data-english-retry>重新加载</button></div>`; notify(error.message, "error"); }
    finally { state.loading = false; $("#english-refresh").disabled = false; }
  }

  function renderWordBooks() {
    const select = $("#english-wordbook");
    select.innerHTML = state.books.length ? state.books.map((book) => `<option value="${escapeHTML(book.id)}">${escapeHTML(book.name)}</option>`).join("") : '<option value="">暂无词书</option>';
  }

  function renderWordChips() {
    $("#english-word-chips").innerHTML = state.words.length ? state.words.map((word) => `<button type="button" data-english-word="${escapeHTML(word)}" class="${$("#english-wordbook-term").value === word ? "active" : ""}">${escapeHTML(word)}</button>`).join("") : "<small>选中或输入生词</small>";
  }

  function addWord(value) {
    const word = String(value || "").toLowerCase().trim().replace(/^[^a-z'-]+|[^a-z'-]+$/g, "");
    if (!word || !/[a-z]/.test(word) || word.includes(" ")) return;
    if (!state.words.includes(word)) state.words.push(word);
    $("#english-wordbook-term").value = word; $("#english-word-input").value = ""; renderWordChips();
  }

  function openReader(articleID) {
    const article = state.articles.find((item) => item.id === articleID) || state.library.find((item) => item.article?.id === articleID)?.article;
    if (!article) return; state.selected = article;
    const reading = existingReading(article.id); state.words = [...(reading?.new_words || [])];
    $("#english-reader-source").textContent = article.source; $("#english-reader-title").textContent = article.title;
    $("#english-reader-meta").innerHTML = `<span class="english-level">${escapeHTML(article.difficulty)}</span><span>${categoryLabel(article.category)}</span><span>约 ${article.reading_minutes || 1} 分钟</span><span>${article.word_count || 0} 词</span>`;
    $("#english-reader-summary").textContent = article.summary; $("#english-reading-notes").value = reading?.notes || ""; $("#english-wordbook-term").value = ""; $("#english-wordbook-definition").value = "";
    const link = $("#english-original-link"); const notice = link.previousElementSibling;
    if (article.offline || !article.url) { link.classList.add("hidden"); notice.textContent = "这是离线原创训练，不对应外部新闻原文。"; } else { link.classList.remove("hidden"); link.href = article.url; notice.textContent = "摘要用于学习导读，完整内容请前往发布方网站"; }
    $("#english-save-reading").textContent = reading ? "更新阅读笔记" : "保存稍后读"; renderWordChips(); renderWordBooks(); $("#english-reader-dialog").showModal();
  }

  async function saveReading(status) {
    if (!state.selected) return;
    const existing = existingReading(state.selected.id); const payload = { notes: $("#english-reading-notes").value.trim(), new_words: state.words, status };
    try {
      if (existing) await englishAPI(`/api/v1/english/library/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await englishAPI("/api/v1/english/library", { method: "POST", body: JSON.stringify({ article: state.selected, ...payload }) });
      const [library, overview] = await Promise.all([englishAPI("/api/v1/english/library"), englishAPI("/api/v1/english/overview")]); state.library = library || []; state.overview = overview || {};
      renderFeed(); renderLibrary(); renderOverview(); notify(status === "completed" ? "已完成本次精读，记录已保存。" : "阅读内容已保存到清单。");
      if (status === "completed") $("#english-reader-dialog").close();
    } catch (error) { notify(error.message, "error"); }
  }

  async function saveWordToBook() {
    const bookID = $("#english-wordbook").value; const term = $("#english-wordbook-term").value.trim(); const definition = $("#english-wordbook-definition").value.trim();
    if (!bookID) { notify("请先在单词学习中创建词书。", "error"); return; }
    if (!term || !definition) { notify("请选择生词并填写语境释义。", "error"); return; }
    try { await englishAPI(`/api/v1/word-books/${encodeURIComponent(bookID)}/words`, { method: "POST", body: JSON.stringify({ term, definition, example: state.selected?.summary || "", notes: `来自英语精读：${state.selected?.title || ""}`, tags: ["english-reading"] }) }); $("#english-wordbook-definition").value = ""; notify(`“${term}”已加入词书。`); }
    catch (error) { notify(error.message, "error"); }
  }

  function speakArticle() {
    if (!state.selected || !window.speechSynthesis) { notify("当前浏览器不支持语音朗读。", "error"); return; }
    window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(`${state.selected.title}. ${state.selected.summary}`); utterance.lang = "en-US"; utterance.rate = .88; window.speechSynthesis.speak(utterance);
  }

  function bindEvents() {
    document.querySelector('[data-view="english"]')?.addEventListener("click", () => { syncEnglishAccount(); if (!state.initialized) loadEnglish(); });
    $("#english-refresh").addEventListener("click", () => { $("#english-refresh").disabled = true; loadEnglish(true); });
    $("#english-search").addEventListener("input", () => { state.query = $("#english-search").value.trim(); renderFeed(); });
    $("#english-category").addEventListener("change", () => { state.category = $("#english-category").value; renderFeed(); });
    $("#english-level").addEventListener("change", () => { state.level = $("#english-level").value; renderFeed(); });
    $("#english-library-toggle").addEventListener("click", () => { $("#english-library").classList.remove("hidden"); $("#english-featured").classList.add("hidden"); $("#english-article-grid").classList.add("hidden"); $("#english-feed-status").classList.add("hidden"); });
    $("#english-library-close").addEventListener("click", () => { $("#english-library").classList.add("hidden"); $("#english-featured").classList.remove("hidden"); $("#english-article-grid").classList.remove("hidden"); $("#english-feed-status").classList.remove("hidden"); });
    $("#english-reader-close").addEventListener("click", () => $("#english-reader-dialog").close());
    $("#english-reader-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
    $("#english-speak").addEventListener("click", speakArticle); $("#english-speak-stop").addEventListener("click", () => window.speechSynthesis?.cancel());
    $("#english-add-word").addEventListener("click", () => addWord($("#english-word-input").value));
    $("#english-word-input").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addWord(event.currentTarget.value); } });
    $("#english-reader-summary").addEventListener("mouseup", () => { const selected = window.getSelection()?.toString().trim() || ""; if (/^[a-zA-Z][a-zA-Z'-]{1,39}$/.test(selected)) addWord(selected); });
    $("#english-save-reading").addEventListener("click", () => saveReading(existingReading(state.selected?.id)?.status || "saved")); $("#english-complete-reading").addEventListener("click", () => saveReading("completed")); $("#english-save-word").addEventListener("click", saveWordToBook);
    document.addEventListener("click", async (event) => {
      const open = event.target.closest("[data-english-open]"); if (open) openReader(open.dataset.englishOpen);
      const word = event.target.closest("[data-english-word]"); if (word) { const value = word.dataset.englishWord; $("#english-wordbook-term").value = value; renderWordChips(); }
      const retry = event.target.closest("[data-english-retry]"); if (retry) loadEnglish(true);
      const toggle = event.target.closest("[data-english-toggle]"); if (toggle) { const reading = state.library.find((item) => item.id === toggle.dataset.englishToggle); if (reading) { await englishAPI(`/api/v1/english/library/${encodeURIComponent(reading.id)}`, { method: "PATCH", body: JSON.stringify({ status: reading.status === "completed" ? "saved" : "completed" }) }); await loadEnglish(); } }
      const remove = event.target.closest("[data-english-delete]"); if (remove && window.confirm("从阅读清单中删除这条记录？")) { await englishAPI(`/api/v1/english/library/${encodeURIComponent(remove.dataset.englishDelete)}`, { method: "DELETE" }); await loadEnglish(); notify("阅读记录已删除。"); }
    });
    const panel = $("#panel-english");
    if (panel) {
      new MutationObserver(() => { if (panel.classList.contains("active")) { syncEnglishAccount(); if (!state.initialized) loadEnglish(); } }).observe(panel, { attributes: true, attributeFilter: ["class"] });
      if (panel.classList.contains("active")) loadEnglish();
    }
  }

  bindEvents();
})();
