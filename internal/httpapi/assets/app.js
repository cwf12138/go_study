(() => {
  "use strict";

  const state = {
    token: localStorage.getItem("studyflow.token") || "",
    user: null,
    dashboard: null,
    todayCalendar: null,
    todayCalendarDate: "",
    todayCalendarError: false,
    todayTodosError: false,
    todayTodosDate: "",
    moodEntries: [],
    moodInsights: null,
    moodMonth: monthKey(new Date()),
    moodSelectedDate: localDateKey(new Date()),
    moodDraftRevision: 0,
    moodDraftSequence: 0,
    moodSaving: false,
    moodBase: null, moodLoadedMonth: "", moodLoadError: "",
    theme: loadTheme(),
    todoLists: [],
    todos: [],
    todoView: "today",
    todoFilters: { priority: "", tag: "", query: "" },
    wordBooks: [],
    vocabularyWords: [],
    vocabularyQueue: [],
    vocabularyOverview: null,
    vocabularyCatalogs: [],
    vocabularyBookID: "",
    vocabularyMode: "flashcard",
    vocabularyRevealed: false,
    vocabularySearch: "",
    vocabularyStage: "",
    vocabularyPage: 1,
    vocabularyPageSize: 20,
    vocabularyLoading: false,
    vocabularyReviewing: false,
    vocabularyInstalling: "",
    vocabularyError: false,
    vocabularyDisplayKey: "",
    vocabularyMeta: { total: 0, page: 1, total_pages: 1 },
    currentView: "dashboard",
    focus: loadFocus(),
    dailyFocusGoalMinutes: 60,
    isFinishingFocus: false,
    isUpdatingFocus: false,
    isStartingFocus: false,
    focusMessage: "",
    focusMessageError: false,
    toastTimer: null,
    vocabularySearchTimer: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const moodOptions = [
    { value: "awful", label: "很糟" },
    { value: "low", label: "低落" },
    { value: "neutral", label: "平静" },
    { value: "good", label: "不错" },
    { value: "great", label: "很好" },
  ];

  let recordAccountEpoch = 0;
  const recordVersion = record => record?.id && record.updated_at ? record.id + "@" + record.updated_at : "";
  function readMoodEditor() {
    return {mood:$("#mood-value").value,note:$("#mood-note").value,tags:$("#mood-tags").value,
      activities:$$('[data-mood-activity].selected').map(b=>b.dataset.moodActivity),stress:Number($("#mood-stress").value),energy:Number($("#mood-energy").value)};
  }
  const recordDrafts = window.DaynestRecordDrafts?.create({
    token:()=>state.token,
    read:()=>({key:state.moodSelectedDate,known:state.moodLoadedMonth===state.moodMonth,base:state.moodBase,value:readMoodEditor(),dirty:!!state.moodDraftRevision}),
    async load(key) {
      const entries=await api(`/api/v1/moods?month=${encodeURIComponent(key.slice(0,7))}`);
      if(!Array.isArray(entries))throw Error("日记数据格式异常，请重试。");
      return {record:entries.find(e=>e.date===key)||null,context:entries};
    },
    prepare(r) {
      return !state.moodSaving && (!state.moodDraftRevision || (state.moodSelectedDate===r.key && window.DaynestRecordDraftCore.equal("mood",readMoodEditor(),r.value)));
    },
    async apply(r,result) {
      moodLoadVersion++;state.moodMonth=r.key.slice(0,7);state.moodSelectedDate=r.key;state.moodLoadedMonth=state.moodMonth;state.moodLoadError="";
      state.moodEntries=result.context;state.moodInsights=null;state.moodDraftRevision=0;renderMoods();
      renderMoodForm({...r.value,tags:r.value.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)});
      state.moodBase=result.record;state.moodDraftRevision=++state.moodDraftSequence;showView("moods");
      updateMoodDraftStatus("草稿已恢复到原日期 · 请点击保存这一天");
      document.dispatchEvent(new CustomEvent("daynest:mood-date-selected"));
    },
  });

  function moodAvatar(value) {
    const mood = moodOptions.find(option => option.value === value);
    if (!mood) return "";
    return `<img class="mood-avatar" src="/static/mood-art/${mood.value}-wisp-v4.png" width="192" height="192" alt="" aria-hidden="true" draggable="false" loading="lazy" decoding="async">`;
  }

  async function api(path, options = {}) {
    const requestToken = state.token;
    const requestContext=window.DaynestHTTP?.capture();
    const storedToken = localStorage.getItem("studyflow.token") || "";
    if (requestToken !== storedToken) throw new Error("账号已切换，请等待重新连接或刷新页面。");
    if(window.DaynestHTTP?.authExpired()&&!path.startsWith("/api/v1/auth/")){const error=Error("登录已过期。未提交内容仍在，请保留或导出后重新登录。");error.status=401;error.kind="auth";throw error;}
    const { returnEnvelope = false, ...requestOptions } = options;
    if(window.DaynestHTTP && window.DaynestSaveCore?.tracked(path, requestOptions.method)) return window.DaynestHTTP.json(path, { ...requestOptions, context: requestContext, envelope: returnEnvelope });
    const headers = new Headers(requestOptions.headers || {});
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (requestOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    let response;
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (requestOptions.signal?.aborted) abort();
    else requestOptions.signal?.addEventListener("abort", abort, { once: true });
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    const endPlanningWrite=window.DaynestReadCache?.beginPlanningWrite(path,requestOptions.method,requestContext);
    try {
      response = await fetch(path, { ...requestOptions, headers, signal: controller.signal, cache: "no-store" });
      const payload = response.status === 204 ? null : await response.json().catch(error => { if (response.ok) throw error; return null; });
      if (state.token !== requestToken || (localStorage.getItem("studyflow.token") || "") !== storedToken || (requestContext&&!window.DaynestHTTP.current(requestContext))) throw new Error("账号已切换，已忽略旧请求结果。");
      if (!response.ok) {
        if (response.status === 401 && state.token) {
          if(window.DaynestHTTP?.reportUnauthorized)window.DaynestHTTP.reportUnauthorized(requestContext);
          else leaveApp();
        }
        const error = new Error(payload?.error?.message || `请求失败（${response.status}）`);
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return null;
      if (!payload || typeof payload !== "object" || !Object.hasOwn(payload, "data")) throw new Error("服务返回格式不完整，请确认已重启当前版本的 Go 服务。");
      return returnEnvelope ? payload : payload.data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error(timedOut ? "请求超时；保存类操作请先核对结果，不要重复新建。" : "请求已取消。");
      if (error instanceof SyntaxError) throw new Error("服务返回了无效数据，请重试或检查服务日志。");
      if (error instanceof TypeError) throw new Error("无法连接到服务，请确认 Go API 正在运行。");
      throw error;
    } finally { endPlanningWrite?.();window.clearTimeout(timeout); requestOptions.signal?.removeEventListener("abort", abort); }
  }

  function notify(message, type = "success") {
    if (window.DaynestUI) return window.DaynestUI.notify(message, type);
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast visible ${type === "error" ? "error" : ""}`;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => { toast.className = "toast"; }, 3200);
  }

  function formatDate(value, withTime = false) {
    if (!value) return "未设置";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未设置";
    return new Intl.DateTimeFormat("zh-CN", withTime
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" }).format(date);
  }

  function deadlineStatus(value) {
    if (!value) return "未设置截止日期";
    const deadline = new Date(value);
    if (Number.isNaN(deadline.getTime())) return "未设置截止日期";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadlineDay = new Date(deadline);
    deadlineDay.setHours(0, 0, 0, 0);
    const days = Math.round((deadlineDay.getTime() - today.getTime()) / 86400000);
    if (days > 1) return `剩余 ${days} 天`;
    if (days === 1) return "明天截止";
    if (days === 0) return "今天截止";
    if (days === -1) return "已逾期 1 天";
    return `已逾期 ${Math.abs(days)} 天`;
  }

  function toISO(value) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function monthKey(date) {
    return localDateKey(date).slice(0, 7);
  }

  function loadFocus() {
    try {
      const value = JSON.parse(localStorage.getItem("studyflow.focus") || "null");
      return value?.id && value?.startedAt ? value : null;
    } catch {
      return null;
    }
  }

  function persistFocus() {
    if (state.focus) localStorage.setItem("studyflow.focus", JSON.stringify(state.focus));
    else localStorage.removeItem("studyflow.focus");
    document.dispatchEvent(new CustomEvent("daynest:focus-changed"));
  }

  function loadDailyFocusGoal() {
    const raw = localStorage.getItem(`studyflow.dailyFocusGoal.${state.user?.id || "default"}`);
    const value = Number(raw);
    return raw != null && raw !== "" && Number.isFinite(value) && value > 0 ? clampDailyFocusGoal(value) : 60;
  }

  function persistDailyFocusGoal() {
    localStorage.setItem(`studyflow.dailyFocusGoal.${state.user?.id || "default"}`, String(state.dailyFocusGoalMinutes));
  }

  function loadTheme() {
    return localStorage.getItem("studyflow.theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(theme, persist = false) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = state.theme;
    const dark = state.theme === "dark";
    $("#theme-toggle").setAttribute("aria-label", dark ? "切换至浅色模式" : "切换至夜间模式");
    $("#theme-toggle").setAttribute("title", dark ? "切换至浅色模式" : "切换至夜间模式");
    $("#theme-toggle").querySelector('[aria-hidden="true"]').textContent = dark ? "☀" : "☾";
    $("#theme-toggle-label").textContent = dark ? "浅色" : "夜间";
    if (persist) localStorage.setItem("studyflow.theme", state.theme);
  }

  function toggleTheme() {
    applyTheme(state.theme === "dark" ? "light" : "dark", true);
  }

  function authTab(tab) {
    const registering = tab === "register";
    $$("[data-auth-tab]").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
    $("#login-form").classList.toggle("hidden", registering);
    $("#register-form").classList.toggle("hidden", !registering);
  }

  function enterApp(user) {
    recordAccountEpoch++;
    state.user = user;
    try { state.vocabularyBookID = localStorage.getItem(`studyflow.vocabularyBook.${user.id}`) || ""; } catch (_) { /* Storage may be disabled. */ }
    setFocusFeedback();
    state.dailyFocusGoalMinutes = loadDailyFocusGoal();
    if (state.focus && state.focus.userID !== user.id) {
      state.focus = null;
      persistFocus();
    }
    $("#auth-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    $("#user-name").textContent = user.name;
    // A fast session restore can complete before deferred feature scripts load.
    // Expose only a verified, still-current identity so late subscribers can catch up.
    const accountServer = () => window.DaynestMobile?.getConnectionInfo?.().server || window.location?.origin || "";
    const verified = { userID: user.id, token: state.token, server: accountServer(), sessionID: recordAccountEpoch };
    window.DaynestAccount = { current() {
      if (state.user?.id !== verified.userID || state.token !== verified.token || localStorage.getItem("studyflow.token") !== verified.token || accountServer() !== verified.server || $("#app-view").classList.contains("hidden")) return null;
      return { ...verified };
    } };
    document.dispatchEvent(new CustomEvent("daynest:account-ready", { detail: { userID: user.id } }));
    showView(viewFromURL() || state.currentView, { history: "replace" });
    refresh().catch((error) => notify(error.message, "error"));
  }

  function leaveApp({ keepStoredSession = false } = {}) {
    document.dispatchEvent(new CustomEvent('daynest:account-leaving',{detail:{keepStoredSession}}));
    recordDrafts?.capture("mood"); recordAccountEpoch++;
    coreReadyToken = "";
    restoringSession = "";
    $("#auth-reconnect").disabled = false;
    window.DaynestUI?.reset();
    document.querySelectorAll("form[data-draft-guard]").forEach(form => form.reset());
    const connection = document.getElementById("auth-connection");
    if (connection) connection.hidden = true;
    state.token = "";
    state.user = null;
    state.dashboard = null;
    state.todayCalendar = null;
    state.todayCalendarDate = "";
    state.todayCalendarError = false;
    state.todayTodosError = false;
    state.todayTodosDate = "";
    state.moodEntries = [];
    state.moodInsights = null;
    state.moodMonth = monthKey(new Date());
    state.moodSelectedDate = localDateKey(new Date());
    state.moodDraftRevision = 0;
    state.moodSaving = false; state.moodBase = null; state.moodLoadedMonth = ""; state.moodLoadError = ""; moodLoadVersion++;
    $("#mood-form").reset?.(); $("#mood-form").inert = false;
    renderMoods();
    state.todoLists = [];
    $("#todo-list").innerHTML = "";
    $("#todo-list").disabled = true;
    state.todos = [];
    state.todoView = "today";
    state.todoFilters = { priority: "", tag: "", query: "" };
    state.wordBooks = [];
    state.vocabularyWords = [];
    state.vocabularyQueue = [];
    state.vocabularyOverview = null;
    state.vocabularyCatalogs = [];
    state.vocabularyBookID = "";
    state.vocabularyLoading = false; state.vocabularyReviewing = false; state.vocabularyInstalling = ""; state.vocabularyError = false; state.vocabularyDisplayKey = "";
    vocabularyVersion++; vocabularyLibraryVersion++;
    state.vocabularyMode = "flashcard";
    state.vocabularyRevealed = false;
    state.vocabularySearch = "";
    state.vocabularyStage = "";
    state.vocabularyPage = 1;
    state.vocabularyMeta = { total: 0, page: 1, total_pages: 1 };
    state.focus = null;
    state.dailyFocusGoalMinutes = 60;
    setFocusFeedback();
    if (!keepStoredSession) { localStorage.removeItem("studyflow.token"); persistFocus(); }
    $("#app-view").classList.add("hidden");
    $("#auth-view").classList.remove("hidden");
    recordDrafts?.reset();
    authTab("login");
  }

  async function handleAccountStorage(event) {
    if (event.key !== "studyflow.token" && event.key !== null) return;
    const next = localStorage.getItem("studyflow.token") || "";
    if (next === state.token) return;
    // Clearing this tab must not erase the new account's shared token or timer.
    leaveApp({ keepStoredSession: true });
    state.token = next;
    state.focus = loadFocus();
    if (next) await restoreSession();
  }

  function viewFromURL() {
    const hash = window.location?.hash || "";
    return /^#[a-z-]+$/.test(hash) ? hash.slice(1) : "dashboard";
  }

  const viewScrollPositions = new Map();
  function showView(view, { history = "push" } = {}) {
    if (view === "transfers" || view === "bookmarks") view = "dashboard";
    if (view === "care") {
      view = "dashboard";
      history = "replace";
    }
    if (view === "explore") {
      view = "timeline";
      history = "replace";
    }
    if (view === "daily") { document.getElementById("daily-trigger")?.click(); return; }
    if (["insights", "goals", "tasks", "planner"].includes(view)) {
      view = view === "tasks" ? "todo" : view === "planner" ? "calendar" : "vocabulary";
      history = "replace";
    }
    if (["memos", "inventory", "lab", "knowledge", "habits", "parcels"].includes(view)) {
      view = "dashboard";
      history = "replace";
    }
    if (view === "projects" || view === "travel" || view === "splits" || view === "whiteboards") view = "dashboard";
    const labels = {
      dashboard: ["DAYNEST · YOUR EVERYDAY", "今天"],
      timeline: ["LIFE TIMELINE", "生活足迹"],
      moods: ["MOOD JOURNAL", "心情日记"],
      calendar: ["SMART CALENDAR", "智能日历"],
      ledger: ["LIFE LEDGER", "生活账本"],
      subscriptions: ["RECURRING DETAILS", "订阅管家"],
      meals: ["WHAT SOUNDS GOOD", "今天吃什么"],
      fitness: ["MOVE AT YOUR OWN PACE", "运动日常"],
      transfers: ["A LITTLE CLOSER", "文件快传"],
      bookmarks: ["LINK LIBRARY", "随手收藏"],
      toolkit: ["EVERYDAY ESSENTIALS", "随身工具"],
      english: ["DAILY ENGLISH", "英语精读"],
      literature: ["LITERATURE STUDIO", "阅读书房"],
      todo: ["TODO LIST", "待办清单"],
      vocabulary: ["VOCABULARY", "单词学习"],
      focus: ["FOCUS", "专注会话"],
    };
    if (!Object.hasOwn(labels, view)) view = "dashboard";
    const targetPanel = $(`#panel-${view}`);
    if (!targetPanel) {
      notify("该功能页面尚未加载，请刷新页面后重试。", "error");
      return;
    }
    const label = labels[view] || [String(view).toUpperCase(), "功能页面"];
    const previousView = state.currentView;
    if (previousView !== view) viewScrollPositions.set(previousView, window.scrollY || 0);
    state.currentView = view;
    if (view !== "focus") setFocusQuiet(false);
    $("#page-kicker").textContent = label[0];
    $("#page-title").textContent = label[1];
    $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${view}`));
    $$(".nav-link").forEach((button) => { const active = button.dataset.view === view; button.classList.toggle("active", active); if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
    document.title = `${label[1]} · 日常 Daynest`;
    if (window.history && window.location?.hash !== `#${view}`) {
      window.history[history === "push" ? "pushState" : "replaceState"](null, "", `#${view}`);
    }
    const menuWasOpen = $(".sidebar").classList.contains("open");
    $(".sidebar").classList.remove("open");
    window.DaynestUI?.setMenu(false, false);
    if (menuWasOpen && window.DaynestUI) $("#main-content")?.focus({ preventScroll: true });
    if (previousView !== view && typeof window.scrollTo === "function") window.scrollTo({ top: viewScrollPositions.get(view) || 0, behavior: "instant" });
    const announcement = $("#page-announcement");
    if (announcement) announcement.textContent = `已打开${label[1]}`;
    if (previousView !== view && state.user && coreReadyToken === state.token) refresh({ background: true }).catch(() => undefined);
  }

  let refreshVersion = 0, backgroundRefresh = null, foregroundRefreshes = 0, backgroundPage = "", backgroundOwner = "", coreReadyToken = "";
  async function refresh({ background = false } = {}) {
    if (!state.user || !state.token) return;
    if (background && foregroundRefreshes) return;
    if (background && backgroundRefresh && backgroundOwner === state.token) {
      if (backgroundPage === state.currentView) return backgroundRefresh;
      const owner = state.token, page = state.currentView;
      return backgroundRefresh.then(() => { if (owner === state.token && page === state.currentView) return refresh({ background: true }); });
    }
    if (!background) foregroundRefreshes++;
    const promise = refreshCore(background);
    if (background) { backgroundRefresh = promise; backgroundPage = state.currentView; backgroundOwner = state.token; }
    try { return await promise; }
    finally { if (background) { if (backgroundRefresh === promise) backgroundRefresh = null; } else foregroundRefreshes--; }
  }

  async function refreshCore(background = false) {
    const version = ++refreshVersion, token = state.token;
    const moodMonth = state.moodMonth, moodVersion = moodLoadVersion;
    const vocabVersion = vocabularyVersion, vocabLibraryVersion = vocabularyLibraryVersion;
    const visible = {
      dashboard: [3,4,8], focus: [4], todo: [3,4],
      moods: [1,2], vocabulary: [5],
    };
    const needed = new Set([0,7,...(visible[state.currentView] || [])]), skipped = Symbol('not-requested');
    const wants = index => !background || needed.has(index);
    const request = (index, path, options) => wants(index) ? api(path, options) : Promise.resolve(skipped);
    const today = localDateKey(new Date());
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    setSyncStatus(background ? "正在同步当前页面…" : "正在同步核心模块…", true);
    const todoRead = path => window.DaynestHTTP ? window.DaynestHTTP.json(path) : api(path);
    const todoListsRequest = wants(3) ? todoRead("/api/v1/todo-lists") : Promise.resolve(skipped);
    const todosRequest = wants(4) ? todoListsRequest.then(() => todoRead(`/api/v1/todos?view=all&date=${today}`)) : Promise.resolve(skipped);
    const vocabularyRequest = wants(5) ? api("/api/v1/word-books").then(async (books = []) => {
      const selectedBookID = books.some((book) => book.id === state.vocabularyBookID)
        ? state.vocabularyBookID
        : (books.find(book=>book.source_id)?.id || books[0]?.id || "");
      if (!selectedBookID) return { books, selectedBookID, words: [], queue: [], overview: null };
      const bookQuery = `book_id=${encodeURIComponent(selectedBookID)}`;
      const [wordPage, queue, overview] = await Promise.all([
        api(`/api/v1/words?${bookQuery}&page=${state.vocabularyPage}&page_size=${state.vocabularyPageSize}&q=${encodeURIComponent(state.vocabularySearch)}&stage=${encodeURIComponent(state.vocabularyStage)}`, { returnEnvelope: true }),
        api(`/api/v1/words/queue?${bookQuery}&limit=100`),
        api(`/api/v1/vocabulary/overview?${bookQuery}`),
      ]);
      return { books, selectedBookID, words: wordPage.data || [], wordMeta: wordPage.meta || {}, queue, overview };
    }) : Promise.resolve(skipped);
    const results = await Promise.allSettled([
      request(0, "/api/v1/dashboard"),
      request(1, `/api/v1/moods?month=${state.moodMonth}`),
      request(2, `/api/v1/moods/insights?month=${state.moodMonth}`),
      todoListsRequest,
      todosRequest,
      vocabularyRequest,
      request(6, "/api/v1/vocabulary/catalogs"),
      request(7, "/api/v1/focus-sessions/active"),
      request(8, `/api/v1/calendar?start=${today}&end=${localDateKey(tomorrow)}`),
    ]);
    if (version !== refreshVersion || token !== state.token || !state.user) return;
    if (!background) coreReadyToken = token;
    const fallback = [state.dashboard, state.moodEntries, state.moodInsights, state.todoLists, state.todos, {books:state.wordBooks,selectedBookID:state.vocabularyBookID,words:state.vocabularyWords,wordMeta:state.vocabularyMeta,queue:state.vocabularyQueue,overview:state.vocabularyOverview}, state.vocabularyCatalogs, null, state.todayCalendar];
    const [dashboard, moods, moodInsights, todoLists, todos, vocabulary, vocabularyCatalogs, activeFocus] = results.map((result,index) => result.status === "fulfilled" && result.value !== skipped ? result.value : fallback[index]);
    state.dashboard = dashboard;
    if (wants(8)) {
      state.todayCalendarError = results[8].status === "rejected";
      state.todayCalendar = state.todayCalendarError ? null : results[8].value;
      state.todayCalendarDate = today;
    }
    if (moodMonth === state.moodMonth && moodVersion === moodLoadVersion) {
      state.moodEntries = moods || [];
      state.moodInsights = moodInsights || null;
      if (wants(1) && results[1].status === "fulfilled" && results[1].value !== skipped) {state.moodLoadedMonth=moodMonth;state.moodLoadError="";}
      else if(wants(1) && results[1].status === "rejected") state.moodLoadError="日记读取失败，请重试；不会把未知记录当作空白覆盖。";
    }
    state.todoLists = todoLists || [];
    state.todos = todos || [];
    if (wants(4)) {
      state.todayTodosError = results[4].status === "rejected";
      state.todayTodosDate = today;
    }
    if (vocabVersion === vocabularyVersion && vocabLibraryVersion === vocabularyLibraryVersion && !state.vocabularyLoading && !state.vocabularyReviewing && !state.vocabularyInstalling) {
    state.wordBooks = vocabulary.books || [];
    state.vocabularyBookID = vocabulary.selectedBookID || "";
    state.vocabularyWords = vocabulary.words || [];
    state.vocabularyMeta = vocabulary.wordMeta || { total: state.vocabularyWords.length, page: 1, total_pages: 1 };
    state.vocabularyQueue = vocabulary.queue || [];
    state.vocabularyOverview = vocabulary.overview || null;
    if (wants(5)) state.vocabularyError = results[5].status === "rejected";
    }
    if (vocabVersion === vocabularyVersion && !state.vocabularyInstalling) state.vocabularyCatalogs = vocabularyCatalogs || [];
    if (wants(7) && results[7].status === "fulfilled") syncActiveFocus(activeFocus);
    render();
    const names = ["概览","心情记录","心情统计","待办分类","待办事项","单词学习","词书目录","专注会话","今日安排"];
    const failures = results.flatMap((result,index) => result.status === "rejected" ? [names[index]] : []);
    setSyncStatus(failures.length ? `未更新：${failures.join("、")}。这些模块暂保留上次数据（首次加载可能为空）。` : `${background ? '当前页面已同步' : '已同步'} · ${new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}`, false, failures.length > 0);
  }

  function setSyncStatus(message, busy=false, failed=false) {
    const connection = $("#sidebar-connection");
    if (connection) { connection.textContent = busy ? "正在同步" : failed ? "部分数据待同步" : "数据已同步"; connection.parentElement?.setAttribute?.("data-state", busy ? "loading" : failed ? "error" : "ready"); }
    const text = $("#app-sync-status"), button = $("#app-sync-retry");
    if (!text || !button) return;
    text.textContent = message; text.parentElement.classList.toggle("sync-warning", failed);
    button.disabled = busy; button.textContent = busy ? "同步中…" : "刷新数据";
  }

  function syncActiveFocus(session) {
    if (!session) {
      if (state.focus) {
        state.focus = null;
        persistFocus();
      }
      return;
    }
    const completeTask = !session.todo_id && (state.focus?.id === session.id ? state.focus.completeTask : true);
    state.focus = {
      id: session.id,
      userID: state.user.id,
      taskID: session.task_id,
      todoID: session.todo_id, memoActionID: session.memo_action_id, titleSnapshot: session.title_snapshot,
      planBlockID: session.plan_block_id,
      startedAt: session.started_at,
      plannedMinutes: session.planned_minutes,
      breakEnabled: session.break_enabled,
      breakMinutes: session.break_minutes,
      phase: session.phase,
      phaseStartedAt: session.phase_started_at,
      phaseRemainingSeconds: session.phase_remaining_seconds,
      status: session.status,
      completeTask,
      autoFinishAttempted: false,
    };
    persistFocus();
  }

  function render() {
    renderDashboard();
    renderMoods();
    renderTodos();
    renderVocabulary();
    renderFocus();
    renderSelects();
  }

  function renderDashboard() {
    renderToday();
    const data = state.dashboard || {};
    $("#metric-vocabulary").textContent = data.due_vocabulary ?? 0;
    $("#metric-focus").textContent = data.focus_minutes_today ?? 0;
    $("#week-focus").textContent = `本周 ${data.focus_minutes_week ?? 0} 分钟`;

  }

  function renderToday() {
    const now = new Date(), today = localDateKey(now);
    $("#today-date").textContent = now.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
    const calendar = state.todayCalendarDate === today ? state.todayCalendar : null;
    if (window.DaynestMobileToday) {
      const status = (date, failed) => date !== today ? "loading" : failed ? "error" : "ready";
      window.DaynestMobileToday.render({
        day: today, now, calendar, todos: state.todos,
        calendarState: status(state.todayCalendarDate, state.todayCalendarError),
        todoState: status(state.todayTodosDate, state.todayTodosError),
        retry: () => refresh({ background: true }),
      });
      return;
    }
    const agenda = [...(calendar?.events || []).map(item => ({ title: item.title, time: item.occurrence_start, allDay: item.all_day })),
      ...(calendar?.plan_blocks || []).map(item => ({ title: item.title, time: item.start_at, allDay: false }))]
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || new Date(a.time) - new Date(b.time));
    $("#today-agenda").innerHTML = state.todayCalendarError
      ? '<p class="today-empty">日程暂未加载成功，请使用顶部“刷新数据”重试。</p>'
      : agenda.length ? agenda.slice(0, 5).map(item => `<button class="today-row" type="button" data-goto="calendar"><time>${item.allDay ? "全天" : escapeHTML(new Date(item.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }))}</time><span>${escapeHTML(item.title)}</span><i aria-hidden="true">↗</i></button>`).join("")
        : '<p class="today-empty">今天暂没有安排，给生活留一点空白。<button class="text-button" type="button" data-goto="calendar">打开日历</button></p>';
    const todos = state.todos.filter(item => item.status !== "completed" && (item.my_day_date === today || (item.due_at && localDateKey(new Date(item.due_at)) <= today)))
      .sort((a, b) => (a.due_at || "9999").localeCompare(b.due_at || "9999"));
    $("#today-todos").innerHTML = state.todayTodosError ? '<p class="today-empty">待办暂未加载成功，请使用顶部“刷新数据”重试。</p>' : todos.length ? todos.slice(0, 5).map(item => `<div class="today-row"><button class="todo-complete" type="button" data-todo-completed="true" data-id="${escapeHTML(item.id)}" aria-label="完成待办 ${escapeHTML(item.title)}"></button><button class="today-todo-title" type="button" data-goto="todo">${escapeHTML(item.title)}${item.due_at && localDateKey(new Date(item.due_at)) < today ? '<small>已逾期</small>' : ""}</button></div>`).join("")
      : '<p class="today-empty">今天没有待处理事项。<button class="text-button" type="button" data-goto="todo">添加待办</button></p>';
  }

  function renderMoods() {
    const calendar = $("#mood-calendar");
    if (!calendar) return;
    const [year, month] = state.moodMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const leadingDays = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const entryByDate = new Map(state.moodEntries.map((entry) => [entry.date, entry]));
    const currentDate = localDateKey(new Date());
    const cells = [];
    for (let index = 0; index < leadingDays; index += 1) cells.push('<span class="mood-day empty" aria-hidden="true"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${state.moodMonth}-${String(day).padStart(2, "0")}`;
      const entry = entryByDate.get(date);
      const option = moodOptions.find((item) => item.value === entry?.mood);
      const classes = ["mood-day"];
      if (entry) classes.push("has-entry");
      if (date === state.moodSelectedDate) classes.push("selected");
      if (date === currentDate) classes.push("today");
      if (date > currentDate) classes.push("future");
      cells.push(`<button class="${classes.join(" ")}" type="button" data-mood-date="${date}" data-emotion="${option?.value || 'none'}" aria-pressed="${date === state.moodSelectedDate}" ${date === currentDate ? 'aria-current="date"' : ''} aria-label="${date}${option ? `，${option.label}` : date > currentDate ? "，未来日期，尚未记录" : "，尚未记录"}${entry?.note ? '，有日记' : ''}"><span class="mood-date">${day}</span><span class="mood-face">${moodAvatar(entry?.mood)}</span>${entry?.note ? '<i class="mood-diary-dot" aria-hidden="true"></i>' : ''}</button>`);
    }
    calendar.innerHTML = cells.join("");
    $("#mood-month-title").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(firstDay);
    if (!state.moodDraftRevision && !state.moodSaving) renderMoodForm(entryByDate.get(state.moodSelectedDate));
    updateMoodAvailability();
    renderMoodInsights();
    renderMoodTrend();
  }

  function renderMoodForm(entry) {
    state.moodBase = entry || null;
    const mood = entry?.mood || "neutral";
    $("#mood-selected-date").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${state.moodSelectedDate}T12:00:00`));
    $("#mood-value").value = mood;
    $$('[data-mood-choice]').forEach((button) => {
      const selected = button.dataset.moodChoice === mood;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
      button.setAttribute("role", "radio"); button.tabIndex = selected ? 0 : -1;
    });
    $("#mood-note").value = entry?.note || "";
    $("#mood-tags").value = (entry?.tags || []).join(", ");
    $("#mood-stress").value = entry?.stress || 3;
    $("#mood-energy").value = entry?.energy || 3;
    $("#mood-stress-value").textContent = $("#mood-stress").value;
    $("#mood-energy-value").textContent = $("#mood-energy").value;
    const activities = new Set(entry?.activities || []);
    $$('[data-mood-extra]').forEach(button=>button.remove());
    const knownActivities = new Set($$('[data-mood-activity]').map(b=>b.dataset.moodActivity));
    for (const value of activities) if (!knownActivities.has(value)) {
      const button=document.createElement("button");button.type="button";button.dataset.moodActivity=value;button.dataset.moodExtra="true";button.textContent=value;$("#mood-activities").append(button);
    }
    $$('[data-mood-activity]').forEach((button) => { button.classList.toggle("selected", activities.has(button.dataset.moodActivity)); button.setAttribute("aria-pressed", String(activities.has(button.dataset.moodActivity))); });
    $("#delete-mood-entry").disabled = !entry;
    updateMoodDraftStatus(entry ? "这一天的记录已提交服务" : "还没有记录，慢慢写就好");
  }

  function updateMoodAvailability() {
    const ready=state.moodLoadedMonth===state.moodMonth;
    $("#mood-form").querySelectorAll("input,textarea,button").forEach(field=>{field.disabled=!ready;});
    const submit=$("#mood-form").querySelector('button[type="submit"]');if(submit)submit.disabled=!ready||state.moodSaving;
    $("#delete-mood-entry").disabled=!ready||state.moodSaving||!state.moodEntries.some(e=>e.date===state.moodSelectedDate);
    $("#mood-reload").hidden=ready&&!state.moodLoadError;
    if(!ready)updateMoodDraftStatus(state.moodLoadError||"正在读取这一天的记录，载入后即可填写…");
  }

  function renderMoodInsights() {
    const insights = state.moodInsights || {};
    const loggedDays = Number(insights.logged_days || 0);
    const average = (value) => Number(value || 0) ? Number(value).toFixed(1) : "–";
    $("#mood-logged-days").textContent = `${loggedDays} 天`;
    $("#mood-average").textContent = average(insights.average_mood);
    $("#mood-streak").textContent = insights.longest_streak || 0;
    $("#mood-stress-average").textContent = average(insights.average_stress);
    $("#mood-energy-average").textContent = average(insights.average_energy);
    const distribution = insights.mood_distribution || {};
    $("#mood-distribution").innerHTML = moodOptions.map((option) => {
      const count = Number(distribution[option.value] || 0);
      const width = loggedDays ? Math.round(count * 100 / loggedDays) : 0;
      return `<div class="mood-distribution-row" data-emotion="${option.value}"><span>${moodAvatar(option.value)} ${option.label}</span><div class="mood-distribution-track"><span style="width:${width}%"></span></div><strong>${count}</strong></div>`;
    }).join("");
    const activities = insights.top_activities || [];
    $("#mood-top-activities").innerHTML = activities.length
      ? `<div class="mood-activity-tags">${activities.map((activity) => `<span>${escapeHTML(activity.name)} · ${activity.count}</span>`).join("")}</div>`
      : "本月还没有活动记录";
  }

  function renderMoodTrend() {
    const container = $("#mood-trend");
    const caption = $("#mood-trend-caption");
    const entries = state.moodEntries.map((entry) => ({ ...entry, score: moodOptions.findIndex((option) => option.value === entry.mood) + 1 })).filter((entry) => entry.score > 0 && entry.date.startsWith(state.moodMonth)).sort((a,b) => a.date.localeCompare(b.date));
    if (!entries.length) {
      caption.textContent = "等待记录";
      container.className = "mood-trend empty-state";
      container.textContent = "记录几天心情后，这里会呈现你的变化轨迹。";
      container.setAttribute("aria-label", "本月没有心情记录");
      return;
    }
    const [year, month] = state.moodMonth.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const width = 560;
    const height = 190;
    const left = 33;
    const right = 14;
    const top = 15;
    const bottom = 31;
    const x = (day) => left + ((day - 1) / Math.max(1, daysInMonth - 1)) * (width - left - right);
    const y = (score) => top + ((5 - score) / 4) * (height - top - bottom);
    const points = entries.map((entry) => ({ ...entry, day: Number(entry.date.slice(-2)), x: x(Number(entry.date.slice(-2))), y: y(entry.score) }));
    const average = Number(state.moodInsights?.average_mood || 0).toFixed(1);
    caption.textContent = `已记录 ${entries.length} 天 · 平均 ${average}`;
    const grid = moodOptions.map((option, index) => `<line x1="${left}" y1="${y(index + 1)}" x2="${width - right}" y2="${y(index + 1)}" class="mood-trend-grid"/><image href="/static/mood-art/${option.value}-wisp-v4.png" x="-2" y="${y(index + 1) - 15}" width="30" height="30" preserveAspectRatio="xMidYMid meet"/>`).join("");
    const segments = []; let segment = [];
    for (const point of points) { if (segment.length && point.day !== segment[segment.length-1].day + 1) { segments.push(segment); segment=[]; } segment.push(point); }
    if (segment.length) segments.push(segment);
    const polylines = segments.filter(group=>group.length>1).map(group=>`<polyline points="${group.map(point=>`${point.x},${point.y}`).join(' ')}" class="mood-trend-line"/>`).join('');
    const dots = points.map((point) => {
      const option = moodOptions[point.score - 1];
      return `<circle cx="${point.x}" cy="${point.y}" r="5" class="mood-trend-dot" data-emotion="${option.value}"><title>${point.date} · ${option.label}</title></circle>`;
    }).join("");
    const labels = [1, Math.ceil(daysInMonth / 2), daysInMonth].map((day) => `<text x="${x(day)}" y="${height - 8}" text-anchor="middle" class="mood-trend-axis">${day}日</text>`).join("");
    container.className = "mood-trend";
    container.setAttribute("aria-label", `本月心情记录，未记录日期不连线。${entries.map(entry=>`${entry.date} ${moodOptions[entry.score-1].label}`).join('；')}`);
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${polylines}${dots}${labels}</svg><p class="mood-chart-note">每个圆点代表一次记录，空白日期不推测。心情没有标准答案。</p>`;
  }

  let moodLoadVersion = 0;
  async function refreshMoods() {
    const version = ++moodLoadVersion, month = state.moodMonth, token = state.token, epoch=recordAccountEpoch;
    const [entries, insights] = await Promise.allSettled([
      api(`/api/v1/moods?month=${state.moodMonth}`),
      api(`/api/v1/moods/insights?month=${state.moodMonth}`),
    ]);
    if (version !== moodLoadVersion || month !== state.moodMonth || token !== state.token || epoch!==recordAccountEpoch) return;
    if(entries.status!=="fulfilled"||!Array.isArray(entries.value)){state.moodLoadError="日记读取失败，请点击重新读取。编辑区不会覆盖未知的服务端记录。";updateMoodAvailability();throw entries.reason||Error("日记数据格式异常");}
    state.moodEntries = entries.value; state.moodLoadedMonth=month;state.moodLoadError="";
    state.moodInsights = insights.status==="fulfilled"?insights.value:null;
    renderMoods();
  }

  async function selectMoodMonth(month, selectedDate) {
    if (!/^(?:19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)-(?:0[1-9]|1[0-2])$/.test(month)) return;
    const today = localDateKey(new Date());
    const day = selectedDate || (today.startsWith(month + "-") ? today : month + "-01");
    const monthChanged = month !== state.moodMonth;
    const dayChanged = day !== state.moodSelectedDate;
    if ((monthChanged || dayChanged) && !canLeaveMoodDraft()) return;
    state.moodSelectedDate = day;
    if (monthChanged) {
      state.moodMonth = month;
      state.moodLoadedMonth = state.moodLoadError = "";
      state.moodEntries = [];
      state.moodInsights = null;
    }
    if (monthChanged || dayChanged) renderMoods();
    if (state.moodLoadedMonth === month) return;
    try { await refreshMoods(); } catch (error) { notify(error.message, "error"); }
  }

  function shiftMoodMonth(offset) {
    const [year, month] = state.moodMonth.split("-").map(Number);
    return selectMoodMonth(monthKey(new Date(year, month - 1 + offset, 1)));
  }

  async function saveMoodEntry(event) {
    event.preventDefault();
    if (state.moodSaving || state.moodLoadedMonth!==state.moodMonth || $("#mood-form").reportValidity?.()===false) return;
    const revision = state.moodDraftRevision, date = state.moodSelectedDate, owner=state.token, epoch=recordAccountEpoch;
    const current=()=>owner===state.token&&epoch===recordAccountEpoch&&date===state.moodSelectedDate;
    const value=readMoodEditor(),sent=recordDrafts?.capture("mood");
    const payload={...value,tags:value.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean),expected_version:recordVersion(state.moodBase)};
    state.moodSaving = true; updateMoodDraftStatus("正在保存…");
    moodLoadVersion++;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const saved = await api(`/api/v1/moods/${date}`, { method: "PUT", body: JSON.stringify(payload) });
      if(!current())return;
      if(!saved||saved.date!==date||!saved.id||!saved.updated_at)throw Error("日记保存响应不完整，请在本机草稿中核对。");
      state.moodBase=saved;
      if (date === state.moodSelectedDate && revision === state.moodDraftRevision) state.moodDraftRevision = 0;
      if(state.moodDraftRevision)recordDrafts?.capture("mood");
      recordDrafts?.ack("mood",sent,!state.moodDraftRevision);
      state.moodEntries = state.moodEntries.filter(entry=>entry.date!==date); if(saved) state.moodEntries.push(saved);
      try { await refreshMoods(); } catch (_) { if(current())notify("日记已提交服务，但月度统计暂未更新。", "error"); }
      if(current())updateMoodDraftStatus(state.moodDraftRevision ? "已提交本次内容，仍有新修改未保存" : "这一天的记录已提交服务");
    } catch (error) {
      if(!current())return;
      const message=error.status===409?"服务端也有修改，请打开本机草稿对照；输入内容已保留。":"保存失败，输入内容仍在，请重试";
      if(error.status===409){recordDrafts?.capture("mood");recordDrafts?.problem("mood",message);}
      updateMoodDraftStatus(message); notify(error.status===409?message:error.message, "error");
    } finally {
      if(current()){state.moodSaving = false;button.disabled = false;updateMoodAvailability();}
    }
  }

  function updateMoodDraftStatus(message) {
    $("#mood-draft-status").textContent = message || "有未保存修改 · 请点击保存这一天";
    $("#mood-note-count").textContent = `${$("#mood-note").value.length} / 6000`;
  }
  function markMoodDraft() { state.moodDraftRevision = ++state.moodDraftSequence; updateMoodDraftStatus();recordDrafts?.capture("mood"); }
  function canLeaveMoodDraft() {
    if (state.moodSaving) { notify("正在保存，请稍等片刻再切换日期。", "error"); return false; }
    if (state.moodDraftRevision) {
      const retained=recordDrafts?.retained("mood");
      if(!window.confirm(retained?"文字已保留在本机草稿，暂存并切换日期吗？":"本机草稿尚未确认保留。放弃编辑区修改并切换日期吗？重要文字请先导出。"))return false;
    }
    recordDrafts?.detach("mood");state.moodDraftRevision = 0; return true;
  }

  async function deleteMoodEntry() {
    const exists = state.moodEntries.some((entry) => entry.date === state.moodSelectedDate);
    if (!exists) return;
    if (state.moodSaving || !window.confirm("删除这一天的服务端心情记录和日记？此操作无法撤销。本机草稿仍可导出。")) return;
    recordDrafts?.capture("mood");
    const date=state.moodSelectedDate,owner=state.token,epoch=recordAccountEpoch;
    const current=()=>owner===state.token&&epoch===recordAccountEpoch&&date===state.moodSelectedDate;
    state.moodSaving = true;
    $("#mood-form").inert = true;
    const button = $("#delete-mood-entry");
    button.disabled = true;
    try {
      await api(`/api/v1/moods/${date}?expected_version=${encodeURIComponent(recordVersion(state.moodBase))}`, { method: "DELETE" });
      if(!current())return;
      recordDrafts?.detach("mood");
      state.moodDraftRevision = 0;
      state.moodEntries = state.moodEntries.filter(entry=>entry.date!==state.moodSelectedDate);
      renderMoodForm();
      try { await refreshMoods(); } catch (_) { if(current())notify("记录已删除，但统计暂未更新。", "error"); }
      if(current())notify("当天的心情记录已删除，本机草稿仍保留。");
    } catch (error) {
      if(current())notify(error.status===409?"记录已有更新，未执行删除。请重新读取后核对。":error.message, "error");
    } finally {
      if(current()){state.moodSaving = false;$("#mood-form").inert = false;button.disabled = !state.moodEntries.some(entry=>entry.date===date);}
    }
  }

  function todoListFor(todo) {
    return state.todoLists.find((list) => list.id === todo.list_id);
  }

  function todoMatchesCurrentView(todo) {
    const today = localDateKey(new Date());
    const inboxID = state.todoLists.find((list) => list.kind === "inbox")?.id;
    if (state.todoView === "today") return todo.status === "open" && todo.my_day_date === today;
    if (state.todoView === "inbox") return todo.status === "open" && todo.list_id === inboxID;
    if (state.todoView === "upcoming") return todo.status === "open" && todo.due_at && localDateKey(new Date(todo.due_at)) >= today;
    if (state.todoView === "completed") return todo.status === "completed";
    if (state.todoView.startsWith("list:")) return todo.status === "open" && todo.list_id === state.todoView.slice(5);
    return todo.status === "open";
  }

  function todoMatchesFilters(todo) {
    const filters = state.todoFilters;
    if (filters.priority && todo.priority !== filters.priority) return false;
    if (filters.tag && !(todo.tags || []).some((tag) => tag.toLowerCase() === filters.tag.toLowerCase())) return false;
    if (!filters.query) return true;
    const query = filters.query.toLowerCase();
    return todo.title.toLowerCase().includes(query) || (todo.notes || "").toLowerCase().includes(query) || (todo.tags || []).some((tag) => tag.toLowerCase().includes(query));
  }

  function todoViewDetails() {
    if (state.todoView.startsWith("list:")) {
      const list = state.todoLists.find((item) => item.id === state.todoView.slice(5));
      return [list?.name || "分类清单", "LIST", "按分类集中处理下一步。"];
    }
    return ({
      today: ["我的一天", "MY DAY", "从收集箱中挑选今天真正要完成的事。"],
      inbox: ["收集箱", "INBOX", "先记录下来，稍后再决定何时处理。"],
      upcoming: ["即将到期", "UPCOMING", "按截止时间安排接下来的节奏。"],
      completed: ["已完成", "COMPLETED", "回顾已经完成的事项与重复任务记录。"],
      all: ["全部待办", "ALL TODOS", "所有尚未完成的待办事项。"],
    }[state.todoView] || ["待办清单", "TODO LIST", "管理下一步。"]);
  }

  function todoRepeatLabel(rule) {
    return ({ daily: "每天重复", weekly: "每周重复", monthly: "每月重复" }[rule] || "");
  }

  function renderTodos() {
    const today = localDateKey(new Date());
    const items = state.todos.filter((todo) => todoMatchesCurrentView(todo) && todoMatchesFilters(todo));
    const [title, kicker, description] = todoViewDetails();
    const inbox = state.todoLists.find((list) => list.kind === "inbox");
    const openTodos = state.todos.filter((todo) => todo.status === "open");
    const tags = [...new Set(state.todos.flatMap((todo) => todo.tags || []))].sort((left, right) => left.localeCompare(right, "zh-CN"));

    $("#todo-view-title").textContent = title;
    $("#todo-view-kicker").textContent = kicker;
    $("#todo-view-description").textContent = description;
    $("#todo-view-count").textContent = `${items.length} 项`;
    $("#todo-today-count").textContent = openTodos.filter((todo) => todo.my_day_date === today).length;
    $("#todo-inbox-count").textContent = inbox ? openTodos.filter((todo) => todo.list_id === inbox.id).length : 0;
    $$('[data-todo-view]').forEach((button) => button.classList.toggle("active", button.dataset.todoView === state.todoView));

    const search = $("#todo-search");
    const priority = $("#todo-priority-filter");
    const tag = $("#todo-tag-filter");
    if (!tags.includes(state.todoFilters.tag)) state.todoFilters.tag = "";
    if (search.value !== state.todoFilters.query) search.value = state.todoFilters.query;
    priority.value = state.todoFilters.priority;
    tag.innerHTML = `<option value="">全部标签</option>${tags.map((value) => `<option value="${escapeHTML(value)}">#${escapeHTML(value)}</option>`).join("")}`;
    tag.value = tags.some((value) => value === state.todoFilters.tag) ? state.todoFilters.tag : "";

    const customLists = state.todoLists.filter((list) => list.kind === "custom");
    $("#todo-custom-lists").innerHTML = customLists.length
      ? customLists.map((list) => `<div class="todo-list-line"><button class="todo-view-button ${state.todoView === `list:${list.id}` ? "active" : ""}" type="button" data-todo-list-view="${list.id}"><span class="todo-list-color" style="--todo-list-color:${escapeHTML(list.color || "#7c4dff")}"></span>${escapeHTML(list.name)}<b>${openTodos.filter((todo) => todo.list_id === list.id).length}</b></button><button class="todo-list-delete" type="button" data-todo-list-delete="${list.id}" aria-label="删除分类 ${escapeHTML(list.name)}" title="删除分类">×</button></div>`).join("")
      : '<p class="todo-no-lists">还没有自定义分类</p>';

    const container = $("#todo-items");
    if (!items.length) {
      container.className = "todo-items empty-state";
      container.textContent = state.todoView === "today" ? "今天还没有安排待办。从下面的建议中挑一两件开始吧。" : "这里暂时没有待办事项。";
    } else {
      container.className = "todo-items";
      container.innerHTML = items.map(renderTodoItem).join("");
    }

    const suggestions = openTodos.filter((todo) => todo.my_day_date !== today && (todo.priority === "high" || (todo.due_at && localDateKey(new Date(todo.due_at)) <= localDateKey(new Date(Date.now() + 7 * 86400000))))).slice(0, 4);
    const suggestionSection = $("#todo-suggestions");
    suggestionSection.classList.toggle("hidden", state.todoView !== "today" || !suggestions.length);
    $("#todo-suggestion-items").innerHTML = suggestions.map((todo) => `<div class="todo-suggestion"><div><strong>${escapeHTML(todo.title)}</strong><span>${todo.due_at ? `截止 ${formatDate(todo.due_at)}` : "待安排"}</span></div><button class="quiet" type="button" data-todo-my-day="add" data-id="${todo.id}">加入今天</button></div>`).join("");
  }

  function renderTodoItem(todo) {
    const list = todoListFor(todo);
    const steps = todo.steps || [];
    const completedSteps = steps.filter((step) => step.completed).length;
    const completed = todo.status === "completed";
    const due = todo.due_at ? `<span class="todo-due ${deadlineStatus(todo.due_at).startsWith("已逾期") ? "overdue" : ""}">◷ ${deadlineStatus(todo.due_at)}</span>` : "";
    const meta = [todo.import_receipt_id ? `<span>本机收集</span>` : "", due, todoRepeatLabel(todo.repeat_rule) ? `<span>↻ ${todoRepeatLabel(todo.repeat_rule)}</span>` : "", list ? `<span><i class="todo-list-color" style="--todo-list-color:${escapeHTML(list.color || "#5b81ff")}"></i>${escapeHTML(list.name)}</span>` : ""].filter(Boolean).join("");
    return `<article class="todo-item ${completed ? "completed" : ""}"><button class="todo-complete" type="button" data-todo-completed="${!completed}" data-id="${todo.id}" aria-label="${completed ? "重新打开" : "完成"}待办 ${escapeHTML(todo.title)}">${completed ? "✓" : ""}</button><div class="todo-item-body"><div class="todo-item-title"><h4>${escapeHTML(todo.title)}</h4><span class="priority-${todo.priority}">● ${priorityLabel(todo.priority)}</span></div>${todo.notes ? `<p>${escapeHTML(todo.notes)}</p>` : ""}${meta ? `<div class="todo-meta">${meta}</div>` : ""}${(todo.tags || []).map((tag) => `<span class="tag">#${escapeHTML(tag)}</span>`).join("")}${steps.length ? `<div class="todo-steps"><span>${completedSteps}/${steps.length} 个步骤</span>${steps.map((step) => `<button class="todo-step ${step.completed ? "done" : ""}" type="button" data-todo-step="${todo.id}" data-step-id="${step.id}" data-step-completed="${!step.completed}"><i>${step.completed ? "✓" : ""}</i>${escapeHTML(step.title)}</button>`).join("")}</div>` : ""}</div><div class="todo-item-actions"><button type="button" data-todo-edit="${todo.id}">编辑</button><button class="action-todo-link" type="button" data-action-todo-context="${todo.id}">${todo.memo_action_id ? "来源与专注" : "专注记录"} ↗</button>${!completed ? `<button class="text-button" type="button" data-todo-my-day="${todo.my_day_date === localDateKey(new Date()) ? "remove" : "add"}" data-id="${todo.id}">${todo.my_day_date === localDateKey(new Date()) ? "移出今天" : "加入今天"}</button>` : ""}<button class="todo-delete" type="button" data-todo-delete="${todo.id}" aria-label="删除待办 ${escapeHTML(todo.title)}" title="删除待办">×</button></div></article>`;
  }

  let vocabularyVersion = 0, vocabularyLibraryVersion = 0;
  const vocabularyStageLabel = (stage) => ({
    new: "新词",
    learning: "学习中",
    reviewing: "复习中",
    mastered: "已掌握",
  }[stage] || stage);

  function currentVocabularyWord() {
    return state.vocabularyQueue[0] || null;
  }

  function renderVocabulary() {
    renderVocabularyCatalogs();
    const overview = state.vocabularyOverview || {};
    const currentBook = state.wordBooks.find((book) => book.id === state.vocabularyBookID);
    const word = currentVocabularyWord();
    $("#vocab-due-count").textContent = state.vocabularyQueue.length;
    $("#vocab-reviewed-count").textContent = overview.reviewed_today ?? 0;
    $("#vocab-accuracy").textContent = overview.reviewed_today ? `${overview.accuracy_today ?? 0}%` : "—";
    $("#vocab-streak").textContent = `${overview.study_streak ?? 0} 天`;
    $("#vocab-study-book").textContent = currentBook?.name || "开始今日学习";
    const blocked = state.vocabularyLoading || state.vocabularyReviewing || Boolean(state.vocabularyInstalling) || state.vocabularyError;
    $("#vocab-queue-progress").textContent = word ? `本批剩余 ${state.vocabularyQueue.length}` : "暂无待学";
    $("#vocab-plan-summary").textContent = currentBook ? `每日最多 ${currentBook.daily_new_limit} 个新词 · 到期旧词优先 · 全书 ${overview.total || 0} 词` : "先安装词书，再开始每日学习。";
    $("#vocab-status").textContent = state.vocabularyLoading ? "正在加载词书…" : state.vocabularyReviewing ? "正在保存学习反馈…" : state.vocabularyInstalling ? "正在安装词书，请稍候…" : state.vocabularyError ? "学习数据未更新，请点击刷新学习；本页保留上次数据。" : "先回忆，再看释义，最后选择熟悉程度。";
    $("#vocab-status").classList.toggle("vocab-error",state.vocabularyError);
    $("#vocab-refresh").disabled = state.vocabularyLoading || state.vocabularyReviewing || Boolean(state.vocabularyInstalling);
    $("#vocab-reveal").disabled = blocked;
    $("#vocab-rating-actions").querySelectorAll("button").forEach(button=>{button.disabled=blocked;});
    $$("[data-vocab-mode]").forEach(button=>{button.disabled=blocked;button.setAttribute("aria-pressed",String(button.dataset.vocabMode===state.vocabularyMode));});
    $("#vocab-empty-title").textContent = state.vocabularyLoading ? "正在准备学习…" : state.vocabularyError ? "暂时无法加载学习内容" : !currentBook || !overview.total ? "先选一本有内容的词书" : "当前没有到期待学单词";
    $("#vocab-empty-description").textContent = state.vocabularyError ? "请刷新重试，不会清除已有学习记录。" : !currentBook || !overview.total ? "打开词书书架，安装雅思或托福词书即可开始。" : "可能已达到每日新词限额，或旧词尚未到复习时间；稍后刷新，或切换其他词书。";
    if (!currentBook && !state.vocabularyError) $("#vocab-catalog-drawer").open = true;

    $("#vocab-books").innerHTML = state.wordBooks.map((book) => {
      const count = book.id === state.vocabularyBookID ? `${overview.total || 0} 词` : `每日 ${book.daily_new_limit} 新词`;
      return `<button class="vocab-book-button ${book.id === state.vocabularyBookID ? "active" : ""}" type="button" data-vocab-book="${book.id}" aria-pressed="${book.id === state.vocabularyBookID}" ${state.vocabularyReviewing || state.vocabularyInstalling ? "disabled" : ""}><span><strong>${escapeHTML(book.name)}</strong><small>${escapeHTML(book.description || book.language?.toUpperCase() || "词书")}</small></span><b>${count}</b></button>`;
    }).join("");

    $$('[data-vocab-mode]').forEach((button) => button.classList.toggle("active", button.dataset.vocabMode === state.vocabularyMode));
    $("#vocab-empty").classList.toggle("hidden", Boolean(word));
    $("#vocab-study").classList.toggle("hidden", !word);
    $("#vocab-flashcard-mode").classList.toggle("hidden", state.vocabularyMode !== "flashcard");
    $("#vocab-spelling-mode").classList.toggle("hidden", state.vocabularyMode !== "spelling");

    const displayKey = word ? word.id + ":" + state.vocabularyMode : "";
    if (state.vocabularyDisplayKey !== displayKey) {
      state.vocabularyDisplayKey = displayKey; state.vocabularyRevealed = false;
      $("#vocab-spelling-input").value = ""; $("#vocab-spelling-result").textContent = ""; $("#vocab-spelling-result").className = "vocab-spelling-result";
    }
    if (word) {
      $("#vocab-stage").textContent = vocabularyStageLabel(word.stage);
      $("#vocab-stage").className = `vocab-stage ${word.stage}`;
      $("#vocab-term").textContent = word.term;
      $("#vocab-phonetic").textContent = word.phonetic || "";
      $("#vocab-spelling-definition").textContent = word.definition;
      $("#vocab-definition").textContent = word.definition;
      $("#vocab-example").textContent = word.example || "";
      $("#vocab-example").classList.toggle("hidden", !word.example);
      $("#vocab-example-translation").textContent = word.example_translation || "";
      $("#vocab-example-translation").classList.toggle("hidden", !word.example_translation);
      $("#vocab-answer").classList.toggle("hidden", !state.vocabularyRevealed);
      $("#vocab-reveal").classList.toggle("hidden", state.vocabularyRevealed);
      $("#vocab-spelling-input").disabled = state.vocabularyRevealed || blocked;
      $("#vocab-spelling-mode").querySelector("button").disabled = state.vocabularyRevealed || blocked;
    }

    const words = state.vocabularyWords;
    const library = $("#vocab-word-list");
    if (!words.length) {
      library.className = "vocab-word-list empty-state";
      library.textContent = state.vocabularySearch || state.vocabularyStage ? "没有匹配的单词，试试其他关键词或学习阶段。" : "本书还没有单词，可从词书书架安装词书。";
    } else {
      library.className = "vocab-word-list";
      library.innerHTML = words.map((item) => `<article class="vocab-word-row"><div class="vocab-word-main"><div><h4>${escapeHTML(item.term)}</h4>${item.phonetic ? `<span>${escapeHTML(item.phonetic)}</span>` : ""}</div><p>${escapeHTML(item.definition)}</p>${(item.tags || []).map((tag) => `<span class="tag">#${escapeHTML(tag)}</span>`).join("")}</div><div class="vocab-word-meta"><span class="vocab-stage ${item.stage}">${vocabularyStageLabel(item.stage)}</span><small>${item.stage === "new" ? `创建于 ${formatDate(item.created_at)}` : `下次 ${formatDate(item.due_at, true)}`}</small></div></article>`).join("");
    }
    const totalPages = Number(state.vocabularyMeta.total_pages || 1);
    $("#vocab-library-total").textContent = `${Number(state.vocabularyMeta.total || 0).toLocaleString()} 个匹配单词`;
    $("#vocab-pagination").classList.toggle("hidden", totalPages <= 1);
    $("#vocab-page-label").textContent = `第 ${state.vocabularyPage} / ${totalPages} 页`;
    $("#vocab-page-prev").disabled = state.vocabularyPage <= 1;
    $("#vocab-page-next").disabled = state.vocabularyPage >= totalPages;
  }

  function renderVocabularyCatalogs() {
    const container = $("#vocab-catalogs");
    if (!container) return;
    if (!state.vocabularyCatalogs.length) {
      container.innerHTML = '<div class="empty-state">内置词书暂时不可用。</div>';
      return;
    }
    container.innerHTML = state.vocabularyCatalogs.map((catalog) => {
      const complete = catalog.installed && catalog.installed_word_count >= catalog.word_count;
      const progress = catalog.word_count ? Math.min(100, Number(catalog.installed_word_count || 0) / catalog.word_count * 100) : 0;
      return `<article class="vocab-catalog ${catalog.installed ? "installed" : ""}"><div class="vocab-catalog-badge">${escapeHTML(catalog.exam)}</div><div class="vocab-catalog-main"><div><h4>${escapeHTML(catalog.name)}</h4><span>${catalog.word_count.toLocaleString()} 词 · ${escapeHTML(catalog.license)} 许可</span></div><p>${escapeHTML(catalog.description)}</p><div class="vocab-catalog-track"><span style="width:${progress}%"></span></div><small>${catalog.installed ? `已安装 ${catalog.installed_word_count.toLocaleString()} / ${catalog.word_count.toLocaleString()} 词` : `来源 ${escapeHTML(catalog.source_name)} · 可离线学习`}</small></div><button class="${complete ? "quiet" : "primary"}" type="button" data-vocab-catalog="${catalog.id}" ${state.vocabularyInstalling || state.vocabularyReviewing || state.vocabularyLoading ? "disabled" : ""}>${state.vocabularyInstalling === catalog.id ? "正在安装…" : complete ? "开始学习" : catalog.installed ? "补全词书" : "安装词书"}</button></article>`;
    }).join("");
  }

  async function importVocabularyCatalog(catalogID, button) {
    const catalog = state.vocabularyCatalogs.find(item=>item.id===catalogID);
    if (!catalog || button.disabled || state.vocabularyInstalling || state.vocabularyReviewing) return;
    if (catalog.installed && catalog.installed_word_count >= catalog.word_count) {
      await selectVocabularyBook(catalog.installed_book_id);
      $("#vocab-catalog-drawer").open = false;
      return;
    }
    const token = state.token;
    state.vocabularyInstalling = catalogID; vocabularyVersion++; renderVocabulary();
    try {
      const result = await api(`/api/v1/vocabulary/catalogs/${encodeURIComponent(catalogID)}/import`,{method:"POST",body:JSON.stringify({daily_new_limit:20})});
      if (token !== state.token) return;
      state.wordBooks = state.wordBooks.filter(book=>book.id!==result.book.id).concat(result.book);
      state.vocabularyBookID = result.book.id; state.vocabularyPage=1; state.vocabularySearch="";state.vocabularyStage="";
      try { localStorage.setItem(`studyflow.vocabularyBook.${state.user.id}`, result.book.id); } catch (_) {}
      $("#vocab-search").value="";$("#vocab-stage-filter").value="";
      const installed = state.vocabularyCatalogs.find(item=>item.id===catalogID);
      if (installed) Object.assign(installed,{installed:true,installed_book_id:result.book.id,installed_word_count:result.added+result.skipped});
      state.vocabularyInstalling = "";
      await refreshVocabulary();
      $("#vocab-catalog-drawer").open = false;
      notify(`${result.book.name} 已安装，可以开始学习。`);
    } catch(error) { if(token===state.token) notify(error.message,"error"); }
    finally { if(token===state.token){state.vocabularyInstalling="";renderVocabulary();} }
  }

  async function refreshVocabulary({ libraryOnly = false } = {}) {
    if (!state.vocabularyBookID) { renderVocabulary(); return; }
    const owner=state.token,bookID=state.vocabularyBookID,version=libraryOnly?vocabularyVersion:++vocabularyVersion,libraryVersion=++vocabularyLibraryVersion;
    const wordQuery=new URLSearchParams({book_id:bookID,page:String(state.vocabularyPage),page_size:String(state.vocabularyPageSize)});
    if(state.vocabularySearch)wordQuery.set("q",state.vocabularySearch);
    if(state.vocabularyStage)wordQuery.set("stage",state.vocabularyStage);
    if(!libraryOnly){state.vocabularyLoading=true;renderVocabulary();}
    try{
      const wordRequest=api(`/api/v1/words?${wordQuery}`,{returnEnvelope:true});
      const [wordPage,queue,overview]=await Promise.all(libraryOnly?[wordRequest]:[wordRequest,api(`/api/v1/words/queue?book_id=${encodeURIComponent(bookID)}&limit=100`),api(`/api/v1/vocabulary/overview?book_id=${encodeURIComponent(bookID)}`)]);
      if(owner!==state.token||bookID!==state.vocabularyBookID||version!==vocabularyVersion)return;
      if(libraryVersion===vocabularyLibraryVersion){state.vocabularyWords=wordPage.data||[];state.vocabularyMeta=wordPage.meta||{total:0,page:1,total_pages:1};}
      if(!libraryOnly){state.vocabularyQueue=queue||[];state.vocabularyOverview=overview||null;state.vocabularyError=false;}
      renderVocabulary();
    }catch(error){if(owner===state.token&&bookID===state.vocabularyBookID&&version===vocabularyVersion){if(!libraryOnly)state.vocabularyError=true;throw error;}}
    finally{if(!libraryOnly&&owner===state.token&&version===vocabularyVersion){state.vocabularyLoading=false;renderVocabulary();}}
  }

  async function selectVocabularyBook(bookID) {
    if (!bookID || state.vocabularyReviewing || state.vocabularyInstalling) return;
    window.clearTimeout(state.vocabularySearchTimer);
    state.vocabularyQueue=[];state.vocabularyWords=[];state.vocabularyOverview=null;state.vocabularyRevealed=false;
    state.vocabularyBookID = bookID;
    try { localStorage.setItem(`studyflow.vocabularyBook.${state.user.id}`, bookID); } catch (_) {}
    state.vocabularyPage = 1;
    state.vocabularySearch = "";
    state.vocabularyStage = "";
    $("#vocab-search").value = "";
    $("#vocab-stage-filter").value = "";
    try {
      await refreshVocabulary();
      renderSelects();
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function speakVocabularyWord() {
    const word = currentVocabularyWord();
    if (!word) return;
    if (!("speechSynthesis" in window)) {
      notify("当前浏览器不支持语音朗读。", "error");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.term);
    const language = state.wordBooks.find((book) => book.id === word.book_id)?.language || "en";
    utterance.lang = language === "en" ? "en-US" : language;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  async function reviewVocabularyWord(rating) {
    const word=currentVocabularyWord(),owner=state.token;
    if(!word||!state.vocabularyRevealed||state.vocabularyReviewing||state.vocabularyLoading||state.vocabularyInstalling||state.vocabularyError)return;
    state.vocabularyReviewing=true;vocabularyVersion++;renderVocabulary();
    let saved=false;
    try{
      await api(`/api/v1/words/${word.id}/reviews`,{method:"POST",body:JSON.stringify({rating,mode:state.vocabularyMode})});
      if(owner!==state.token)return;
      saved=true;state.vocabularyQueue=state.vocabularyQueue.filter(item=>item.id!==word.id);state.vocabularyRevealed=false;
      await refreshVocabulary();
    }catch(error){if(owner===state.token){state.vocabularyError=true;notify(saved?"反馈已保存，但下一词加载失败，请刷新学习。":error.message+" 请先刷新学习确认记录，再继续评分。","error");}}
    finally{if(owner===state.token){state.vocabularyReviewing=false;renderVocabulary();}}
  }

  function renderFocus() {
    const active = state.focus;
    const form = $("#focus-form");
    const paused = active?.status === "paused";
    const updating = state.isFinishingFocus || state.isUpdatingFocus || state.isStartingFocus;
    const stateLabel = $("#focus-state");
    $("#pause-focus").classList.toggle("hidden", !active || paused);
    $("#resume-focus").classList.toggle("hidden", !active || !paused);
    $("#finish-focus").classList.toggle("hidden", !active);
    $("#abandon-focus").classList.toggle("hidden", !active);
    $("#pause-focus").disabled = updating;
    $("#resume-focus").disabled = updating;
    $("#finish-focus").disabled = updating;
    $("#abandon-focus").disabled = updating;
    $("#start-focus").disabled = Boolean(active) || updating;
    $("#start-focus").classList.toggle("hidden", Boolean(active));
    $("#start-focus").textContent = state.isStartingFocus ? "正在开启…" : "▶ 开始专注";
    $("#focus-setup-start").disabled = Boolean(active) || updating;
    $("#focus-setup-start").classList.toggle("hidden", Boolean(active));
    $("#focus-setup-start").textContent = state.isStartingFocus ? "正在开启…" : "开始这段专注 ↗";
    $("#focus-form").setAttribute("aria-busy", String(updating));
    form.querySelectorAll("input,select").forEach((field) => { field.disabled = Boolean(active) || updating; });
    $$("[data-focus-duration]").forEach((button) => { button.disabled = Boolean(active) || updating; });
    $("#focus-quiet-toggle").disabled = !active;
    $("#focus-quiet-toggle").title = active ? "收起设置与统计，按 Esc 返回完整布局" : "开始专注后可进入简洁模式";
    $("#panel-focus").dataset.focusState = paused ? "paused" : active?.phase === "break" ? "break" : active ? "running" : "idle";
    if (active) {
      $("#focus-minutes").value = active.plannedMinutes;
      $("#focus-break-enabled").checked = active.breakEnabled;
      $("#focus-task").value = active.todoID ? `todo:${active.todoID}` : active.taskID || "";
    } else {
      setFocusQuiet(false);
    }
    const selectedValue = $("#focus-task").value;
    const hasTask = Boolean(active?.taskID || selectedValue);
    $("#focus-clear-task").disabled = Boolean(active) || updating || !hasTask;
    $("#focus-setup-state").textContent = active ? "本次已锁定" : state.isStartingFocus ? "正在开启" : "自由安排";
    $("#focus-keyboard-hint").textContent = active ? "时钟获得焦点后，按空格暂停 / 继续" : "可直接开始，也可以先在设置中挑选节奏";
    renderFocusFeedback();
    renderFocusPlan();
    renderFocusTransitionNotice();
    renderFocusProgress();
    renderFocusTaskPreview();
    if (!active) {
      renderReadyCountdown();
      $("#focus-session-step").textContent = "准备开始";
      stateLabel.textContent = "尚未开始专注";
      stateLabel.className = "focus-state is-idle";
      const selectedTask = state.todos.find(item=>`todo:${item.id}`===selectedValue);
      $("#focus-description").textContent = selectedTask ? `即将专注：${selectedTask.title}` : "可以关联待办，也可以开始自由专注。";
      return;
    }
    const task = active.todoID ? state.todos.find(item=>item.id===active.todoID) || {title:active.titleSnapshot || "原待办已删除"} : active.taskID || active.planBlockID ? {title:active.titleSnapshot || "原学习安排"} : null;
    $("#focus-session-step").textContent = focusSessionStep(active);
    stateLabel.textContent = paused ? `${focusPhaseLabel(active.phase)} · 已暂停` : focusPhaseLabel(active.phase);
    stateLabel.className = `focus-state ${paused ? "is-paused" : active.phase === "break" ? "is-break" : "is-running"}`;
    const taskDescription = task ? `当前任务：${task.title}` : "正在进行一段不关联任务的专注时间。";
    $("#focus-description").textContent = active.phase === "break" ? "休息 5 分钟，放松一下再继续。" : taskDescription;
    updateFocusClock();
  }

  function renderReadyCountdown() {
    const plannedMinutes = clampPlannedMinutes($("#focus-minutes").value);
    const first = focusPlanSegments(plannedMinutes, $("#focus-break-enabled").checked)[0];
    const display = formatDuration(first.seconds);
    if ($("#focus-clock").textContent !== display) $("#focus-clock").textContent = display;
    $("#focus-timer").style.setProperty("--progress", "0%");
    renderFocusTicks(0);
    renderFocusEndTime();
  }

  function renderFocusFeedback() {
    const message = state.isStartingFocus ? "正在开启专注，请稍候…" : state.isFinishingFocus ? "正在保存本次会话…" : state.isUpdatingFocus ? "正在同步计时状态…" : state.focusMessage;
    const node = $("#focus-action-status");
    node.classList.toggle("hidden", !message);
    node.classList.toggle("is-error", Boolean(state.focusMessageError && !state.isStartingFocus && !state.isUpdatingFocus && !state.isFinishingFocus));
    if (node.textContent !== message) node.textContent = message;
  }

  function setFocusFeedback(message = "", isError = false) {
    state.focusMessage = message;
    state.focusMessageError = isError;
    renderFocusFeedback();
  }

  function renderFocusEndTime() {
    const active = state.focus;
    const label = $("#focus-end-label"), output = $("#focus-end-time");
    let text, end = null;
    if (active?.status === "paused") {
      label.textContent = "预计结束（本机时间）";
      text = "继续后更新";
    } else if (active?.transitionError) {
      label.textContent = "预计结束（本机时间）";
      text = "等待同步";
    } else {
      const minutes = active?.plannedMinutes ?? clampPlannedMinutes($("#focus-minutes").value);
      const segments = focusPlanSegments(minutes, active ? active.breakEnabled : $("#focus-break-enabled").checked, active?.breakMinutes ?? 5);
      const index = active ? segments.findIndex(s => s.phase === active.phase) : -1;
      const remaining = active ? phaseRemainingSeconds(active) + segments.slice(index + 1).reduce((sum, s) => sum + s.seconds, 0) : segments.reduce((sum, s) => sum + s.seconds, 0);
      // Running sessions use the precise phase deadline, so the estimate doesn't jump a minute every tick.
      const phaseEnd = active ? new Date(active.phaseStartedAt).getTime() + active.phaseRemainingSeconds * 1000 : 0;
      const total = active && Number.isFinite(phaseEnd) ? Math.max(Date.now(), phaseEnd) + segments.slice(index + 1).reduce((sum, s) => sum + s.seconds, 0) * 1000 : Date.now() + remaining * 1000;
      end = new Date(total);
      const now = new Date(Date.now());
      text = (end.toDateString() !== now.toDateString() ? "明天 " : "") + end.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      label.textContent = active ? "预计结束（本机时间）" : "现在开始，预计结束";
    }
    if (output.textContent !== text) output.textContent = text;
    output.setAttribute("datetime", end ? end.toISOString() : "");
  }

  function adjustFocusDuration(delta) {
    if (state.focus || state.isStartingFocus || state.isUpdatingFocus || state.isFinishingFocus) return;
    $("#focus-minutes").value = clampPlannedMinutes(clampPlannedMinutes($("#focus-minutes").value) + delta);
    renderReadyCountdown();
    renderFocusPlan();
  }

  function handleFocusClockKey(event) {
    if (event.key !== " " || event.target !== $("#focus-timer") || state.currentView !== "focus" || !state.focus || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (event.repeat || state.isUpdatingFocus || state.isFinishingFocus || state.focus.transitionError) return;
    return state.focus.status === "paused" ? resumeFocus() : pauseFocus();
  }

  function handoffFocusControl(previous, selector) {
    if (previous && state.currentView === "focus" && (document.activeElement === previous || document.activeElement === document.body)) $(selector).focus({ preventScroll: true });
  }

  function focusPlanSegments(minutes, breakEnabled, breakMinutes = 5) {
    const seconds = clampPlannedMinutes(minutes) * 60;
    return breakEnabled ? [
      { phase: "focus_first", label: "第一段专注", seconds: Math.ceil(seconds / 2) },
      { phase: "break", label: "中途休息", seconds: breakMinutes * 60 },
      { phase: "focus_second", label: "第二段专注", seconds: Math.floor(seconds / 2) },
    ] : [{ phase: "focus", label: "完整专注", seconds }];
  }

  function renderFocusPlan() {
    const active = state.focus;
    const minutes = active ? active.plannedMinutes : clampPlannedMinutes($("#focus-minutes").value);
    const breakEnabled = active ? active.breakEnabled : $("#focus-break-enabled").checked;
    const segments = focusPlanSegments(minutes, breakEnabled, active?.breakMinutes ?? 5);
    const current = active ? segments.findIndex((segment) => segment.phase === active.phase) : -1;
    const duration = (seconds) => `${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : "钟"}`;
    $("#focus-phase-track").innerHTML = segments.map((segment, index) => `<li class="${index === current ? "is-current" : current > index ? "is-done" : ""}" ${index === current ? 'aria-current="step"' : ""}><strong>${segment.label}</strong><span>${duration(segment.seconds)}${index === current && active?.status === "paused" ? " · 已暂停" : ""}</span></li>`).join("");
    $("#focus-plan-summary").textContent = `${minutes} 分钟专注${breakEnabled ? ` + ${segments[1].seconds / 60} 分钟休息` : " · 不间断时段"}`;
    $("#focus-setup-hint").textContent = active ? "本次设置已锁定，结束后可安排下一次专注。" : "调整好节奏，在时钟下点击开始。";
    $$("[data-focus-duration]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.focusDuration) === minutes)));
    const locked = Boolean(active || state.isStartingFocus || state.isUpdatingFocus || state.isFinishingFocus);
    $("#focus-duration-less").disabled = locked || minutes <= 1;
    $("#focus-duration-more").disabled = locked || minutes >= 240;
    renderFocusEndTime();
  }

  function setFocusQuiet(enabled) {
    const quiet = Boolean(enabled && state.focus);
    const panel = $("#panel-focus");
    const wasQuiet = panel.classList.contains("is-quiet");
    panel.classList.toggle("is-quiet", quiet);
    const button = $("#focus-quiet-toggle");
    button.setAttribute("aria-pressed", String(quiet));
    button.textContent = quiet ? "退出简洁 · Esc" : "简洁模式";
    if (wasQuiet && !quiet && state.currentView === "focus") {
      (state.focus ? button : $("#start-focus")).focus();
    }
  }

  function renderFocusTransitionNotice() {
    const message = state.focus?.transitionError || "";
    $("#focus-transition-notice").classList.toggle("hidden", !message);
    $("#focus-transition-message").textContent = message ? `阶段已到时，尚未成功同步：${message}` : "";
    $("#focus-retry-transition").disabled = state.isUpdatingFocus || state.isFinishingFocus;
  }

  async function retryFocusTransition() {
    if (!state.focus?.transitionError || state.isUpdatingFocus || state.isFinishingFocus) return;
    const previous = state.focus;
    let retry = false;
    state.isUpdatingFocus = true;
    renderFocus();
    try {
      // The server may have applied the previous request even if its response was lost.
      // Reconcile before replaying so retry never skips a phase or re-finishes a session.
      const session = await api("/api/v1/focus-sessions/active");
      if (state.focus?.id !== previous.id) return;
      syncActiveFocus(session);
      retry = state.focus?.id === previous.id && state.focus.phase === previous.phase
        && state.focus.status === "running" && phaseRemainingSeconds(state.focus) === 0;
      if (retry) state.focus.autoFinishAttempted = true;
      if (!session) await refresh();
    } catch (error) {
      if (state.focus?.id === previous.id) state.focus.transitionError = error.message;
      notify(error.message, "error");
    } finally {
      state.isUpdatingFocus = false;
      renderFocus();
    }
    if (!retry || state.focus?.id !== previous.id) return;
    if (state.focus.phase === "focus_first" || state.focus.phase === "break") await advanceFocus(true);
    else await finishFocus(false, true);
  }

  function updateFocusClock() {
    if (!state.focus) {
      if (state.user) renderReadyCountdown();
      return;
    }
    const totalSeconds = phaseTotalSeconds(state.focus);
    const remainingSeconds = phaseRemainingSeconds(state.focus);
    const progress = Math.min(100, ((totalSeconds - remainingSeconds) / totalSeconds) * 100);
    const display = formatDuration(remainingSeconds);
    if ($("#focus-clock").textContent !== display) $("#focus-clock").textContent = display;
    $("#focus-timer").style.setProperty("--progress", `${progress}%`);
    renderFocusTicks(progress);
    renderFocusEndTime();
    if (remainingSeconds === 0 && state.focus.status === "running" && !state.isFinishingFocus && !state.isUpdatingFocus && !state.focus.autoFinishAttempted) {
      state.focus.autoFinishAttempted = true;
      persistFocus();
      if (state.focus.phase === "focus_first" || state.focus.phase === "break") {
        advanceFocus(true);
      } else {
        finishFocus(false, true);
      }
    }
  }

  function phaseRemainingSeconds(focus) {
    if (focus.status !== "running") return Math.max(0, focus.phaseRemainingSeconds);
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(focus.phaseStartedAt).getTime()) / 1000));
    return Math.max(0, focus.phaseRemainingSeconds - elapsed);
  }

  function phaseTotalSeconds(focus) {
    const total = focus.plannedMinutes * 60;
    if (focus.phase === "focus_first") return Math.ceil(total / 2);
    if (focus.phase === "focus_second") return Math.floor(total / 2);
    if (focus.phase === "break") return focus.breakMinutes * 60;
    return total;
  }

  function focusPhaseLabel(phase) {
    return ({ focus: "正在专注", focus_first: "第一段专注", break: "休息时间", focus_second: "第二段专注" }[phase] || "专注会话");
  }

  function focusSessionStep(focus) {
    if (!focus.breakEnabled) return "完整专注时段";
    return ({ focus_first: "专注 1 / 2", break: "中场休息", focus_second: "专注 2 / 2" }[focus.phase] || "专注时段");
  }

  function renderFocusTicks(progress) {
    const container = $(".focus-timer-ticks");
    if (!container) return;
    const tickCount = 24;
    if (container.childElementCount !== tickCount) {
      container.innerHTML = Array.from({ length: tickCount }, (_, index) => `<span class="focus-tick ${index % 4 === 0 ? "is-major" : ""}" data-focus-tick style="--tick-index:${index}"></span>`).join("");
    }
    const completed = Math.floor((Math.max(0, Math.min(100, progress)) / 100) * tickCount);
    container.querySelectorAll("[data-focus-tick]").forEach((tick, index) => {
      tick.classList.toggle("is-complete", index < completed);
      tick.classList.toggle("is-current", progress > 0 && index === completed && completed < tickCount);
    });
  }

  function renderFocusProgress() {
    const data = state.dashboard || {};
    const today = Number(data.focus_minutes_today || 0);
    const week = Number(data.focus_minutes_week || 0);
    const goal = state.dailyFocusGoalMinutes;
    const progress = Math.min(100, Math.round((today / goal) * 100));
    $("#focus-today-minutes").textContent = today;
    $("#focus-week-minutes").textContent = week;
    $("#focus-daily-ring").style.setProperty("--daily-progress", `${progress}%`);
    $("#focus-daily-goal-value").textContent = goal % 60 === 0 ? goal / 60 : goal;
    $("#focus-daily-goal-unit").textContent = goal % 60 === 0 ? "小时" : "分钟";
    $("#focus-progress-caption").textContent = today > 0
      ? `今日已完成 ${today} 分钟，达成每日目标的 ${progress}%。`
      : `每日目标 ${goal} 分钟，先开始一个小节奏。`;
    const goalForm = $("#daily-goal-form");
    if (goalForm.classList.contains("hidden")) $("#daily-goal-minutes").value = goal;
  }

  function renderFocusTaskPreview() {
    const container = $("#focus-task-preview");
    if (!container) return;
    const selectedTaskID = state.focus?.todoID ? `todo:${state.focus.todoID}` : state.focus?.taskID || $("#focus-task")?.value;
    const available = state.todos.filter(todo=>todo.status==="open").map(todo=>({...todo,id:`todo:${todo.id}`}));
    // Keep a task chosen from the full select visible even when it is outside the first five.
    const selected = available.find((task) => task.id === selectedTaskID);
    const tasks = (selected ? [selected, ...available.filter((task) => task.id !== selected.id)] : available).slice(0, 5);
    if (!tasks.length) {
      container.className = "focus-task-preview empty-state";
      container.textContent = "暂时没有待专注的任务。不必先做计划，也可以直接开始一段自由专注。";
      return;
    }
    container.className = "focus-task-preview";
    container.innerHTML = tasks.map((task) => `<button class="focus-task-item ${task.id === selectedTaskID ? "selected" : ""}" type="button" data-focus-task-select="${task.id}" aria-pressed="${task.id === selectedTaskID}" ${state.focus || state.isStartingFocus ? "disabled" : ""}><span class="focus-task-check" aria-hidden="true"></span><span class="focus-task-content"><strong>${escapeHTML(task.title)}</strong><small>${task.estimated_minutes ? `预计 ${task.estimated_minutes} 分钟` : "未设置预计时长"}</small></span><span class="priority-${task.priority}" aria-hidden="true">●</span></button>`).join("");
  }

  function clampDailyFocusGoal(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(720, Math.max(10, Math.round(parsed / 5) * 5)) : 60;
  }

  function clampPlannedMinutes(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(240, Math.max(1, Math.round(parsed))) : 25;
  }

  function formatDuration(seconds) {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const rest = String(seconds % 60).padStart(2, "0");
    return `${minutes}:${rest}`;
  }

  function renderSelects() {
    const focusTask = $("#focus-task");
    const previousTask = state.focus?.todoID ? `todo:${state.focus.todoID}` : state.focus?.taskID || focusTask.value;
    const availableTodos=state.todos.filter(todo=>todo.status==="open" || todo.id===state.focus?.todoID);
    let todoOptions=availableTodos.map(todo=>`<option value="todo:${escapeHTML(todo.id)}">${escapeHTML(todo.title)}</option>`).join("");
    if(state.focus?.todoID&&!availableTodos.some(todo=>todo.id===state.focus.todoID))todoOptions+=`<option value="todo:${escapeHTML(state.focus.todoID)}">${escapeHTML(state.focus.titleSnapshot||"原待办已删除")}</option>`;
    const legacy = state.focus?.taskID && !state.focus.todoID
      ? `<option value="${escapeHTML(state.focus.taskID)}">${escapeHTML(state.focus.titleSnapshot || "原学习任务")}</option>` : "";
    focusTask.innerHTML = `<option value="">自由专注</option>${legacy}${todoOptions}`;
    focusTask.value = [...focusTask.options].some(option=>option.value===previousTask) ? previousTask : "";

    const todoList = $("#todo-list");
    todoList.disabled = state.todoLists.length === 0;
    const previousTodoList = todoList.value;
    todoList.innerHTML = state.todoLists.map((list) => `<option value="${list.id}">${escapeHTML(list.name)}${list.kind === "inbox" ? "（收集箱）" : ""}</option>`).join("");
    todoList.value = state.todoLists.some((list) => list.id === previousTodoList) ? previousTodoList : (state.todoLists[0]?.id || "");
  }

  const priorityLabel = (priority) => ({ high: "高", medium: "中", low: "低" }[priority] || priority);

  const savingForms = new Set();
  async function submitForm(event, action, success, { sync = refresh } = {}) {
    event.preventDefault();
    const form = event.currentTarget;
    if (savingForms.has(form) || form.reportValidity?.() === false) return;
    const button = form.querySelector("button[type=submit]");
    const owner = state.token;
    const snapshot = () => JSON.stringify([...form.elements].map(field => [field.id, field.value, field.checked]));
    const before = snapshot();
    savingForms.add(form);
    if (button) button.disabled = true;
    try {
      await action();
      if (state.token !== owner) return;
      const changed = snapshot() !== before;
      if (!changed) form.reset();
      try { await sync(); }
      catch (_) { if (state.token === owner) notify(`${success} 页面同步暂未完成，请刷新核对。`, "error"); return; }
      if (state.token === owner) notify(changed ? `${success} 你刚输入的新内容已保留。` : success);
    } catch (error) {
      if (state.token === owner) notify(error.message, "error");
    } finally {
      savingForms.delete(form);
      if (button) button.disabled = false;
    }
  }

  function bindEvents() {
    document.addEventListener("daynest:todos-changed",()=>{if(state.user)refresh({background:true}).catch(()=>undefined);});
    document.addEventListener("daynest:todo-imported",event=>{if(state.user?.id===event.detail?.userID&&event.detail.server===(window.DaynestMobile?.getConnectionInfo?.().server||location.origin))refresh({background:true}).catch(()=>undefined);});
    document.addEventListener("daynest:actions-changed",()=>{if(state.user)refresh({background:true}).catch(()=>undefined);});
    document.addEventListener("daynest:todo-focus-recovered",event=>{
      if(!state.user)return;
      if(event.detail?.user_id!==state.user.id)return;
      syncActiveFocus(["running","paused"].includes(event.detail?.status)?event.detail:null);render();
      refresh({background:true}).catch(()=>undefined);
    });
    document.addEventListener("daynest:prepare-todo-focus",event=>{
      const todo=event.detail;if(!state.user||!todo||todo.user_id!==state.user.id)return;
      if(state.focus){showView("focus");notify("已有专注进行中，请先结束当前会话。","error");return;}
      state.todos=[todo,...state.todos.filter(item=>item.id!==todo.id)];renderSelects();
      $("#focus-task").value=`todo:${todo.id}`;showView("focus");renderFocus();
    });
    document.addEventListener("daynest:show-action-todo",event=>{
      const todo=event.detail;if(!state.user||!todo||todo.user_id!==state.user.id)return;
      state.todoView=todo.status==="completed"?"completed":"all";state.todoFilters={query:todo.title,priority:"",tag:""};
      state.todos=[todo,...state.todos.filter(item=>item.id!==todo.id)];renderTodos();
    });
    window.DaynestUI?.registerGuard?.('main', () => savingForms.size || state.moodDraftRevision || state.moodSaving || state.isStartingFocus || state.isUpdatingFocus || state.isFinishingFocus);
    $("#app-sync-retry").addEventListener("click", () => refresh().catch(error => setSyncStatus(error.message,false,true)));
    window.addEventListener("offline", () => { if(state.user) setSyncStatus("网络已断开。页面内容可能不是最新；当前不支持离线保存。",false,true); });
    window.addEventListener("online", () => { if(state.user) refresh().catch(error => setSyncStatus(error.message,false,true)); });
    $$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => authTab(button.dataset.authTab)));
    $("#theme-toggle").addEventListener("click", toggleTheme);
    $("#logout").addEventListener("click", () => { leaveApp(); notify("已退出登录"); });
    $("#mobile-menu").addEventListener("click", () => { if (window.DaynestUI) window.DaynestUI.setMenu(!$(".sidebar").classList.contains("open")); else $(".sidebar").classList.toggle("open"); });
    window.addEventListener("popstate", () => { if (state.user) showView(viewFromURL(), { history: "replace" }); });
    window.addEventListener("hashchange", () => { if (state.user && viewFromURL() !== state.currentView) showView(viewFromURL(), { history: "replace" }); });
    $("#auth-reconnect").addEventListener("click", restoreSession);
    $("#auth-reset").addEventListener("click", () => leaveApp());
    window.addEventListener("storage", handleAccountStorage);
    $$("[data-view]").forEach((button) => button.addEventListener("click", () => {
      showView(button.dataset.view);
      if (button.dataset.view === "dashboard" && state.user) refresh({ background: true }).catch(error => setSyncStatus(error.message, false, true));
    }));
    document.addEventListener("click", async (event) => {
      const goto = event.target.closest("[data-goto]");
      if (goto) {
        event.preventDefault();
        const nav = $$(".nav-link[data-view]").find(button => button.dataset.view === goto.dataset.goto);
        if (nav) nav.click(); else showView(goto.dataset.goto);
      }
      const todoView = event.target.closest("[data-todo-view]");
      if (todoView) {
        state.todoView = todoView.dataset.todoView;
        renderTodos();
      }
      const todoListView = event.target.closest("[data-todo-list-view]");
      if (todoListView) {
        state.todoView = `list:${todoListView.dataset.todoListView}`;
        renderTodos();
      }
      const todoCompletion = event.target.closest("[data-todo-completed]");
      if (todoCompletion) await changeTodoCompletion(todoCompletion.dataset.id, todoCompletion.dataset.todoCompleted === "true");
      const todoMyDay = event.target.closest("[data-todo-my-day]");
      if (todoMyDay) await changeTodoMyDay(todoMyDay.dataset.id, todoMyDay.dataset.todoMyDay);
      const todoStep = event.target.closest("[data-todo-step]");
      if (todoStep) await changeTodoStep(todoStep.dataset.todoStep, todoStep.dataset.stepId, todoStep.dataset.stepCompleted === "true");
      const todoDelete = event.target.closest("[data-todo-delete]");
      if (todoDelete) await deleteTodo(todoDelete.dataset.todoDelete);
      const todoListDelete = event.target.closest("[data-todo-list-delete]");
      if (todoListDelete) await deleteTodoList(todoListDelete.dataset.todoListDelete);
      const vocabularyBook = event.target.closest("[data-vocab-book]");
      if (vocabularyBook) await selectVocabularyBook(vocabularyBook.dataset.vocabBook);
      const vocabularyCatalog = event.target.closest("[data-vocab-catalog]");
      if (vocabularyCatalog) await importVocabularyCatalog(vocabularyCatalog.dataset.vocabCatalog, vocabularyCatalog);
      const vocabularyMode = event.target.closest("[data-vocab-mode]");
      if (vocabularyMode && !vocabularyMode.disabled) {
        state.vocabularyMode = vocabularyMode.dataset.vocabMode;
        state.vocabularyRevealed = false;
        renderVocabulary();
        if (state.vocabularyMode === "spelling") $("#vocab-spelling-input").focus();
      }
      const vocabularyRating = event.target.closest("[data-vocab-rating]");
      if (vocabularyRating) await reviewVocabularyWord(Number(vocabularyRating.dataset.vocabRating));
      const focusTaskButton = event.target.closest("[data-focus-task-select]");
      if (focusTaskButton && !state.focus && !state.isStartingFocus) {
        $("#focus-task").value = focusTaskButton.dataset.focusTaskSelect;
        renderFocus();
        notify("已关联该任务，设置时长后即可开始专注。");
      }
      const moodDay = event.target.closest("[data-mood-date]");
      if (moodDay) {
        if (moodDay.dataset.moodDate !== state.moodSelectedDate && !canLeaveMoodDraft()) return;
        state.moodSelectedDate = moodDay.dataset.moodDate;
        renderMoods();
        document.dispatchEvent(new CustomEvent("daynest:mood-date-selected"));
      }
      const moodChoice = event.target.closest("[data-mood-choice]");
      if (moodChoice) {
        $("#mood-value").value = moodChoice.dataset.moodChoice;
        $$('[data-mood-choice]').forEach((button) => {
          const selected = button === moodChoice;
          button.classList.toggle("selected", selected);
          button.setAttribute("aria-checked", String(selected));
          button.setAttribute("role", "radio"); button.tabIndex = selected ? 0 : -1;
        });
        markMoodDraft();
      }
      const moodActivity = event.target.closest("[data-mood-activity]");
      if (moodActivity) { moodActivity.classList.toggle("selected"); moodActivity.setAttribute("aria-pressed", String(moodActivity.classList.contains("selected"))); markMoodDraft(); }
    });
    document.addEventListener("keydown", (event) => {
      if (state.currentView !== "vocabulary" || event.isComposing || event.repeat || state.vocabularyLoading || state.vocabularyReviewing || state.vocabularyError || event.target.closest?.("input, textarea, select, button") || document.querySelector("dialog[open]")) return;
      if (event.key === " " && state.vocabularyMode === "flashcard" && currentVocabularyWord() && !state.vocabularyRevealed) {
        event.preventDefault();
        state.vocabularyRevealed = true;
        renderVocabulary();
      }
      if (/^[1-4]$/.test(event.key) && state.vocabularyRevealed) {
        event.preventDefault();
        reviewVocabularyWord(Number(event.key));
      }
    });
    $("#todo-search").addEventListener("input", () => {
      state.todoFilters.query = $("#todo-search").value.trim();
      renderTodos();
    });
    $("#todo-priority-filter").addEventListener("change", () => {
      state.todoFilters.priority = $("#todo-priority-filter").value;
      renderTodos();
    });
    $("#todo-tag-filter").addEventListener("change", () => {
      state.todoFilters.tag = $("#todo-tag-filter").value;
      renderTodos();
    });
    $("#vocab-open-catalog").addEventListener("click",()=>{const drawer=$("#vocab-catalog-drawer");drawer.open=true;drawer.scrollIntoView({block:"start",behavior:"auto"});drawer.querySelector("summary").focus();});
    $("#vocab-refresh").addEventListener("click",()=> (state.vocabularyBookID && state.vocabularyCatalogs.length ? refreshVocabulary() : refresh()).catch(error=>notify(error.message,"error")));
    $("#vocab-search").addEventListener("input", () => {
      state.vocabularySearch = $("#vocab-search").value.trim();
      state.vocabularyPage = 1;
      window.clearTimeout(state.vocabularySearchTimer);
      state.vocabularySearchTimer = window.setTimeout(() => refreshVocabulary({libraryOnly:true}).catch((error) => notify(error.message, "error")), 260);
    });
    $("#vocab-stage-filter").addEventListener("change", () => {
      state.vocabularyStage = $("#vocab-stage-filter").value;
      state.vocabularyPage = 1;
      refreshVocabulary({libraryOnly:true}).catch((error) => notify(error.message, "error"));
    });
    $("#vocab-page-prev").addEventListener("click", () => { if (state.vocabularyPage > 1) { state.vocabularyPage--; refreshVocabulary({libraryOnly:true}).catch((error) => notify(error.message, "error")); } });
    $("#vocab-page-next").addEventListener("click", () => { if (state.vocabularyPage < Number(state.vocabularyMeta.total_pages || 1)) { state.vocabularyPage++; refreshVocabulary({libraryOnly:true}).catch((error) => notify(error.message, "error")); } });
    $("#vocab-reveal").addEventListener("click", () => {
      state.vocabularyRevealed = true;
      renderVocabulary();
    });
    $("#vocab-speak").addEventListener("click", speakVocabularyWord);
    $("#vocab-spelling-mode").addEventListener("submit", (event) => {
      event.preventDefault();
      const word = currentVocabularyWord();
      if (!word || state.vocabularyRevealed || state.vocabularyLoading || state.vocabularyReviewing || state.vocabularyError) return;
      const expected = word.term.trim().toLocaleLowerCase();
      const actual = $("#vocab-spelling-input").value.trim().toLocaleLowerCase();
      const correct = actual === expected;
      state.vocabularyRevealed = true;
      renderVocabulary();
      const result = $("#vocab-spelling-result");
      result.textContent = correct ? "拼写正确！请根据回忆难度选择下方反馈。" : `正确拼写：${word.term}`;
      result.className = `vocab-spelling-result ${correct ? "correct" : "incorrect"}`;
    });
    $$("[data-focus-duration]").forEach((button) => button.addEventListener("click", () => {
      if (state.focus || state.isStartingFocus) return;
      $("#focus-minutes").value = button.dataset.focusDuration;
      renderReadyCountdown();
      renderFocusPlan();
    }));
    $("#focus-minutes").addEventListener("input", () => {
      if (!state.focus && !state.isStartingFocus) { renderReadyCountdown(); renderFocusPlan(); }
    });
    $("#focus-break-enabled").addEventListener("change", () => { renderReadyCountdown(); renderFocusPlan(); });
    $("#focus-duration-less").addEventListener("click", () => adjustFocusDuration(-5));
    $("#focus-duration-more").addEventListener("click", () => adjustFocusDuration(5));
    $("#focus-timer").addEventListener("keydown", handleFocusClockKey);
    $("#focus-clear-task").addEventListener("click", () => {
      if (state.focus || state.isStartingFocus || state.isUpdatingFocus || state.isFinishingFocus) return;
      $("#focus-task").value = "";
      renderFocus();
      $("#focus-task").focus();
      setFocusFeedback("已切换为自由专注，不会修改任何任务。");
    });
    $("#focus-quiet-toggle").addEventListener("click", () => setFocusQuiet(!$("#panel-focus").classList.contains("is-quiet")));
    $("#focus-retry-transition").addEventListener("click", retryFocusTransition);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.currentView === "focus" && $("#panel-focus").classList.contains("is-quiet")) setFocusQuiet(false);
    });
    $("#focus-task").addEventListener("change", renderFocus);
    $("#mood-prev-month").addEventListener("click", () => shiftMoodMonth(-1));
    $("#mood-reload").addEventListener("click",()=>refreshMoods().catch(e=>notify(e.message,"error")));
    $("#mood-form").addEventListener("input", markMoodDraft);
    $("#mood-today").addEventListener("click", () => {
      const today = new Date();
      return selectMoodMonth(monthKey(today), localDateKey(today));
    });
    const moodMonthDialog = $("#mood-month-dialog");
    $("#mood-month-open").addEventListener("click", () => {
      $("#mood-month-input").value = state.moodMonth;
      moodMonthDialog.showModal();
    });
    $("#mood-month-close").addEventListener("click", () => moodMonthDialog.close());
    $("#mood-month-form").addEventListener("submit", event => {
      event.preventDefault();
      const month = $("#mood-month-input").value;
      moodMonthDialog.close();
      if (month !== state.moodMonth) selectMoodMonth(month);
    });
    $(".mood-picker").addEventListener("keydown", event => {
      const buttons=$$('[data-mood-choice]'), index=buttons.indexOf(event.target);
      if(index<0 || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;
      event.preventDefault();const next=(index+(["ArrowLeft","ArrowUp"].includes(event.key)?-1:1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();
    });
    window.addEventListener("beforeunload", event => { if(state.moodDraftRevision || state.moodSaving) { event.preventDefault(); event.returnValue=""; } });
    $("#mood-next-month").addEventListener("click", () => shiftMoodMonth(1));
    $("#mood-stress").addEventListener("input", () => { $("#mood-stress-value").textContent = $("#mood-stress").value; });
    $("#mood-energy").addEventListener("input", () => { $("#mood-energy-value").textContent = $("#mood-energy").value; });
    $("#mood-form").addEventListener("submit", saveMoodEntry);
    $("#delete-mood-entry").addEventListener("click", deleteMoodEntry);
    $("#edit-daily-goal").addEventListener("click", () => {
      const form = $("#daily-goal-form");
      form.classList.toggle("hidden");
      $("#edit-daily-goal").setAttribute("aria-expanded", String(!form.classList.contains("hidden")));
      if (!form.classList.contains("hidden")) {
        $("#daily-goal-minutes").value = state.dailyFocusGoalMinutes;
        $("#daily-goal-minutes").focus();
        $("#daily-goal-minutes").select();
      }
    });
    $("#cancel-daily-goal").addEventListener("click", () => {
      $("#daily-goal-form").classList.add("hidden");
      $("#edit-daily-goal").setAttribute("aria-expanded", "false");
      $("#edit-daily-goal").focus();
      renderFocusProgress();
    });
    $("#daily-goal-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!$("#daily-goal-form").reportValidity()) return;
      state.dailyFocusGoalMinutes = clampDailyFocusGoal($("#daily-goal-minutes").value);
      persistDailyFocusGoal();
      $("#daily-goal-form").classList.add("hidden");
      $("#edit-daily-goal").setAttribute("aria-expanded", "false");
      $("#edit-daily-goal").focus();
      renderFocusProgress();
      notify(`每日专注目标已设置为 ${state.dailyFocusGoalMinutes} 分钟。`);
    });

    let authSubmitting = false;
    function handleAuthError(form, error) {
      if (!window.DaynestMobile?.showAuthError?.(form.id, error)) notify(error.message, "error");
    }
    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector("button[type=submit]");
      if (authSubmitting || restoringSession) return;
      authSubmitting = true; button.disabled = true;
      try {
        const result = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value }) });
        state.token = result.token;
        localStorage.setItem("studyflow.token", state.token);
        $("#login-password").value = "";
        enterApp(result.user);
        notify(`欢迎回来，${result.user.name}`);
      } catch (error) { handleAuthError(form, error); }
      finally { authSubmitting = false; button.disabled = false; }
    });
    $("#register-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector("button[type=submit]");
      if (authSubmitting || restoringSession) return;
      authSubmitting = true; button.disabled = true;
      try {
        const result = await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ name: $("#register-name").value, email: $("#register-email").value, password: $("#register-password").value }) });
        state.token = result.token;
        localStorage.setItem("studyflow.token", state.token);
        $("#register-password").value = "";
        enterApp(result.user);
        notify("账号创建成功，开始你的学习计划吧。");
      } catch (error) { handleAuthError(form, error); }
      finally { authSubmitting = false; button.disabled = false; }
    });

    $("#todo-list-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/todo-lists", { method: "POST", body: JSON.stringify({ name: $("#todo-list-name").value, color: $("#todo-list-color").value }) }), "分类已创建。"));
    $("#todo-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/todos", { method: "POST", body: JSON.stringify({ list_id: $("#todo-list").value, title: $("#todo-title").value, notes: $("#todo-notes").value, priority: $("#todo-priority").value, due_at: toISO($("#todo-due").value), my_day_date: $("#todo-my-day").checked ? localDateKey(new Date()) : "", repeat_rule: $("#todo-repeat").value, tags: $("#todo-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean), steps: $("#todo-steps").value.split("\n").map((step) => step.trim()).filter(Boolean) }) }), "待办已加入清单。"));
    $("#focus-form").addEventListener("submit", startFocus);
    $("#pause-focus").addEventListener("click", pauseFocus);
    $("#resume-focus").addEventListener("click", resumeFocus);
    $("#finish-focus").addEventListener("click", () => finishFocus(false));
    $("#abandon-focus").addEventListener("click", () => {
      if (state.focus && !state.isUpdatingFocus && !state.isFinishingFocus && window.confirm("确定放弃本次专注？本次不会计入已完成专注。若想保留投入时间，请选择「完成并记录」。")) finishFocus(true);
    });
  }

  function visibleTodo(id) {
    return state.todos.find(todo => todo.id === id);
  }

  async function changeTodoCompletion(id, completed) {
    return window.DaynestTodos?.action(visibleTodo(id), "complete", completed);
  }

  async function changeTodoMyDay(id, action) {
    return window.DaynestTodos?.action(visibleTodo(id), "myday", action === "add" ? localDateKey(new Date()) : "");
  }

  async function changeTodoStep(todoID, stepID, completed) {
    return window.DaynestTodos?.action(visibleTodo(todoID), "step", { id: stepID, completed });
  }

  async function deleteTodo(id) {
    return window.DaynestTodos?.action(visibleTodo(id), "delete");
  }

  async function deleteTodoList(id) {
    try {
      await api(`/api/v1/todo-lists/${id}`, { method: "DELETE" });
      if (state.todoView === `list:${id}`) state.todoView = "inbox";
      await refresh();
      notify("分类已删除，其中的待办已移回收集箱。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function startFocus(event) {
    event.preventDefault();
    if (state.focus || state.isStartingFocus || state.isFinishingFocus || state.isUpdatingFocus) return;
    if (!$("#focus-form").reportValidity()) return;
    const plannedMinutes = clampPlannedMinutes($("#focus-minutes").value);
    const breakEnabled = $("#focus-break-enabled").checked;
    const taskID = $("#focus-task").value;
    const isTodo=taskID.startsWith("todo:");
    if(window.DaynestActions?.hasPendingFocus()){await window.DaynestActions.recovery();return;}
    const previousControl = document.activeElement;
    setFocusFeedback();
    state.isStartingFocus = true;
    renderFocus();
    try {
      const session = isTodo ? await window.DaynestActions.startTodoFocus(taskID.slice(5),plannedMinutes,breakEnabled) : await api("/api/v1/focus-sessions", { method: "POST", body: JSON.stringify({ planned_minutes: plannedMinutes, break_enabled: breakEnabled }) });
      if(!["running","paused"].includes(session.status)){await refresh();notify("这项操作对应的专注已结束，请查看专注记录。");return;}
      state.focus = { id: session.id, completeTask: false };
      syncActiveFocus(session);
      renderFocus();
      notify(breakEnabled ? "倒计时已开始：前半段专注后将自动休息 5 分钟。" : `${session.planned_minutes} 分钟倒计时已开始，享受这一段不被打扰的时间。`);
    } catch (error) {
      setFocusFeedback(`未能确认开启：${error.message}。请核对连接，必要时刷新以恢复已开启的会话。`, true);
      notify(error.message, "error");
    } finally {
      state.isStartingFocus = false;
      renderFocus();
      if (state.focus) handoffFocusControl(previousControl, "#pause-focus");
    }
  }

  async function pauseFocus() {
    await updateFocusSession("pause", "已暂停，时间不会继续流逝。");
  }

  async function resumeFocus() {
    await updateFocusSession("resume", "已继续倒计时。");
  }

  async function advanceFocus(automatic = false) {
    if (!state.focus || state.isUpdatingFocus || state.isFinishingFocus) return;
    const focusID = state.focus.id;
    setFocusFeedback();
    state.isUpdatingFocus = true;
    renderFocus();
    try {
      const session = await api(`/api/v1/focus-sessions/${state.focus.id}/advance`, { method: "POST" });
      syncActiveFocus(session);
      renderFocus();
      notify(session.phase === "break" ? "第一段专注完成，开始休息 5 分钟。" : automatic ? "休息结束，开始第二段专注。" : "已进入下一阶段。");
    } catch (error) {
      if (automatic && state.focus?.id === focusID) state.focus.transitionError = error.message;
      if (!automatic) setFocusFeedback(`未能确认切换阶段：${error.message}`, true);
      notify(error.message, "error");
    } finally {
      state.isUpdatingFocus = false;
      renderFocus();
    }
  }

  async function updateFocusSession(action, message) {
    if (!state.focus || state.isUpdatingFocus || state.isFinishingFocus) return;
    const previousControl = document.activeElement;
    setFocusFeedback();
    state.isUpdatingFocus = true;
    renderFocus();
    try {
      const session = await api(`/api/v1/focus-sessions/${state.focus.id}/${action}`, { method: "POST" });
      syncActiveFocus(session);
      renderFocus();
      notify(message);
    } catch (error) {
      setFocusFeedback(`未能确认${action === "pause" ? "暂停" : "继续"}：${error.message}。请刷新核对当前状态。`, true);
      notify(error.message, "error");
    } finally {
      state.isUpdatingFocus = false;
      renderFocus();
      if (previousControl !== $("#focus-timer") && state.focus) handoffFocusControl(previousControl, state.focus.status === "paused" ? "#resume-focus" : "#pause-focus");
    }
  }

  async function finishFocus(abandoned, automatic = false) {
    if (!state.focus || state.isFinishingFocus || state.isUpdatingFocus) return;
    const completedFocus = state.focus;
    const previousControl = document.activeElement;
    setFocusFeedback();
    state.isFinishingFocus = true;
    renderFocus();
    try {
      await api(`/api/v1/focus-sessions/${completedFocus.id}/finish`, { method: "PATCH", body: JSON.stringify({ abandoned }) });
      state.focus = null;
      persistFocus();
      setFocusFeedback(abandoned ? "已放弃本次会话，不计入今日积累。" : "这一段专注已记录。休息一下，再开始下一段吧。");
      await refresh();
      if (!abandoned && completedFocus.completeTask && completedFocus.taskID) {
        try {
          const tasks = await api("/api/v1/tasks");
          const task = tasks.find(item => item.id === completedFocus.taskID);
          if (task && task.status !== "done" && task.status !== "cancelled") {
            await api(`/api/v1/tasks/${encodeURIComponent(task.id)}/status`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
            notify("专注会话和关联任务均已完成，做得好。");
            return;
          }
        } catch (error) {
          notify(`专注已记录，但原学习任务未自动完成：${error.message}`, "error");
          return;
        }
      }
      notify(abandoned ? "已放弃本次专注会话。" : automatic ? "倒计时结束，专注会话已自动完成。" : "专注会话已完成，做得好。");
    } catch (error) {
      if (automatic && state.focus?.id === completedFocus.id) state.focus.transitionError = error.message;
      if (!automatic) setFocusFeedback(state.focus ? `未能确认保存：${error.message}。请刷新核对会话状态。` : `会话已保存，但页面同步失败：${error.message}。请刷新查看统计。`, true);
      notify(error.message, "error");
    } finally {
      state.isFinishingFocus = false;
      renderFocus();
      if (!state.focus && !automatic) handoffFocusControl(previousControl, "#start-focus");
    }
  }

  let restoringSession = "";
  async function restoreSession() {
    if (!state.token || restoringSession === state.token) return;
    const owner = state.token;
    const button = $("#auth-reconnect");
    restoringSession = owner; button.disabled = true;
    try {
      const user = await api("/api/v1/me");
      if (owner !== state.token) return;
      if (!user || typeof user.id !== 'string' || !user.id || typeof user.name !== 'string') throw new Error('服务返回的账号信息不完整，请检查后端版本。');
      $("#auth-connection").hidden = true;
      enterApp(user);
    } catch (error) {
      if (owner !== state.token) return;
      $("#auth-connection").hidden = false;
      $("#auth-connection-status").textContent = `连接尚未完成：${error.message} 登录状态已保留，可重试连接或切换账号。`;
    } finally { if (restoringSession === owner) { restoringSession = ""; button.disabled = false; } }
  }

  async function bootstrap() {
    applyTheme(state.theme);
    renderMoods();
    bindEvents();
    window.setInterval(updateFocusClock, 250);
    window.setInterval(() => {
      if (state.user && !document.hidden) refresh({ background: true }).catch(() => undefined);
    }, 60_000);
    renderReadyCountdown();
    renderFocusPlan();
    await restoreSession();
  }

  bootstrap();
})();
