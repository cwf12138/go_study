(() => {
  "use strict";

  const state = {
    token: localStorage.getItem("studyflow.token") || "",
    user: null,
    dashboard: null,
    goals: [],
    goalPage: [],
    goalMeta: { count: 0, total: 0, page: 1, page_size: 8, total_pages: 0 },
    goalQuery: { status: "", sort: "created_at", order: "desc", page: 1, pageSize: 8 },
    moodEntries: [],
    moodInsights: null,
    moodMonth: monthKey(new Date()),
    moodSelectedDate: localDateKey(new Date()),
    theme: loadTheme(),
    tasks: [],
    todoLists: [],
    todos: [],
    todoView: "today",
    todoFilters: { priority: "", tag: "", query: "" },
    wordBooks: [],
    vocabularyWords: [],
    vocabularyQueue: [],
    vocabularyOverview: null,
    vocabularyBookID: "",
    vocabularyMode: "flashcard",
    vocabularyRevealed: false,
    vocabularySearch: "",
    vocabularyStage: "",
    plannerWeekStart: mondayKey(new Date()),
    plannerWeek: null,
    plannerSelectedBlockID: "",
    plannerSettingsOpen: false,
    insightsDays: 30,
    learningInsights: null,
    weeklyReviewWeekStart: mondayKey(new Date()),
    weeklyReview: null,
    decks: [],
    dueCards: [],
    currentView: "dashboard",
    focus: loadFocus(),
    dailyFocusGoalMinutes: 60,
    isFinishingFocus: false,
    isUpdatingFocus: false,
    toastTimer: null,
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
    { value: "awful", emoji: "😣", label: "很糟" },
    { value: "low", emoji: "🙁", label: "低落" },
    { value: "neutral", emoji: "😐", label: "平静" },
    { value: "good", emoji: "🙂", label: "不错" },
    { value: "great", emoji: "😄", label: "很好" },
  ];

  async function api(path, options = {}) {
    const { returnEnvelope = false, ...requestOptions } = options;
    const headers = new Headers(requestOptions.headers || {});
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (requestOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    let response;
    try {
      response = await fetch(path, { ...requestOptions, headers });
    } catch {
      throw new Error("无法连接到服务，请确认 Go API 正在运行。");
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.token) leaveApp();
      throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
    }
    return returnEnvelope ? payload : payload.data;
  }

  async function downloadAuthenticated(path, fallbackFilename) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.message || `导出失败（${response.status}）`);
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = match?.[1] || fallbackFilename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function notify(message, type = "success") {
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

  function mondayKey(date) {
    const monday = new Date(date);
    monday.setHours(0, 0, 0, 0);
    const weekday = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - weekday);
    return localDateKey(monday);
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
  }

  function loadDailyFocusGoal() {
    const value = Number(localStorage.getItem(`studyflow.dailyFocusGoal.${state.user?.id || "default"}`));
    return Number.isFinite(value) ? clampDailyFocusGoal(value) : 60;
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
    state.user = user;
    state.dailyFocusGoalMinutes = loadDailyFocusGoal();
    if (state.focus && state.focus.userID !== user.id) {
      state.focus = null;
      persistFocus();
    }
    $("#auth-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    $("#user-name").textContent = user.name;
    showView(state.currentView);
    refresh().catch((error) => notify(error.message, "error"));
  }

  function leaveApp() {
    state.token = "";
    state.user = null;
    state.dashboard = null;
    state.goals = [];
    state.goalPage = [];
    state.goalMeta = { count: 0, total: 0, page: 1, page_size: 8, total_pages: 0 };
    state.goalQuery = { status: "", sort: "created_at", order: "desc", page: 1, pageSize: 8 };
    state.moodEntries = [];
    state.moodInsights = null;
    state.moodMonth = monthKey(new Date());
    state.moodSelectedDate = localDateKey(new Date());
    state.tasks = [];
    state.todoLists = [];
    state.todos = [];
    state.todoView = "today";
    state.todoFilters = { priority: "", tag: "", query: "" };
    state.wordBooks = [];
    state.vocabularyWords = [];
    state.vocabularyQueue = [];
    state.vocabularyOverview = null;
    state.vocabularyBookID = "";
    state.vocabularyMode = "flashcard";
    state.vocabularyRevealed = false;
    state.vocabularySearch = "";
    state.vocabularyStage = "";
    state.plannerWeekStart = mondayKey(new Date());
    state.plannerWeek = null;
    state.plannerSelectedBlockID = "";
    state.plannerSettingsOpen = false;
    state.insightsDays = 30;
    state.learningInsights = null;
    state.weeklyReviewWeekStart = mondayKey(new Date());
    state.weeklyReview = null;
    state.decks = [];
    state.dueCards = [];
    state.focus = null;
    state.dailyFocusGoalMinutes = 60;
    localStorage.removeItem("studyflow.token");
    persistFocus();
    $("#app-view").classList.add("hidden");
    $("#auth-view").classList.remove("hidden");
    authTab("login");
  }

  function showView(view) {
    const labels = {
      dashboard: ["今天也在前进", "学习概览"],
      goals: ["GOALS", "学习目标"],
      moods: ["MOOD JOURNAL", "心情日记"],
      tasks: ["TASKS", "学习任务"],
      todo: ["TODO LIST", "待办清单"],
      planner: ["SMART PLANNER", "智能学习规划"],
      insights: ["LEARNING INSIGHTS", "学习洞察与复盘"],
      vocabulary: ["VOCABULARY", "单词学习"],
      review: ["SPACED REPETITION", "间隔复习"],
      focus: ["FOCUS", "专注会话"],
    };
    state.currentView = view;
    $("#page-kicker").textContent = labels[view][0];
    $("#page-title").textContent = labels[view][1];
    $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${view}`));
    $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    $(".sidebar").classList.remove("open");
  }

  function goalListURL() {
    const query = new URLSearchParams({
      page: String(state.goalQuery.page),
      page_size: String(state.goalQuery.pageSize),
      sort: state.goalQuery.sort,
      order: state.goalQuery.order,
    });
    if (state.goalQuery.status) query.set("status", state.goalQuery.status);
    return `/api/v1/goals?${query.toString()}`;
  }

  async function refresh() {
    const todoListsRequest = api("/api/v1/todo-lists");
    const todosRequest = todoListsRequest.then(() => api(`/api/v1/todos?view=all&date=${localDateKey(new Date())}`));
    const vocabularyRequest = api("/api/v1/word-books").then(async (books = []) => {
      const selectedBookID = books.some((book) => book.id === state.vocabularyBookID)
        ? state.vocabularyBookID
        : (books[0]?.id || "");
      if (!selectedBookID) return { books, selectedBookID, words: [], queue: [], overview: null };
      const bookQuery = `book_id=${encodeURIComponent(selectedBookID)}`;
      const [words, queue, overview] = await Promise.all([
        api(`/api/v1/words?${bookQuery}`),
        api(`/api/v1/words/queue?${bookQuery}&limit=100`),
        api(`/api/v1/vocabulary/overview?${bookQuery}`),
      ]);
      return { books, selectedBookID, words, queue, overview };
    });
    const [dashboard, goalPageResponse, activeGoalsResponse, moods, moodInsights, tasks, todoLists, todos, vocabulary, plannerWeek, learningInsights, weeklyReview, dueCards, decks, activeFocus] = await Promise.all([
      api("/api/v1/dashboard"),
      api(goalListURL(), { returnEnvelope: true }),
      api("/api/v1/goals?status=active&sort=title&order=asc&page=1&page_size=50", { returnEnvelope: true }),
      api(`/api/v1/moods?month=${state.moodMonth}`),
      api(`/api/v1/moods/insights?month=${state.moodMonth}`),
      api("/api/v1/tasks"),
      todoListsRequest,
      todosRequest,
      vocabularyRequest,
      api(`/api/v1/planner/week?week_start=${encodeURIComponent(state.plannerWeekStart)}`),
      api(`/api/v1/analytics/learning?days=${state.insightsDays}`),
      api(`/api/v1/reviews/weekly?week_start=${encodeURIComponent(state.weeklyReviewWeekStart)}`),
      api("/api/v1/cards/due?limit=50"),
      api("/api/v1/decks"),
      api("/api/v1/focus-sessions/active"),
    ]);
    state.dashboard = dashboard;
    state.goalPage = goalPageResponse.data || [];
    state.goalMeta = goalPageResponse.meta || state.goalMeta;
    state.goals = activeGoalsResponse.data || [];
    state.moodEntries = moods || [];
    state.moodInsights = moodInsights || null;
    state.tasks = tasks;
    state.todoLists = todoLists || [];
    state.todos = todos || [];
    state.wordBooks = vocabulary.books || [];
    state.vocabularyBookID = vocabulary.selectedBookID || "";
    state.vocabularyWords = vocabulary.words || [];
    state.vocabularyQueue = vocabulary.queue || [];
    state.vocabularyOverview = vocabulary.overview || null;
    state.plannerWeek = plannerWeek || null;
    state.learningInsights = learningInsights || null;
    state.weeklyReview = weeklyReview || null;
    state.dueCards = dueCards;
    state.decks = decks;
    syncActiveFocus(activeFocus);
    render();
  }

  function syncActiveFocus(session) {
    if (!session) {
      if (state.focus) {
        state.focus = null;
        persistFocus();
      }
      return;
    }
    const completeTask = state.focus?.id === session.id ? state.focus.completeTask : true;
    state.focus = {
      id: session.id,
      userID: state.user.id,
      taskID: session.task_id,
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
    renderGoals();
    renderMoods();
    renderTasks();
    renderTodos();
    renderPlanner();
    renderLearningInsights();
    renderWeeklyReview();
    renderVocabulary();
    renderReview();
    renderFocus();
    renderSelects();
  }

  function renderDashboard() {
    const data = state.dashboard || {};
    $("#metric-goals").textContent = data.active_goals ?? 0;
    $("#metric-tasks").textContent = data.pending_tasks ?? 0;
    $("#metric-completed").textContent = data.completed_tasks_today ?? 0;
    $("#today-sessions").textContent = `完成 ${data.focus_sessions_today ?? 0} 个专注会话`;
    $("#metric-cards").textContent = data.due_cards ?? 0;
    $("#metric-focus").textContent = data.focus_minutes_today ?? 0;
    $("#week-focus").textContent = `本周 ${data.focus_minutes_week ?? 0} 分钟`;

    const nextTasks = state.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").slice(0, 4);
    $("#dashboard-tasks").className = "stack-list";
    $("#dashboard-tasks").innerHTML = nextTasks.length ? nextTasks.map((task) => `
      <div class="list-row"><div class="row-main"><h4>${escapeHTML(task.title)}</h4><p>${priorityLabel(task.priority)}优先级 · ${task.due_at ? `截止 ${formatDate(task.due_at)}` : "未设置截止时间"}</p></div><span class="pill ${task.status}">${taskStatusLabel(task.status)}</span></div>`).join("")
      : "<div class=\"empty-state\">还没有待处理任务。创建一个小而明确的下一步吧。</div>";

    $("#dashboard-cards").className = "stack-list";
    $("#dashboard-cards").innerHTML = state.dueCards.length ? state.dueCards.slice(0, 4).map((card) => `
      <div class="list-row"><div class="row-main"><h4>${escapeHTML(card.prompt)}</h4><p>已复习 ${card.repetitions} 次 · 间隔 ${card.interval_days} 天</p></div><button class="text-button" type="button" data-goto="review">复习</button></div>`).join("")
      : "<div class=\"empty-state\">没有待复习卡片，保持这个节奏。</div>";
  }

  function renderGoals() {
    const container = $("#goals-list");
    const items = state.goalPage;
    $("#goal-status-filter").value = state.goalQuery.status;
    $("#goal-sort").value = state.goalQuery.sort;
    $("#goal-order").value = state.goalQuery.order;
    if (!items.length) {
      container.className = "goal-list empty-state";
      container.textContent = state.goalMeta.total
        ? "这个页面暂时没有目标。调整筛选条件或返回上一页试试。"
        : state.goalQuery.status ? "当前状态下还没有目标。调整筛选条件或创建一个新目标吧。" : "还没有目标。先创建一个值得长期投入的方向。";
      renderGoalPagination();
      return;
    }
    container.className = "goal-list";
    container.innerHTML = items.map((goal) => {
      const actions = goal.status === "active"
        ? `<button class="quiet" type="button" data-goal-status="completed" data-id="${goal.id}">完成</button><button class="quiet" type="button" data-goal-status="archived" data-id="${goal.id}">归档</button>`
        : `<button class="quiet" type="button" data-goal-status="active" data-id="${goal.id}">重新激活</button>`;
      const deadline = goal.deadline
        ? `截止 ${formatDate(goal.deadline, true)} · ${deadlineStatus(goal.deadline)}`
        : deadlineStatus(goal.deadline);
      return `<div class="goal-swipe" data-goal-swipe><button class="goal-swipe-delete" type="button" data-goal-delete="${goal.id}" aria-label="删除目标 ${escapeHTML(goal.title)}">删除</button><article class="list-row goal-row goal-swipe-card" data-goal-swipe-card role="button" tabindex="0" aria-expanded="false" aria-label="显示目标删除操作：${escapeHTML(goal.title)}"><div class="row-main"><div class="row-actions"><h4>${escapeHTML(goal.title)}</h4><span class="pill ${goal.status === "completed" ? "done" : goal.status === "archived" ? "cancelled" : "in_progress"}">${goalStatusLabel(goal.status)}</span></div><p>${escapeHTML(goal.description || "尚未添加目标说明")}</p><small class="goal-created-at">创建于 ${formatDate(goal.created_at, true)}</small><small class="goal-created-at">${deadline}</small></div><div class="row-actions">${actions}</div></article></div>`;
    }).join("");
    renderGoalPagination();
  }

  function renderGoalPagination() {
    const meta = state.goalMeta;
    const pagination = $("#goals-pagination");
    const summary = $("#goals-summary");
    const page = Number(meta.page || 1);
    const totalPages = Number(meta.total_pages || 0);
    const total = Number(meta.total || 0);
    summary.textContent = total ? `共 ${total} 个目标 · 第 ${page}/${totalPages} 页` : "共 0 个目标";
    if (totalPages <= 1) {
      pagination.className = "pagination hidden";
      pagination.innerHTML = "";
      return;
    }
    const buttons = [];
    const addPage = (value) => buttons.push(`<button class="page-button ${value === page ? "active" : ""}" type="button" data-goal-page="${value}" ${value === page ? "aria-current=\"page\"" : ""}>${value}</button>`);
    buttons.push(`<button class="page-button" type="button" data-goal-page="${page - 1}" ${page === 1 ? "disabled" : ""}>上一页</button>`);
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    if (start > 1) addPage(1);
    if (start > 2) buttons.push("<span class=\"pagination-ellipsis\">…</span>");
    for (let current = start; current <= end; current += 1) addPage(current);
    if (end < totalPages - 1) buttons.push("<span class=\"pagination-ellipsis\">…</span>");
    if (end < totalPages) addPage(totalPages);
    buttons.push(`<button class="page-button" type="button" data-goal-page="${page + 1}" ${page === totalPages ? "disabled" : ""}>下一页</button>`);
    pagination.className = "pagination";
    pagination.innerHTML = buttons.join("");
  }

  function renderMoods() {
    const calendar = $("#mood-calendar");
    if (!calendar) return;
    const [year, month] = state.moodMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const leadingDays = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const entryByDate = new Map(state.moodEntries.map((entry) => [entry.date, entry]));
    const cells = [];
    for (let index = 0; index < leadingDays; index += 1) cells.push('<span class="mood-day empty" aria-hidden="true"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${state.moodMonth}-${String(day).padStart(2, "0")}`;
      const entry = entryByDate.get(date);
      const option = moodOptions.find((item) => item.value === entry?.mood);
      const classes = ["mood-day"];
      if (entry) classes.push("has-entry");
      if (date === state.moodSelectedDate) classes.push("selected");
      if (date === localDateKey(new Date())) classes.push("today");
      cells.push(`<button class="${classes.join(" ")}" type="button" data-mood-date="${date}" aria-label="${date}${option ? `，${option.label}` : "，尚未记录"}"><span class="mood-date">${day}</span><span class="mood-face">${option?.emoji || ""}</span></button>`);
    }
    calendar.innerHTML = cells.join("");
    $("#mood-month-title").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(firstDay);
    renderMoodForm(entryByDate.get(state.moodSelectedDate));
    renderMoodInsights();
    renderMoodTrend();
  }

  function renderMoodForm(entry) {
    const mood = entry?.mood || "neutral";
    $("#mood-selected-date").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${state.moodSelectedDate}T12:00:00`));
    $("#mood-value").value = mood;
    $$('[data-mood-choice]').forEach((button) => {
      const selected = button.dataset.moodChoice === mood;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    $("#mood-note").value = entry?.note || "";
    $("#mood-tags").value = (entry?.tags || []).join(", ");
    $("#mood-stress").value = entry?.stress || 3;
    $("#mood-energy").value = entry?.energy || 3;
    $("#mood-stress-value").textContent = $("#mood-stress").value;
    $("#mood-energy-value").textContent = $("#mood-energy").value;
    const activities = new Set(entry?.activities || []);
    $$('[data-mood-activity]').forEach((button) => button.classList.toggle("selected", activities.has(button.dataset.moodActivity)));
    $("#delete-mood-entry").disabled = !entry;
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
      return `<div class="mood-distribution-row"><span>${option.emoji} ${option.label}</span><div class="mood-distribution-track"><span style="width:${width}%"></span></div><strong>${count}</strong></div>`;
    }).join("");
    const activities = insights.top_activities || [];
    $("#mood-top-activities").innerHTML = activities.length
      ? `<div class="mood-activity-tags">${activities.map((activity) => `<span>${escapeHTML(activity.name)} · ${activity.count}</span>`).join("")}</div>`
      : "本月还没有活动记录";
  }

  function renderMoodTrend() {
    const container = $("#mood-trend");
    const caption = $("#mood-trend-caption");
    const entries = state.moodEntries.map((entry) => ({ ...entry, score: moodOptions.findIndex((option) => option.value === entry.mood) + 1 })).filter((entry) => entry.score > 0);
    if (!entries.length) {
      caption.textContent = "等待记录";
      container.className = "mood-trend empty-state";
      container.textContent = "记录几天心情后，这里会呈现你的变化轨迹。";
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
    const grid = moodOptions.map((option, index) => `<line x1="${left}" y1="${y(index + 1)}" x2="${width - right}" y2="${y(index + 1)}" class="mood-trend-grid"/><text x="3" y="${y(index + 1) + 4}" class="mood-trend-label">${option.emoji}</text>`).join("");
    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    const dots = points.map((point) => {
      const option = moodOptions[point.score - 1];
      return `<circle cx="${point.x}" cy="${point.y}" r="5" class="mood-trend-dot"><title>${point.date} · ${option.label}</title></circle>`;
    }).join("");
    const labels = [1, Math.ceil(daysInMonth / 2), daysInMonth].map((day) => `<text x="${x(day)}" y="${height - 8}" text-anchor="middle" class="mood-trend-axis">${day}日</text>`).join("");
    container.className = "mood-trend";
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${grid}<polyline points="${polyline}" class="mood-trend-line"/>${dots}${labels}</svg>`;
  }

  async function refreshMoods() {
    const [entries, insights] = await Promise.all([
      api(`/api/v1/moods?month=${state.moodMonth}`),
      api(`/api/v1/moods/insights?month=${state.moodMonth}`),
    ]);
    state.moodEntries = entries || [];
    state.moodInsights = insights || null;
    renderMoods();
  }

  async function shiftMoodMonth(offset) {
    const [year, month] = state.moodMonth.split("-").map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    state.moodMonth = monthKey(next);
    if (!state.moodSelectedDate.startsWith(state.moodMonth)) state.moodSelectedDate = `${state.moodMonth}-01`;
    try {
      await refreshMoods();
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function saveMoodEntry(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const activities = $$('[data-mood-activity].selected').map((item) => item.dataset.moodActivity);
      const tags = $("#mood-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean);
      await api(`/api/v1/moods/${state.moodSelectedDate}`, { method: "PUT", body: JSON.stringify({ mood: $("#mood-value").value, note: $("#mood-note").value, activities, tags, stress: Number($("#mood-stress").value), energy: Number($("#mood-energy").value) }) });
      await refreshMoods();
      notify("心情日记已保存。");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function deleteMoodEntry() {
    const exists = state.moodEntries.some((entry) => entry.date === state.moodSelectedDate);
    if (!exists) return;
    const button = $("#delete-mood-entry");
    button.disabled = true;
    try {
      await api(`/api/v1/moods/${state.moodSelectedDate}`, { method: "DELETE" });
      await refreshMoods();
      notify("当天的心情记录已删除。");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      button.disabled = false;
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
    const meta = [due, todoRepeatLabel(todo.repeat_rule) ? `<span>↻ ${todoRepeatLabel(todo.repeat_rule)}</span>` : "", list ? `<span><i class="todo-list-color" style="--todo-list-color:${escapeHTML(list.color || "#5b81ff")}"></i>${escapeHTML(list.name)}</span>` : ""].filter(Boolean).join("");
    return `<article class="todo-item ${completed ? "completed" : ""}"><button class="todo-complete" type="button" data-todo-completed="${!completed}" data-id="${todo.id}" aria-label="${completed ? "重新打开" : "完成"}待办 ${escapeHTML(todo.title)}">${completed ? "✓" : ""}</button><div class="todo-item-body"><div class="todo-item-title"><h4>${escapeHTML(todo.title)}</h4><span class="priority-${todo.priority}">● ${priorityLabel(todo.priority)}</span></div>${todo.notes ? `<p>${escapeHTML(todo.notes)}</p>` : ""}${meta ? `<div class="todo-meta">${meta}</div>` : ""}${(todo.tags || []).map((tag) => `<span class="tag">#${escapeHTML(tag)}</span>`).join("")}${steps.length ? `<div class="todo-steps"><span>${completedSteps}/${steps.length} 个步骤</span>${steps.map((step) => `<button class="todo-step ${step.completed ? "done" : ""}" type="button" data-todo-step="${todo.id}" data-step-id="${step.id}" data-step-completed="${!step.completed}"><i>${step.completed ? "✓" : ""}</i>${escapeHTML(step.title)}</button>`).join("")}</div>` : ""}</div><div class="todo-item-actions">${!completed ? `<button class="text-button" type="button" data-todo-my-day="${todo.my_day_date === localDateKey(new Date()) ? "remove" : "add"}" data-id="${todo.id}">${todo.my_day_date === localDateKey(new Date()) ? "移出今天" : "加入今天"}</button>` : ""}<button class="todo-delete" type="button" data-todo-delete="${todo.id}" aria-label="删除待办 ${escapeHTML(todo.title)}" title="删除待办">×</button></div></article>`;
  }

  function renderTasks() {
    const filter = $("#task-filter").value;
    const tasks = filter ? state.tasks.filter((task) => task.status === filter) : state.tasks;
    const container = $("#tasks-list");
    if (!tasks.length) {
      container.className = "task-list empty-state";
      container.textContent = filter ? "这个状态下还没有任务。" : "还没有任务。用一个 30 分钟的小任务开始吧。";
      return;
    }
    container.className = "task-list";
    container.innerHTML = tasks.map((task) => `<div class="task-swipe" data-task-swipe><button class="task-swipe-delete" type="button" data-task-delete="${task.id}" aria-label="删除任务 ${escapeHTML(task.title)}">删除</button><article class="list-row task-swipe-card" data-task-swipe-card role="button" tabindex="0" aria-expanded="false" aria-label="显示任务删除操作：${escapeHTML(task.title)}"><div class="row-main"><div class="row-actions"><h4>${escapeHTML(task.title)}</h4><span class="pill ${task.status}">${taskStatusLabel(task.status)}</span><span class="priority-${task.priority}">● ${priorityLabel(task.priority)}</span></div><p>${escapeHTML(task.description || "尚未添加完成说明")} · 预计 ${task.estimated_minutes} 分钟${task.due_at ? ` · 截止 ${formatDate(task.due_at, true)}` : ""}</p>${(task.tags || []).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}</div><div class="row-actions">${taskActions(task)}</div></article></div>`).join("");
  }

  function toggleTaskActions(card) {
    const wrapper = card.closest("[data-task-swipe]");
    if (!wrapper) return;
    const opening = !wrapper.classList.contains("revealed");
    $$('[data-task-swipe].revealed').forEach((item) => {
      if (item === wrapper) return;
      item.classList.remove("revealed");
      item.querySelector("[data-task-swipe-card]")?.setAttribute("aria-expanded", "false");
    });
    wrapper.classList.toggle("revealed", opening);
    card.setAttribute("aria-expanded", String(opening));
  }

  function toggleGoalActions(card) {
    const wrapper = card.closest("[data-goal-swipe]");
    if (!wrapper) return;
    const opening = !wrapper.classList.contains("revealed");
    $$('[data-goal-swipe].revealed').forEach((item) => {
      if (item === wrapper) return;
      item.classList.remove("revealed");
      item.querySelector("[data-goal-swipe-card]")?.setAttribute("aria-expanded", "false");
    });
    wrapper.classList.toggle("revealed", opening);
    card.setAttribute("aria-expanded", String(opening));
  }

  function taskActions(task) {
    if (task.status === "todo") return `<button class="quiet" type="button" data-task-status="in_progress" data-id="${task.id}">开始</button><button class="quiet" type="button" data-task-status="done" data-id="${task.id}">完成</button>`;
    if (task.status === "in_progress") return `<button class="primary" type="button" data-task-status="done" data-id="${task.id}">标记完成</button><button class="quiet" type="button" data-task-status="todo" data-id="${task.id}">暂停</button>`;
    return `<button class="quiet" type="button" data-task-status="todo" data-id="${task.id}">重新打开</button>`;
  }

  const plannerKindLabel = (kind) => ({ task: "学习任务", todo: "待办事项", review: "知识卡复习", vocabulary: "单词学习", custom: "自定义" }[kind] || kind);
  const plannerStatusLabel = (status) => ({ planned: "待开始", in_progress: "进行中", completed: "已完成", skipped: "已跳过" }[status] || status);

  function plannerTimeZone() {
    return state.plannerWeek?.preferences?.time_zone || "Asia/Shanghai";
  }

  function plannerDateParts(value) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: plannerTimeZone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(value));
    const result = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return { date: `${result.year}-${result.month}-${result.day}`, hour: Number(result.hour), minute: Number(result.minute) };
  }

  function plannerDateAt(weekStart, offset) {
    const date = new Date(`${weekStart}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function plannerWallTimeToISO(dateValue, timeValue) {
    const [year, month, day] = dateValue.split("-").map(Number);
    const [hour, minute] = timeValue.split(":").map(Number);
    const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
    const offsetAt = (timestamp) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: plannerTimeZone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(timestamp));
      const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
      return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - timestamp;
    };
    let instant = naive - offsetAt(naive);
    instant = naive - offsetAt(instant);
    return new Date(instant).toISOString();
  }

  function plannerClock(value) {
    const parts = plannerDateParts(value);
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  }

  function renderPlanner() {
    const week = state.plannerWeek;
    if (!week) return;
    const summary = week.summary || {};
    $("#planner-planned-minutes").textContent = summary.planned_minutes ?? 0;
    $("#planner-completed-minutes").textContent = summary.completed_minutes ?? 0;
    $("#planner-utilization").textContent = `${summary.utilization ?? 0}%`;
    $("#planner-capacity").textContent = `容量 ${summary.capacity_minutes ?? 0} 分钟`;
    $("#planner-unscheduled-count").textContent = summary.unscheduled_items ?? 0;
    $("#planner-unscheduled-minutes").textContent = `${summary.unscheduled_minutes ?? 0} 分钟待安排`;
    $("#planner-overdue-count").textContent = `${summary.overdue_sources ?? 0} 个逾期来源`;
    $("#planner-week-title").textContent = `${formatDate(`${week.week_start}T00:00:00`)} — ${formatDate(`${week.week_end}T00:00:00`)}`;
    $("#planner-settings").classList.toggle("hidden", !state.plannerSettingsOpen);
    $("#planner-settings-toggle").textContent = state.plannerSettingsOpen ? "收起设置" : "规划设置";

    renderPlannerCalendar();
    renderPlannerDetail();
    renderPlannerUnscheduled();
    if (state.plannerSettingsOpen) renderPlannerPreferences();
    const blockDate = $("#planner-block-date");
    if (!blockDate.value || blockDate.value < week.week_start || blockDate.value > week.week_end) blockDate.value = week.week_start;
  }

  function renderPlannerCalendar() {
    const week = state.plannerWeek;
    const blocks = week.blocks || [];
    const windowMinutes = (week.preferences?.windows || []).flatMap((window) => {
      const [startHour, startMinute] = window.start_time.split(":").map(Number);
      const [endHour, endMinute] = window.end_time.split(":").map(Number);
      return [startHour * 60 + startMinute, endHour * 60 + endMinute];
    });
    const blockMinutes = blocks.flatMap((block) => {
      const start = plannerDateParts(block.start_at);
      const end = plannerDateParts(block.end_at);
      return [start.hour * 60 + start.minute, end.hour * 60 + end.minute];
    });
    const allMinutes = [...windowMinutes, ...blockMinutes];
    const startMinute = Math.max(0, Math.floor((Math.min(...(allMinutes.length ? allMinutes : [480])) - 30) / 60) * 60);
    const endMinute = Math.min(1440, Math.ceil((Math.max(...(allMinutes.length ? allMinutes : [1320])) + 30) / 60) * 60);
    const pixelsPerMinute = 0.82;
    const height = Math.max(420, (endMinute - startMinute) * pixelsPerMinute);
    const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const today = localDateKey(new Date());
    const headers = Array.from({ length: 7 }, (_, index) => {
      const date = plannerDateAt(week.week_start, index);
      return `<div class="planner-day-header ${date === today ? "today" : ""}"><span>${weekdays[index]}</span><strong>${Number(date.slice(-2))}</strong></div>`;
    }).join("");
    const hours = [];
    for (let minute = startMinute; minute <= endMinute; minute += 60) {
      hours.push(`<span style="top:${(minute - startMinute) * pixelsPerMinute}px">${String(Math.floor(minute / 60)).padStart(2, "0")}:00</span>`);
    }
    const columns = Array.from({ length: 7 }, (_, index) => {
      const date = plannerDateAt(week.week_start, index);
      const dayBlocks = blocks.filter((block) => plannerDateParts(block.start_at).date === date);
      const windows = (week.preferences?.windows || []).filter((window) => window.weekday === index + 1).map((window) => {
        const [startHour, startMin] = window.start_time.split(":").map(Number);
        const [endHour, endMin] = window.end_time.split(":").map(Number);
        const top = (startHour * 60 + startMin - startMinute) * pixelsPerMinute;
        const windowHeight = (endHour * 60 + endMin - startHour * 60 - startMin) * pixelsPerMinute;
        return `<div class="planner-availability" style="top:${top}px;height:${windowHeight}px" title="可自动排程 ${window.start_time}–${window.end_time}"></div>`;
      }).join("");
      const blockHTML = dayBlocks.map((block) => {
        const start = plannerDateParts(block.start_at);
        const end = plannerDateParts(block.end_at);
        const top = Math.max(0, (start.hour * 60 + start.minute - startMinute) * pixelsPerMinute);
        const blockHeight = Math.max(26, block.planned_minutes * pixelsPerMinute);
        return `<button class="planner-block ${block.kind} ${block.status} ${block.id === state.plannerSelectedBlockID ? "selected" : ""}" type="button" data-planner-block="${block.id}" style="top:${top}px;height:${blockHeight}px" title="${escapeHTML(block.title)} · ${plannerClock(block.start_at)}–${plannerClock(block.end_at)}"><span>${plannerClock(block.start_at)}</span><strong>${escapeHTML(block.title)}</strong><small>${block.locked ? "🔒 " : ""}${block.planned_minutes} 分钟</small></button>`;
      }).join("");
      return `<div class="planner-day-column ${date === today ? "today" : ""}" style="height:${height}px" data-planner-date="${date}">${windows}${blockHTML}</div>`;
    }).join("");
    $("#planner-calendar").innerHTML = `<div class="planner-day-head-row"><div class="planner-time-corner">GMT${plannerTimeZone() === "Asia/Shanghai" ? "+8" : ""}</div>${headers}</div><div class="planner-calendar-scroll"><div class="planner-time-axis" style="height:${height}px">${hours.join("")}</div><div class="planner-day-columns">${columns}</div></div>`;
  }

  function renderPlannerDetail() {
    const container = $("#planner-block-detail");
    const block = (state.plannerWeek?.blocks || []).find((item) => item.id === state.plannerSelectedBlockID);
    if (!block) {
      state.plannerSelectedBlockID = "";
      container.className = "planner-block-detail empty-state";
      container.textContent = "点击日历中的时间块查看详情，或从右侧手动添加一个安排。";
      return;
    }
    const parts = plannerDateParts(block.start_at);
    const canCompleteSource = block.kind === "task" || block.kind === "todo";
    container.className = "planner-block-detail";
    container.innerHTML = `<div class="planner-detail-title"><div><span class="planner-kind ${block.kind}">${plannerKindLabel(block.kind)}</span><h4>${escapeHTML(block.title)}</h4></div><span class="pill ${block.status}">${plannerStatusLabel(block.status)}</span></div><p>${escapeHTML(block.notes || block.rationale || "没有补充说明")}</p><div class="planner-detail-meta"><span>计划 ${block.planned_minutes} 分钟</span><span>${block.auto_generated ? "智能排程" : "手动添加"}</span><span>${block.locked ? "已锁定" : "可重新排程"}</span></div><div class="planner-detail-edit"><label>日期<input id="planner-detail-date" type="date" value="${parts.date}"></label><label>开始<input id="planner-detail-start" type="time" value="${plannerClock(block.start_at)}"></label><label>结束<input id="planner-detail-end" type="time" value="${plannerClock(block.end_at)}"></label><button class="quiet" type="button" data-planner-action="move" data-id="${block.id}">保存时间</button></div><div class="planner-detail-actions">${block.status !== "completed" && block.status !== "skipped" ? `<button class="primary" type="button" data-planner-action="focus" data-id="${block.id}">开始专注</button><button class="quiet" type="button" data-planner-action="complete" data-id="${block.id}">完成时间块</button>${canCompleteSource ? `<button class="quiet" type="button" data-planner-action="complete-source" data-id="${block.id}">完成并同步来源</button>` : ""}<button class="quiet" type="button" data-planner-action="skip" data-id="${block.id}">跳过</button>` : `<button class="quiet" type="button" data-planner-action="reopen" data-id="${block.id}">重新安排</button>`}<button class="quiet" type="button" data-planner-action="lock" data-id="${block.id}">${block.locked ? "解除锁定" : "锁定时间"}</button><button class="danger" type="button" data-planner-action="delete" data-id="${block.id}">删除</button></div>`;
  }

  function renderPlannerUnscheduled() {
    const container = $("#planner-unscheduled-list");
    const items = state.plannerWeek?.unscheduled || [];
    if (!items.length) {
      container.className = "planner-unscheduled-list empty-state";
      container.textContent = "当前计划可以放入可用时间。智能排程后若出现容量不足，这里会给出明确提示。";
      return;
    }
    container.className = "planner-unscheduled-list";
    container.innerHTML = items.map((item) => `<div class="planner-unscheduled-item"><span class="planner-kind ${item.kind}">${plannerKindLabel(item.kind)}</span><div><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.reason)}</p></div><b>${item.remaining_minutes} 分钟</b></div>`).join("");
  }

  function renderPlannerPreferences() {
    const preferences = state.plannerWeek?.preferences;
    if (!preferences) return;
    $("#planner-time-zone").value = preferences.time_zone;
    $("#planner-session-minutes").value = preferences.session_minutes;
    $("#planner-break-minutes").value = preferences.break_minutes;
    $("#planner-daily-max").value = preferences.daily_max_minutes;
    $("#planner-window-list").innerHTML = (preferences.windows || []).map(renderPlannerWindowRow).join("");
  }

  function renderPlannerWindowRow(window = { weekday: 1, start_time: "19:00", end_time: "22:00" }) {
    const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    return `<div class="planner-window-row"><select data-planner-window-weekday aria-label="星期">${weekdays.map((label, index) => `<option value="${index + 1}" ${window.weekday === index + 1 ? "selected" : ""}>${label}</option>`).join("")}</select><input data-planner-window-start type="time" value="${window.start_time}" aria-label="开始时间"><span>至</span><input data-planner-window-end type="time" value="${window.end_time}" aria-label="结束时间"><button type="button" data-planner-remove-window aria-label="删除可用时段">×</button></div>`;
  }

  async function refreshPlannerWeek() {
    state.plannerWeek = await api(`/api/v1/planner/week?week_start=${encodeURIComponent(state.plannerWeekStart)}`);
    if (state.plannerWeek?.week_start) state.plannerWeekStart = state.plannerWeek.week_start;
    renderPlanner();
    renderSelects();
  }

  async function generatePlannerWeek() {
    const button = $("#planner-generate");
    button.disabled = true;
    try {
      state.plannerWeek = await api("/api/v1/planner/generate", { method: "POST", body: JSON.stringify({ week_start: state.plannerWeekStart }) });
      state.plannerWeekStart = state.plannerWeek.week_start;
      state.plannerSelectedBlockID = "";
      renderPlanner();
      notify(state.plannerWeek.unscheduled?.length ? `排程完成，还有 ${state.plannerWeek.unscheduled.length} 项超出本周容量。` : "智能排程完成，所有工作都已放入可用时间。");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function shiftPlannerWeek(days) {
    const date = new Date(`${state.plannerWeekStart}T12:00:00`);
    date.setDate(date.getDate() + days);
    state.plannerWeekStart = mondayKey(date);
    state.plannerSelectedBlockID = "";
    try { await refreshPlannerWeek(); } catch (error) { notify(error.message, "error"); }
  }

  async function plannerBlockAction(action, id) {
    const block = (state.plannerWeek?.blocks || []).find((item) => item.id === id);
    if (!block) return;
    try {
      if (action === "delete") {
        await api(`/api/v1/plan-blocks/${id}`, { method: "DELETE" });
        state.plannerSelectedBlockID = "";
      } else if (action === "move") {
        const startAt = plannerWallTimeToISO($("#planner-detail-date").value, $("#planner-detail-start").value);
        const endAt = plannerWallTimeToISO($("#planner-detail-date").value, $("#planner-detail-end").value);
        await api(`/api/v1/plan-blocks/${id}`, { method: "PATCH", body: JSON.stringify({ start_at: startAt, end_at: endAt, locked: true }) });
      } else if (action === "lock") {
        await api(`/api/v1/plan-blocks/${id}`, { method: "PATCH", body: JSON.stringify({ locked: !block.locked }) });
      } else if (action === "focus") {
        if (state.focus) {
          showView("focus");
          notify("已有正在进行的专注会话，请先完成或放弃它。", "error");
          return;
        }
        const session = await api("/api/v1/focus-sessions", { method: "POST", body: JSON.stringify({ plan_block_id: id, planned_minutes: block.planned_minutes, break_enabled: block.planned_minutes >= 40 }) });
        syncActiveFocus(session);
        await refreshPlannerWeek();
        showView("focus");
        renderFocus();
        notify("已从计划时间块开始专注，完成计时后日历会自动同步。");
        return;
      } else {
        const statuses = { complete: ["completed", false], "complete-source": ["completed", true], skip: ["skipped", false], reopen: ["planned", false] };
        const [status, completeSource] = statuses[action];
        await api(`/api/v1/plan-blocks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, complete_source: completeSource }) });
      }
      await refreshPlannerWeek();
      notify(action === "delete" ? "时间块已删除。" : "周计划已更新。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function renderLearningInsights() {
    const insights = state.learningInsights;
    if (!insights) return;
    const summary = insights.summary || {};
    $("#insights-days").value = String(state.insightsDays);
    $("#insights-consistency").textContent = summary.consistency_score ?? 0;
    $("#insights-focus-total").textContent = summary.total_focus_minutes ?? 0;
    $("#insights-adherence").textContent = `${summary.plan_adherence ?? 0}%`;
    $("#insights-active-days").textContent = `${summary.active_days ?? 0} 个活跃日`;
    $("#insights-streak").textContent = summary.learning_streak ?? 0;
    $("#insights-card-reviews").textContent = summary.card_reviews ?? 0;
    $("#insights-card-accuracy").textContent = summary.card_reviews ? `正确率 ${summary.card_accuracy}%` : "正确率 —";
    $("#insights-word-reviews").textContent = summary.vocabulary_reviews ?? 0;
    $("#insights-word-accuracy").textContent = summary.vocabulary_reviews ? `正确率 ${summary.vocabulary_accuracy}%` : "正确率 —";
    $("#insights-due-memory").textContent = Number(summary.due_cards || 0) + Number(summary.due_vocabulary || 0);
    const weekdays = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    $("#insights-peak-time").textContent = summary.peak_focus_weekday ? `${weekdays[summary.peak_focus_weekday]} ${String(summary.peak_focus_hour).padStart(2, "0")}:00` : "等待数据";

    renderInsightsTrend(insights.daily || []);
    renderInsightsHeatmap(insights.focus_heatmap || []);
    renderInsightsGoals(insights.goals || []);
    renderInsightsRecommendations(insights.recommendations || []);
    renderInsightCorrelation("mood", summary.mood_focus_correlation);
    renderInsightCorrelation("stress", summary.stress_focus_correlation);
  }

  function renderInsightsTrend(daily) {
    const container = $("#insights-trend-chart");
    if (!daily.length) {
      container.innerHTML = '<div class="empty-state">还没有趋势数据。</div>';
      return;
    }
    const width = 820;
    const height = 250;
    const left = 38;
    const right = 14;
    const top = 14;
    const bottom = 32;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const maximum = Math.max(30, ...daily.flatMap((day) => [day.focus_minutes || 0, day.completed_plan_minutes || 0]));
    const xFor = (index) => left + (daily.length === 1 ? chartWidth / 2 : index * chartWidth / (daily.length - 1));
    const yFor = (value) => top + chartHeight - Number(value || 0) / maximum * chartHeight;
    const focusPoints = daily.map((day, index) => `${xFor(index)},${yFor(day.focus_minutes)}`).join(" ");
    const planPoints = daily.map((day, index) => `${xFor(index)},${yFor(day.completed_plan_minutes)}`).join(" ");
    const grid = [0, .25, .5, .75, 1].map((ratio) => {
      const y = top + chartHeight * (1 - ratio);
      return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text x="${left - 7}" y="${y + 3}" text-anchor="end">${Math.round(maximum * ratio)}</text>`;
    }).join("");
    const labelEvery = Math.max(1, Math.ceil(daily.length / 6));
    const labels = daily.map((day, index) => index % labelEvery === 0 || index === daily.length - 1 ? `<text x="${xFor(index)}" y="${height - 8}" text-anchor="middle">${day.date.slice(5).replace("-", "/")}</text>` : "").join("");
    const focusArea = `${left},${top + chartHeight} ${focusPoints} ${width - right},${top + chartHeight}`;
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><g class="insights-chart-grid">${grid}${labels}</g><polygon class="insights-focus-area" points="${focusArea}"/><polyline class="insights-plan-line" points="${planPoints}"/><polyline class="insights-focus-line" points="${focusPoints}"/>${daily.map((day, index) => `<circle class="insights-focus-dot" cx="${xFor(index)}" cy="${yFor(day.focus_minutes)}" r="${daily.length > 45 ? 1.4 : 2.4}"><title>${day.date}：专注 ${day.focus_minutes} 分钟，完成计划 ${day.completed_plan_minutes} 分钟</title></circle>`).join("")}</svg>`;
  }

  function renderInsightsHeatmap(cells) {
    const container = $("#insights-heatmap");
    const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const hours = Array.from({ length: 18 }, (_, index) => index + 6);
    const values = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell.minutes]));
    const maximum = Math.max(1, ...cells.map((cell) => cell.minutes));
    const header = `<span></span>${hours.map((hour) => `<span class="insights-heatmap-hour">${hour % 3 === 0 ? `${String(hour).padStart(2, "0")}` : ""}</span>`).join("")}`;
    const rows = weekdays.map((weekday, weekdayIndex) => `<span class="insights-heatmap-day">${weekday}</span>${hours.map((hour) => {
      const minutes = values.get(`${weekdayIndex + 1}:${hour}`) || 0;
      const intensity = minutes ? .16 + minutes / maximum * .84 : 0;
      return `<span class="insights-heatmap-cell" style="--heat:${intensity}" title="${weekday} ${String(hour).padStart(2, "0")}:00 · ${minutes} 分钟"></span>`;
    }).join("")}`).join("");
    container.innerHTML = `<div class="insights-heatmap-grid">${header}${rows}</div><div class="insights-heatmap-scale"><span>较少</span><i style="--heat:.18"></i><i style="--heat:.4"></i><i style="--heat:.65"></i><i style="--heat:1"></i><span>较多</span></div>`;
  }

  function renderInsightsGoals(goals) {
    const container = $("#insights-goals");
    if (!goals.length) {
      container.className = "insights-goals empty-state";
      container.textContent = "创建目标并把学习任务关联过去后，这里会显示时间投入与任务完成率。";
      return;
    }
    const maxFocus = Math.max(1, ...goals.map((goal) => goal.focus_minutes));
    container.className = "insights-goals";
    container.innerHTML = goals.map((goal) => `<div class="insights-goal-row"><div><strong>${escapeHTML(goal.title)}</strong><span>${goal.completed_tasks}/${goal.total_tasks} 个任务 · 完成率 ${goal.completion_rate}%</span></div><b>${goal.focus_minutes} 分钟</b><div class="insights-goal-track"><span style="width:${goal.focus_minutes / maxFocus * 100}%"></span></div></div>`).join("");
  }

  function renderInsightsRecommendations(items) {
    const container = $("#insights-recommendations");
    container.innerHTML = items.length ? items.map((item) => `<article class="insights-recommendation ${item.level}"><span>${({ warning: "!", attention: "△", positive: "✓", info: "i" }[item.level] || "i")}</span><div><h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(item.description)}</p><small>${escapeHTML(item.evidence)}</small></div></article>`).join("") : '<div class="empty-state">继续记录学习活动后，这里会形成可行动建议。</div>';
  }

  function renderInsightCorrelation(kind, value) {
    const numeric = Number(value || 0);
    const valueElement = $(`#insights-${kind}-correlation`);
    const labelElement = $(`#insights-${kind}-correlation-label`);
    valueElement.textContent = numeric ? numeric.toFixed(2) : "—";
    if (!numeric) {
      labelElement.textContent = "至少记录 3 天后分析";
      return;
    }
    const strength = Math.abs(numeric) >= .65 ? "较强" : Math.abs(numeric) >= .35 ? "中等" : "较弱";
    labelElement.textContent = `${strength}${numeric > 0 ? "正相关" : "负相关"}`;
  }

  async function refreshLearningInsights() {
    try {
      state.learningInsights = await api(`/api/v1/analytics/learning?days=${state.insightsDays}`);
      renderLearningInsights();
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function renderWeeklyReview() {
    const review = state.weeklyReview;
    if (!review) return;
    const current = review.summary || {};
    const previous = review.previous || {};
    const comparison = review.comparison || {};
    const compactDate = (value) => value ? value.slice(5).replace("-", "/") : "—";
    const signed = (value, suffix = "") => `${Number(value || 0) > 0 ? "+" : ""}${Number(value || 0).toFixed(suffix === "%" ? 1 : 0)}${suffix}`;
    $("#weekly-review-range").textContent = `${compactDate(review.week_start)}–${compactDate(review.week_end)}，对比 ${compactDate(review.compared_from)}–${compactDate(review.compared_to)}（相同已过天数）`;
    $("#weekly-review-next").disabled = review.week_start >= mondayKey(new Date());
    const metrics = [
      ["有效专注", `${current.focus_minutes || 0} 分钟`, signed(comparison.focus_minutes_delta), previous.focus_minutes || 0],
      ["活跃学习日", `${current.active_days || 0} 天`, signed(comparison.active_days_delta), previous.active_days || 0],
      ["计划执行率", `${Number(current.plan_adherence || 0).toFixed(1)}%`, signed(comparison.plan_adherence_delta, "%"), `${Number(previous.plan_adherence || 0).toFixed(1)}%`],
      ["完成事项", String(Number(current.tasks_completed || 0) + Number(current.todos_completed || 0)), signed(comparison.completed_items_delta), Number(previous.tasks_completed || 0) + Number(previous.todos_completed || 0)],
      ["记忆复习", `${current.memory_reviews || 0} 次`, signed(comparison.memory_reviews_delta), previous.memory_reviews || 0],
      ["稳定性", `${current.consistency_score || 0}/100`, "本周", `${previous.consistency_score || 0}/100`],
    ];
    $("#weekly-review-comparison").innerHTML = metrics.map(([label, value, delta, prior]) => {
      const numericDelta = Number(String(delta).replace(/[+%]/g, ""));
      const direction = numericDelta > 0 ? "up" : numericDelta < 0 ? "down" : "flat";
      return `<article><span>${label}</span><strong>${value}</strong><small class="${direction}">${delta} · 上期 ${prior}</small></article>`;
    }).join("");
    const highlights = review.highlights || [];
    const highlightIcons = { win: "✓", risk: "!", info: "i" };
    $("#weekly-review-highlights").className = "weekly-highlights";
    $("#weekly-review-highlights").innerHTML = highlights.map((item) => `<article class="${item.kind}"><span>${highlightIcons[item.kind] || "i"}</span><div><h5>${escapeHTML(item.title)}</h5><p>${escapeHTML(item.description)}</p><small>${escapeHTML(item.evidence)}</small></div></article>`).join("");
    const reflection = review.reflection || {};
    $("#weekly-satisfaction").value = reflection.satisfaction ? String(reflection.satisfaction) : "";
    $("#weekly-wins").value = reflection.wins || "";
    $("#weekly-challenges").value = reflection.challenges || "";
    $("#weekly-lessons").value = reflection.lessons || "";
    $("#weekly-priorities").value = (reflection.next_week_priorities || []).join("\n");
    $("#weekly-reflection-status").textContent = review.reflection_saved ? `已保存 · ${formatDate(reflection.updated_at, true)}` : "尚未保存这一周的复盘";
  }

  async function refreshWeeklyReview() {
    state.weeklyReview = await api(`/api/v1/reviews/weekly?week_start=${encodeURIComponent(state.weeklyReviewWeekStart)}`);
    renderWeeklyReview();
  }

  async function shiftWeeklyReview(days) {
    const date = new Date(`${state.weeklyReviewWeekStart}T12:00:00`);
    date.setDate(date.getDate() + days);
    const next = mondayKey(date);
    if (next > mondayKey(new Date())) return;
    state.weeklyReviewWeekStart = next;
    try {
      await refreshWeeklyReview();
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function saveWeeklyReflection(event) {
    event.preventDefault();
    const priorities = $("#weekly-priorities").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (priorities.length > 5) {
      notify("下周优先事项最多填写 5 项，请每行填写一项。", "error");
      return;
    }
    try {
      await api("/api/v1/reviews/weekly/reflection", { method: "PUT", body: JSON.stringify({
        week_start: state.weeklyReviewWeekStart,
        satisfaction: Number($("#weekly-satisfaction").value),
        wins: $("#weekly-wins").value,
        challenges: $("#weekly-challenges").value,
        lessons: $("#weekly-lessons").value,
        next_week_priorities: priorities,
      }) });
      await refreshWeeklyReview();
      notify("每周复盘已保存，可以随时返回这一周继续修改。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

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
    const overview = state.vocabularyOverview || {};
    const currentBook = state.wordBooks.find((book) => book.id === state.vocabularyBookID);
    const word = currentVocabularyWord();
    $("#vocab-due-count").textContent = overview.due_today ?? 0;
    $("#vocab-reviewed-count").textContent = overview.reviewed_today ?? 0;
    $("#vocab-accuracy").textContent = overview.reviewed_today ? `${overview.accuracy_today ?? 0}%` : "—";
    $("#vocab-streak").textContent = `${overview.study_streak ?? 0} 天`;
    $("#vocab-study-book").textContent = currentBook?.name || "开始今日学习";
    $("#vocab-queue-progress").textContent = word ? `待复习 ${state.vocabularyQueue.length}` : "今日完成";

    $("#vocab-books").innerHTML = state.wordBooks.map((book) => {
      const count = book.id === state.vocabularyBookID ? `${state.vocabularyWords.length} 词` : `每日 ${book.daily_new_limit} 新词`;
      return `<button class="vocab-book-button ${book.id === state.vocabularyBookID ? "active" : ""}" type="button" data-vocab-book="${book.id}"><span><strong>${escapeHTML(book.name)}</strong><small>${escapeHTML(book.description || book.language?.toUpperCase() || "词书")}</small></span><b>${count}</b></button>`;
    }).join("");

    $$('[data-vocab-mode]').forEach((button) => button.classList.toggle("active", button.dataset.vocabMode === state.vocabularyMode));
    $("#vocab-empty").classList.toggle("hidden", Boolean(word));
    $("#vocab-study").classList.toggle("hidden", !word);
    $("#vocab-flashcard-mode").classList.toggle("hidden", state.vocabularyMode !== "flashcard");
    $("#vocab-spelling-mode").classList.toggle("hidden", state.vocabularyMode !== "spelling");

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
      $("#vocab-spelling-input").disabled = state.vocabularyRevealed;
      if (!state.vocabularyRevealed) {
        $("#vocab-spelling-input").value = "";
        $("#vocab-spelling-result").textContent = "";
        $("#vocab-spelling-result").className = "vocab-spelling-result";
      }
    }

    const search = state.vocabularySearch.toLowerCase();
    const words = state.vocabularyWords.filter((item) => {
      const matchesStage = !state.vocabularyStage || item.stage === state.vocabularyStage;
      const matchesSearch = !search || item.term.toLowerCase().includes(search) || item.definition.toLowerCase().includes(search);
      return matchesStage && matchesSearch;
    });
    const library = $("#vocab-word-list");
    if (!words.length) {
      library.className = "vocab-word-list empty-state";
      library.textContent = state.vocabularyWords.length ? "没有匹配筛选条件的单词。" : "词库中还没有单词。";
    } else {
      library.className = "vocab-word-list";
      library.innerHTML = words.map((item) => `<article class="vocab-word-row"><div class="vocab-word-main"><div><h4>${escapeHTML(item.term)}</h4>${item.phonetic ? `<span>${escapeHTML(item.phonetic)}</span>` : ""}</div><p>${escapeHTML(item.definition)}</p>${(item.tags || []).map((tag) => `<span class="tag">#${escapeHTML(tag)}</span>`).join("")}</div><div class="vocab-word-meta"><span class="vocab-stage ${item.stage}">${vocabularyStageLabel(item.stage)}</span><small>${item.stage === "new" ? `创建于 ${formatDate(item.created_at)}` : `下次 ${formatDate(item.due_at, true)}`}</small><button class="vocab-delete" type="button" data-vocab-delete="${item.id}" aria-label="删除单词 ${escapeHTML(item.term)}" title="删除单词">×</button></div></article>`).join("");
    }
  }

  async function refreshVocabulary() {
    if (!state.vocabularyBookID) return;
    const bookQuery = `book_id=${encodeURIComponent(state.vocabularyBookID)}`;
    const [words, queue, overview] = await Promise.all([
      api(`/api/v1/words?${bookQuery}`),
      api(`/api/v1/words/queue?${bookQuery}&limit=100`),
      api(`/api/v1/vocabulary/overview?${bookQuery}`),
    ]);
    state.vocabularyWords = words || [];
    state.vocabularyQueue = queue || [];
    state.vocabularyOverview = overview || null;
    state.vocabularyRevealed = false;
    renderVocabulary();
  }

  async function selectVocabularyBook(bookID) {
    if (!bookID || bookID === state.vocabularyBookID) return;
    state.vocabularyBookID = bookID;
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
    const word = currentVocabularyWord();
    if (!word || !state.vocabularyRevealed) return;
    try {
      await api(`/api/v1/words/${word.id}/reviews`, { method: "POST", body: JSON.stringify({ rating, mode: state.vocabularyMode }) });
      await refreshVocabulary();
      notify("已记录这次回忆，系统会在合适的时间再次提醒。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function deleteVocabularyWord(id) {
    try {
      await api(`/api/v1/words/${id}`, { method: "DELETE" });
      await refreshVocabulary();
      notify("单词已从词书中删除。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function renderReview() {
    const container = $("#due-cards-list");
    $("#due-count").textContent = `${state.dueCards.length} 张`;
    if (!state.dueCards.length) {
      container.className = "review-list empty-state";
      container.textContent = "现在没有待复习卡片。添加卡片后，它会在合适的时间回来找你。";
      return;
    }
    container.className = "review-list";
    container.innerHTML = state.dueCards.map((card) => `<article class="review-card"><h4>${escapeHTML(card.prompt)}</h4><div class="review-answer">${escapeHTML(card.answer)}</div><p class="hint">已复习 ${card.repetitions} 次 · 当前间隔 ${card.interval_days || 0} 天</p><div class="rating-actions"><button class="rating" type="button" data-rate="1" data-id="${card.id}">忘记了</button><button class="rating" type="button" data-rate="2" data-id="${card.id}">困难</button><button class="rating" type="button" data-rate="3" data-id="${card.id}">良好</button><button class="rating" type="button" data-rate="4" data-id="${card.id}">简单</button></div></article>`).join("");
  }

  function renderFocus() {
    const active = state.focus;
    const form = $("#focus-form");
    const paused = active?.status === "paused";
    const updating = state.isFinishingFocus || state.isUpdatingFocus;
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
    form.querySelectorAll("input,select").forEach((field) => { field.disabled = Boolean(active); });
    $$("[data-focus-duration]").forEach((button) => { button.disabled = Boolean(active); });
    renderFocusProgress();
    renderFocusTaskPreview();
    if (!active) {
      renderReadyCountdown();
      $("#focus-session-step").textContent = "准备开始";
      stateLabel.textContent = "尚未开始专注";
      stateLabel.className = "focus-state is-idle";
      $("#focus-description").textContent = "选择一个任务和时长，开始第一段深度工作。";
      return;
    }
    const task = state.tasks.find((item) => item.id === active.taskID);
    $("#focus-session-step").textContent = focusSessionStep(active);
    stateLabel.textContent = paused ? `${focusPhaseLabel(active.phase)} · 已暂停` : focusPhaseLabel(active.phase);
    stateLabel.className = `focus-state ${paused ? "is-paused" : active.phase === "break" ? "is-break" : "is-running"}`;
    const taskDescription = task ? `当前任务：${task.title}` : "正在进行一段不关联任务的专注时间。";
    $("#focus-description").textContent = active.phase === "break" ? "休息 5 分钟，放松一下再继续。" : taskDescription;
    updateFocusClock();
  }

  function renderReadyCountdown() {
    const plannedMinutes = clampPlannedMinutes($("#focus-minutes").value);
    $("#focus-clock").textContent = formatDuration(plannedMinutes * 60);
    $("#focus-timer").style.setProperty("--progress", "0%");
    renderFocusTicks(0);
  }

  function updateFocusClock() {
    if (!state.focus) {
      if (state.user) renderReadyCountdown();
      return;
    }
    const totalSeconds = phaseTotalSeconds(state.focus);
    const remainingSeconds = phaseRemainingSeconds(state.focus);
    const progress = Math.min(100, ((totalSeconds - remainingSeconds) / totalSeconds) * 100);
    $("#focus-clock").textContent = formatDuration(remainingSeconds);
    $("#focus-timer").style.setProperty("--progress", `${progress}%`);
    renderFocusTicks(progress);
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
    return ({ focus_first: "第 1 段 / 共 3 段", break: "休息 / 共 3 段", focus_second: "第 3 段 / 共 3 段" }[focus.phase] || "专注时段");
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
    const tasks = state.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").slice(0, 5);
    const selectedTaskID = state.focus?.taskID || $("#focus-task")?.value;
    if (!tasks.length) {
      container.className = "focus-task-preview empty-state";
      container.textContent = "还没有待办任务。先创建一项足够小、可以立刻开始的任务。";
      return;
    }
    container.className = "focus-task-preview";
    container.innerHTML = tasks.map((task) => `<button class="focus-task-item ${task.id === selectedTaskID ? "selected" : ""}" type="button" data-focus-task-select="${task.id}" ${state.focus ? "disabled" : ""}><span class="focus-task-check" aria-hidden="true"></span><span class="focus-task-content"><strong>${escapeHTML(task.title)}</strong><small>${task.estimated_minutes ? `预计 ${task.estimated_minutes} 分钟` : "未设置预计时长"}</small></span><span class="priority-${task.priority}">●</span></button>`).join("");
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
    const goalSelect = $("#task-goal");
    const previousGoal = goalSelect.value;
    goalSelect.innerHTML = `<option value="">不关联目标</option>${state.goals.filter((goal) => goal.status === "active").map((goal) => `<option value="${goal.id}">${escapeHTML(goal.title)}</option>`).join("")}`;
    goalSelect.value = state.goals.some((goal) => goal.id === previousGoal) ? previousGoal : "";

    const taskOptions = state.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").map((task) => `<option value="${task.id}">${escapeHTML(task.title)}</option>`).join("");
    const focusTask = $("#focus-task");
    const previousTask = focusTask.value;
    focusTask.innerHTML = `<option value="">不关联任务</option>${taskOptions}`;
    focusTask.value = state.tasks.some((task) => task.id === previousTask) ? previousTask : "";

    const deckSelect = $("#card-deck");
    const previousDeck = deckSelect.value;
    deckSelect.innerHTML = state.decks.length
      ? `<option value="">选择卡组</option>${state.decks.map((deck) => `<option value="${deck.id}">${escapeHTML(deck.name)}</option>`).join("")}`
      : "<option value=\"\">请先创建卡组</option>";
    deckSelect.value = state.decks.some((deck) => deck.id === previousDeck) ? previousDeck : "";

    const todoList = $("#todo-list");
    const previousTodoList = todoList.value;
    todoList.innerHTML = state.todoLists.map((list) => `<option value="${list.id}">${escapeHTML(list.name)}${list.kind === "inbox" ? "（收集箱）" : ""}</option>`).join("");
    todoList.value = state.todoLists.some((list) => list.id === previousTodoList) ? previousTodoList : (state.todoLists[0]?.id || "");

    const vocabularyBook = $("#vocab-word-book");
    const previousVocabularyBook = vocabularyBook.value;
    vocabularyBook.innerHTML = state.wordBooks.map((book) => `<option value="${book.id}">${escapeHTML(book.name)}</option>`).join("");
    vocabularyBook.value = state.wordBooks.some((book) => book.id === previousVocabularyBook)
      ? previousVocabularyBook
      : state.vocabularyBookID;

    renderPlannerSourceSelect();
  }

  function renderPlannerSourceSelect() {
    const kind = $("#planner-block-kind").value;
    const field = $("#planner-source-field");
    const select = $("#planner-block-source");
    const previous = select.value;
    let items = [];
    if (kind === "task") items = state.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").map((task) => ({ id: task.id, title: task.title }));
    if (kind === "todo") items = state.todos.filter((todo) => todo.status === "open").map((todo) => ({ id: todo.id, title: todo.title }));
    field.classList.toggle("hidden", kind !== "task" && kind !== "todo");
    select.required = kind === "task" || kind === "todo";
    select.innerHTML = items.map((item) => `<option value="${item.id}">${escapeHTML(item.title)}</option>`).join("");
    select.value = items.some((item) => item.id === previous) ? previous : (items[0]?.id || "");
  }

  const taskStatusLabel = (status) => ({ todo: "待开始", in_progress: "进行中", done: "已完成", cancelled: "已取消" }[status] || status);
  const goalStatusLabel = (status) => ({ active: "进行中", completed: "已完成", archived: "已归档" }[status] || status);
  const priorityLabel = (priority) => ({ high: "高", medium: "中", low: "低" }[priority] || priority);

  async function submitForm(event, action, success) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await action();
      form.reset();
      await refresh();
      notify(success);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function bindEvents() {
    $$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => authTab(button.dataset.authTab)));
    $("#theme-toggle").addEventListener("click", toggleTheme);
    $("#logout").addEventListener("click", () => { leaveApp(); notify("已退出登录"); });
    $("#mobile-menu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
    $$("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
    document.addEventListener("click", async (event) => {
      const goto = event.target.closest("[data-goto]");
      if (goto) showView(goto.dataset.goto);
      const goalButton = event.target.closest("[data-goal-status]");
      if (goalButton) await changeGoalStatus(goalButton.dataset.id, goalButton.dataset.goalStatus);
      const deleteGoalButton = event.target.closest("[data-goal-delete]");
      if (deleteGoalButton) await deleteGoal(deleteGoalButton.dataset.goalDelete);
      const goalCard = event.target.closest("[data-goal-swipe-card]");
      if (goalCard && !event.target.closest("button")) toggleGoalActions(goalCard);
      const taskButton = event.target.closest("[data-task-status]");
      if (taskButton) await changeTaskStatus(taskButton.dataset.id, taskButton.dataset.taskStatus);
      const deleteTaskButton = event.target.closest("[data-task-delete]");
      if (deleteTaskButton) await deleteTask(deleteTaskButton.dataset.taskDelete);
      const taskCard = event.target.closest("[data-task-swipe-card]");
      if (taskCard && !event.target.closest("button")) toggleTaskActions(taskCard);
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
      const plannerBlock = event.target.closest("[data-planner-block]");
      if (plannerBlock) {
        state.plannerSelectedBlockID = plannerBlock.dataset.plannerBlock;
        renderPlannerCalendar();
        renderPlannerDetail();
      }
      const plannerAction = event.target.closest("[data-planner-action]");
      if (plannerAction) await plannerBlockAction(plannerAction.dataset.plannerAction, plannerAction.dataset.id);
      const removePlannerWindow = event.target.closest("[data-planner-remove-window]");
      if (removePlannerWindow) removePlannerWindow.closest(".planner-window-row")?.remove();
      const vocabularyBook = event.target.closest("[data-vocab-book]");
      if (vocabularyBook) await selectVocabularyBook(vocabularyBook.dataset.vocabBook);
      const vocabularyMode = event.target.closest("[data-vocab-mode]");
      if (vocabularyMode) {
        state.vocabularyMode = vocabularyMode.dataset.vocabMode;
        state.vocabularyRevealed = false;
        renderVocabulary();
        if (state.vocabularyMode === "spelling") $("#vocab-spelling-input").focus();
      }
      const vocabularyRating = event.target.closest("[data-vocab-rating]");
      if (vocabularyRating) await reviewVocabularyWord(Number(vocabularyRating.dataset.vocabRating));
      const vocabularyDelete = event.target.closest("[data-vocab-delete]");
      if (vocabularyDelete) await deleteVocabularyWord(vocabularyDelete.dataset.vocabDelete);
      const rating = event.target.closest("[data-rate]");
      if (rating) await reviewCard(rating.dataset.id, Number(rating.dataset.rate));
      const goalPageButton = event.target.closest("[data-goal-page]");
      if (goalPageButton && !goalPageButton.disabled) await updateGoalQuery({ page: Number(goalPageButton.dataset.goalPage) });
      const focusTaskButton = event.target.closest("[data-focus-task-select]");
      if (focusTaskButton && !state.focus) {
        $("#focus-task").value = focusTaskButton.dataset.focusTaskSelect;
        renderFocusTaskPreview();
        notify("已关联该任务，设置时长后即可开始专注。");
      }
      const moodDay = event.target.closest("[data-mood-date]");
      if (moodDay) {
        state.moodSelectedDate = moodDay.dataset.moodDate;
        renderMoods();
      }
      const moodChoice = event.target.closest("[data-mood-choice]");
      if (moodChoice) {
        $("#mood-value").value = moodChoice.dataset.moodChoice;
        $$('[data-mood-choice]').forEach((button) => {
          const selected = button === moodChoice;
          button.classList.toggle("selected", selected);
          button.setAttribute("aria-checked", String(selected));
        });
      }
      const moodActivity = event.target.closest("[data-mood-activity]");
      if (moodActivity) moodActivity.classList.toggle("selected");
    });
    document.addEventListener("keydown", (event) => {
      const taskCard = event.target.closest?.("[data-task-swipe-card]");
      if (taskCard && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        toggleTaskActions(taskCard);
      }
      const goalCard = event.target.closest?.("[data-goal-swipe-card]");
      if (goalCard && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        toggleGoalActions(goalCard);
      }
      if (state.currentView !== "vocabulary" || event.target.closest?.("input, textarea, select, button")) return;
      if (event.key === " " && currentVocabularyWord() && !state.vocabularyRevealed) {
        event.preventDefault();
        state.vocabularyRevealed = true;
        renderVocabulary();
      }
      if (/^[1-4]$/.test(event.key) && state.vocabularyRevealed) {
        event.preventDefault();
        reviewVocabularyWord(Number(event.key));
      }
    });
    $("#task-filter").addEventListener("change", renderTasks);
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
    $("#vocab-search").addEventListener("input", () => {
      state.vocabularySearch = $("#vocab-search").value.trim();
      renderVocabulary();
    });
    $("#vocab-stage-filter").addEventListener("change", () => {
      state.vocabularyStage = $("#vocab-stage-filter").value;
      renderVocabulary();
    });
    $("#vocab-reveal").addEventListener("click", () => {
      state.vocabularyRevealed = true;
      renderVocabulary();
    });
    $("#vocab-speak").addEventListener("click", speakVocabularyWord);
    $("#planner-prev-week").addEventListener("click", () => shiftPlannerWeek(-7));
    $("#planner-current-week").addEventListener("click", () => {
      state.plannerWeekStart = mondayKey(new Date());
      state.plannerSelectedBlockID = "";
      refreshPlannerWeek().catch((error) => notify(error.message, "error"));
    });
    $("#planner-next-week").addEventListener("click", () => shiftPlannerWeek(7));
    $("#planner-generate").addEventListener("click", generatePlannerWeek);
    $("#planner-settings-toggle").addEventListener("click", () => {
      state.plannerSettingsOpen = !state.plannerSettingsOpen;
      renderPlanner();
    });
    $("#planner-add-window").addEventListener("click", () => {
      $("#planner-window-list").insertAdjacentHTML("beforeend", renderPlannerWindowRow());
    });
    $("#planner-reset-preferences").addEventListener("click", () => {
      const windows = [];
      for (let weekday = 1; weekday <= 5; weekday += 1) windows.push({ weekday, start_time: "19:00", end_time: "22:00" });
      for (let weekday = 6; weekday <= 7; weekday += 1) windows.push({ weekday, start_time: "09:00", end_time: "12:00" }, { weekday, start_time: "14:00", end_time: "18:00" });
      $("#planner-time-zone").value = "Asia/Shanghai";
      $("#planner-session-minutes").value = 50;
      $("#planner-break-minutes").value = 10;
      $("#planner-daily-max").value = 180;
      $("#planner-window-list").innerHTML = windows.map(renderPlannerWindowRow).join("");
    });
    $("#planner-block-kind").addEventListener("change", () => {
      renderPlannerSourceSelect();
      const kind = $("#planner-block-kind").value;
      if (kind === "review") $("#planner-block-title").value = "知识卡片复习";
      if (kind === "vocabulary") $("#planner-block-title").value = "单词学习";
      if (kind === "task" || kind === "todo") {
        const selected = $("#planner-block-source").selectedOptions[0];
        if (selected) $("#planner-block-title").value = selected.textContent;
      }
    });
    $("#planner-block-source").addEventListener("change", () => {
      const selected = $("#planner-block-source").selectedOptions[0];
      if (selected) $("#planner-block-title").value = selected.textContent;
    });
    $("#insights-days").addEventListener("change", () => {
      state.insightsDays = Number($("#insights-days").value);
      refreshLearningInsights();
    });
    $("#weekly-review-prev").addEventListener("click", () => shiftWeeklyReview(-7));
    $("#weekly-review-current").addEventListener("click", () => {
      state.weeklyReviewWeekStart = mondayKey(new Date());
      refreshWeeklyReview().catch((error) => notify(error.message, "error"));
    });
    $("#weekly-review-next").addEventListener("click", () => shiftWeeklyReview(7));
    $("#weekly-reflection-form").addEventListener("submit", saveWeeklyReflection);
    $("#export-learning-csv").addEventListener("click", async () => {
      try {
        await downloadAuthenticated(`/api/v1/exports/learning.csv?days=${state.insightsDays}`, `studyflow-learning-${state.insightsDays}d.csv`);
        notify("学习统计 CSV 已导出。");
      } catch (error) { notify(error.message, "error"); }
    });
    $("#export-plan-ics").addEventListener("click", async () => {
      try {
        await downloadAuthenticated(`/api/v1/exports/planner.ics?week_start=${encodeURIComponent(state.plannerWeekStart)}`, `studyflow-plan-${state.plannerWeekStart}.ics`);
        notify("周计划日历文件已导出，可导入系统日历。");
      } catch (error) { notify(error.message, "error"); }
    });
    $("#export-backup-json").addEventListener("click", async () => {
      try {
        await downloadAuthenticated("/api/v1/exports/data", `studyflow-backup-${localDateKey(new Date())}.json`);
        notify("不含密码的完整个人数据备份已导出。");
      } catch (error) { notify(error.message, "error"); }
    });
    $("#vocab-spelling-mode").addEventListener("submit", (event) => {
      event.preventDefault();
      const word = currentVocabularyWord();
      if (!word || state.vocabularyRevealed) return;
      const expected = word.term.trim().toLocaleLowerCase();
      const actual = $("#vocab-spelling-input").value.trim().toLocaleLowerCase();
      const correct = actual === expected;
      state.vocabularyRevealed = true;
      renderVocabulary();
      const result = $("#vocab-spelling-result");
      result.textContent = correct ? "拼写正确！请根据回忆难度选择下方反馈。" : `正确拼写：${word.term}`;
      result.className = `vocab-spelling-result ${correct ? "correct" : "incorrect"}`;
    });
    $("#goal-status-filter").addEventListener("change", () => updateGoalQuery({ status: $("#goal-status-filter").value, page: 1 }));
    $("#goal-sort").addEventListener("change", () => updateGoalQuery({ sort: $("#goal-sort").value, page: 1 }));
    $("#goal-order").addEventListener("change", () => updateGoalQuery({ order: $("#goal-order").value, page: 1 }));
    $$("[data-focus-duration]").forEach((button) => button.addEventListener("click", () => {
      $("#focus-minutes").value = button.dataset.focusDuration;
      renderReadyCountdown();
    }));
    $("#focus-minutes").addEventListener("input", () => {
      if (!state.focus) renderReadyCountdown();
    });
    $("#focus-task").addEventListener("change", renderFocusTaskPreview);
    $("#mood-prev-month").addEventListener("click", () => shiftMoodMonth(-1));
    $("#mood-next-month").addEventListener("click", () => shiftMoodMonth(1));
    $("#mood-stress").addEventListener("input", () => { $("#mood-stress-value").textContent = $("#mood-stress").value; });
    $("#mood-energy").addEventListener("input", () => { $("#mood-energy-value").textContent = $("#mood-energy").value; });
    $("#mood-form").addEventListener("submit", saveMoodEntry);
    $("#delete-mood-entry").addEventListener("click", deleteMoodEntry);
    $("#edit-daily-goal").addEventListener("click", () => {
      const form = $("#daily-goal-form");
      form.classList.toggle("hidden");
      if (!form.classList.contains("hidden")) {
        $("#daily-goal-minutes").value = state.dailyFocusGoalMinutes;
        $("#daily-goal-minutes").focus();
        $("#daily-goal-minutes").select();
      }
    });
    $("#daily-goal-form").addEventListener("submit", (event) => {
      event.preventDefault();
      state.dailyFocusGoalMinutes = clampDailyFocusGoal($("#daily-goal-minutes").value);
      persistDailyFocusGoal();
      $("#daily-goal-form").classList.add("hidden");
      renderFocusProgress();
      notify(`每日专注目标已设置为 ${state.dailyFocusGoalMinutes} 分钟。`);
    });

    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value }) });
        state.token = result.token;
        localStorage.setItem("studyflow.token", state.token);
        enterApp(result.user);
        notify(`欢迎回来，${result.user.name}`);
      } catch (error) { notify(error.message, "error"); }
    });
    $("#register-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ name: $("#register-name").value, email: $("#register-email").value, password: $("#register-password").value }) });
        state.token = result.token;
        localStorage.setItem("studyflow.token", state.token);
        enterApp(result.user);
        notify("账号创建成功，开始你的学习计划吧。");
      } catch (error) { notify(error.message, "error"); }
    });

    $("#goal-form").addEventListener("submit", (event) => {
      state.goalQuery.page = 1;
      return submitForm(event, () => api("/api/v1/goals", { method: "POST", body: JSON.stringify({ title: $("#goal-title").value, description: $("#goal-description").value, deadline: toISO($("#goal-deadline").value) }) }), "目标已创建。");
    });
    $("#task-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/tasks", { method: "POST", body: JSON.stringify({ goal_id: $("#task-goal").value, title: $("#task-title").value, description: $("#task-description").value, estimated_minutes: Number($("#task-minutes").value || 0), priority: $("#task-priority").value, due_at: toISO($("#task-due").value), tags: $("#task-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean) }) }), "任务已创建。"));
    $("#todo-list-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/todo-lists", { method: "POST", body: JSON.stringify({ name: $("#todo-list-name").value, color: $("#todo-list-color").value }) }), "分类已创建。"));
    $("#todo-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/todos", { method: "POST", body: JSON.stringify({ list_id: $("#todo-list").value, title: $("#todo-title").value, notes: $("#todo-notes").value, priority: $("#todo-priority").value, due_at: toISO($("#todo-due").value), my_day_date: $("#todo-my-day").checked ? localDateKey(new Date()) : "", repeat_rule: $("#todo-repeat").value, tags: $("#todo-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean), steps: $("#todo-steps").value.split("\n").map((step) => step.trim()).filter(Boolean) }) }), "待办已加入清单。"));
    $("#vocab-book-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/word-books", { method: "POST", body: JSON.stringify({ name: $("#vocab-book-name").value, description: $("#vocab-book-description").value, language: "en", daily_new_limit: Number($("#vocab-book-limit").value || 15) }) }), "词书已创建。"));
    $("#vocab-word-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button[type=submit]");
      const bookID = $("#vocab-word-book").value;
      button.disabled = true;
      try {
        await api(`/api/v1/word-books/${bookID}/words`, { method: "POST", body: JSON.stringify({
          term: $("#vocab-word-term").value,
          phonetic: $("#vocab-word-phonetic").value,
          definition: $("#vocab-word-definition").value,
          example: $("#vocab-word-example").value,
          example_translation: $("#vocab-word-example-translation").value,
          tags: $("#vocab-word-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
          notes: $("#vocab-word-notes").value,
        }) });
        form.reset();
        state.vocabularyBookID = bookID;
        await refreshVocabulary();
        renderSelects();
        notify("单词已加入词书，今天就可以开始学习。");
      } catch (error) {
        notify(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
    $("#planner-block-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const kind = $("#planner-block-kind").value;
        const date = $("#planner-block-date").value;
        const startAt = plannerWallTimeToISO(date, $("#planner-block-start").value);
        const endAt = plannerWallTimeToISO(date, $("#planner-block-end").value);
        await api("/api/v1/plan-blocks", { method: "POST", body: JSON.stringify({
          kind, source_id: kind === "task" || kind === "todo" ? $("#planner-block-source").value : "",
          title: $("#planner-block-title").value, notes: $("#planner-block-notes").value,
          start_at: startAt, end_at: endAt, priority: $("#planner-block-priority").value, locked: $("#planner-block-locked").checked,
        }) });
        form.reset();
        $("#planner-block-start").value = "19:00";
        $("#planner-block-end").value = "19:50";
        $("#planner-block-locked").checked = true;
        await refreshPlannerWeek();
        notify("时间块已加入本周计划。");
      } catch (error) {
        notify(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
    $("#planner-preferences-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const windows = $$(".planner-window-row").map((row) => ({
          weekday: Number(row.querySelector("[data-planner-window-weekday]").value),
          start_time: row.querySelector("[data-planner-window-start]").value,
          end_time: row.querySelector("[data-planner-window-end]").value,
        }));
        await api("/api/v1/planner/preferences", { method: "PUT", body: JSON.stringify({
          time_zone: $("#planner-time-zone").value, session_minutes: Number($("#planner-session-minutes").value),
          break_minutes: Number($("#planner-break-minutes").value), daily_max_minutes: Number($("#planner-daily-max").value), windows,
        }) });
        state.plannerWeek = await api("/api/v1/planner/generate", { method: "POST", body: JSON.stringify({ week_start: state.plannerWeekStart }) });
        state.plannerWeekStart = state.plannerWeek.week_start;
        state.plannerSettingsOpen = false;
        renderPlanner();
        notify("规划偏好已保存，并已按新规则重新排程。");
      } catch (error) {
        notify(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
    $("#deck-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/decks", { method: "POST", body: JSON.stringify({ name: $("#deck-name").value, description: $("#deck-description").value }) }), "卡组已创建。"));
    $("#card-form").addEventListener("submit", (event) => submitForm(event, () => api(`/api/v1/decks/${$("#card-deck").value}/cards`, { method: "POST", body: JSON.stringify({ prompt: $("#card-prompt").value, answer: $("#card-answer").value }) }), "复习卡已添加，今天就可以开始复习。"));
    $("#focus-form").addEventListener("submit", startFocus);
    $("#pause-focus").addEventListener("click", pauseFocus);
    $("#resume-focus").addEventListener("click", resumeFocus);
    $("#finish-focus").addEventListener("click", () => finishFocus(false));
    $("#abandon-focus").addEventListener("click", () => finishFocus(true));
  }

  async function updateGoalQuery(nextQuery) {
    const page = Math.max(1, Number(nextQuery.page ?? state.goalQuery.page));
    state.goalQuery = { ...state.goalQuery, ...nextQuery, page };
    try {
      await refresh();
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function changeGoalStatus(id, status) {
    try { await api(`/api/v1/goals/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); await refresh(); notify("目标状态已更新。"); }
    catch (error) { notify(error.message, "error"); }
  }

  async function deleteGoal(id) {
    try {
      await api(`/api/v1/goals/${id}`, { method: "DELETE" });
      if (state.goalPage.length === 1 && state.goalQuery.page > 1) state.goalQuery.page -= 1;
      await refresh();
      notify("目标已删除，关联任务会保留在任务列表中。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function changeTaskStatus(id, status) {
    try { await api(`/api/v1/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); await refresh(); notify("任务状态已更新。"); }
    catch (error) { notify(error.message, "error"); }
  }

  async function deleteTask(id) {
    try {
      await api(`/api/v1/tasks/${id}`, { method: "DELETE" });
      await refresh();
      notify("任务已删除。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function changeTodoCompletion(id, completed) {
    try {
      await api(`/api/v1/todos/${id}/status`, { method: "PATCH", body: JSON.stringify({ completed }) });
      await refresh();
      notify(completed ? "待办已完成。" : "待办已重新打开。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function changeTodoMyDay(id, action) {
    try {
      if (action === "add") {
        await api(`/api/v1/todos/${id}/my-day`, { method: "PUT", body: JSON.stringify({ date: localDateKey(new Date()) }) });
      } else {
        await api(`/api/v1/todos/${id}/my-day`, { method: "DELETE" });
      }
      await refresh();
      notify(action === "add" ? "已加入今天的计划。" : "已移出今天的计划。");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function changeTodoStep(todoID, stepID, completed) {
    try {
      await api(`/api/v1/todos/${todoID}/steps/${stepID}`, { method: "PATCH", body: JSON.stringify({ completed }) });
      await refresh();
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function deleteTodo(id) {
    try {
      await api(`/api/v1/todos/${id}`, { method: "DELETE" });
      await refresh();
      notify("待办已删除。");
    } catch (error) {
      notify(error.message, "error");
    }
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

  async function reviewCard(id, rating) {
    try { await api(`/api/v1/cards/${id}/reviews`, { method: "POST", body: JSON.stringify({ rating }) }); await refresh(); notify("复习已记录，下次见。"); }
    catch (error) { notify(error.message, "error"); }
  }

  async function startFocus(event) {
    event.preventDefault();
    if (state.focus) return;
    const button = $("#start-focus");
    button.disabled = true;
    try {
      const plannedMinutes = clampPlannedMinutes($("#focus-minutes").value);
      const breakEnabled = $("#focus-break-enabled").checked;
      const session = await api("/api/v1/focus-sessions", { method: "POST", body: JSON.stringify({ task_id: $("#focus-task").value, planned_minutes: plannedMinutes, break_enabled: breakEnabled }) });
      state.focus = { id: session.id, completeTask: $("#focus-complete-task").checked };
      syncActiveFocus(session);
      renderFocus();
      notify(breakEnabled ? "倒计时已开始：前半段专注后将自动休息 5 分钟。" : `${session.planned_minutes} 分钟倒计时已开始，享受这一段不被打扰的时间。`);
    } catch (error) {
      notify(error.message, "error");
      button.disabled = false;
    }
  }

  async function pauseFocus() {
    await updateFocusSession("pause", "已暂停，时间不会继续流逝。");
  }

  async function resumeFocus() {
    await updateFocusSession("resume", "已继续倒计时。");
  }

  async function advanceFocus(automatic = false) {
    if (!state.focus || state.isUpdatingFocus) return;
    state.isUpdatingFocus = true;
    renderFocus();
    try {
      const session = await api(`/api/v1/focus-sessions/${state.focus.id}/advance`, { method: "POST" });
      syncActiveFocus(session);
      renderFocus();
      notify(session.phase === "break" ? "第一段专注完成，开始休息 5 分钟。" : automatic ? "休息结束，开始第二段专注。" : "已进入下一阶段。");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      state.isUpdatingFocus = false;
      renderFocus();
    }
  }

  async function updateFocusSession(action, message) {
    if (!state.focus || state.isUpdatingFocus) return;
    state.isUpdatingFocus = true;
    renderFocus();
    try {
      const session = await api(`/api/v1/focus-sessions/${state.focus.id}/${action}`, { method: "POST" });
      syncActiveFocus(session);
      renderFocus();
      notify(message);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      state.isUpdatingFocus = false;
      renderFocus();
    }
  }

  async function finishFocus(abandoned, automatic = false) {
    if (!state.focus || state.isFinishingFocus) return;
    const completedFocus = state.focus;
    state.isFinishingFocus = true;
    renderFocus();
    try {
      await api(`/api/v1/focus-sessions/${completedFocus.id}/finish`, { method: "PATCH", body: JSON.stringify({ abandoned }) });
      state.focus = null;
      persistFocus();
      await refresh();
      if (!abandoned && completedFocus.completeTask && completedFocus.taskID) {
        const task = state.tasks.find((item) => item.id === completedFocus.taskID);
        if (task && task.status !== "done" && task.status !== "cancelled") {
          try {
            await api(`/api/v1/tasks/${completedFocus.taskID}/status`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
            await refresh();
            notify("专注会话和关联任务均已完成，做得好。");
            return;
          } catch (error) {
            notify(`专注已记录，但任务未自动完成：${error.message}`, "error");
            return;
          }
        }
      }
      notify(abandoned ? "已放弃本次专注会话。" : automatic ? "倒计时结束，专注会话已自动完成。" : "专注会话已完成，做得好。");
    } catch (error) {
      notify(error.message, "error");
      if (automatic) refresh().catch(() => undefined);
    } finally {
      state.isFinishingFocus = false;
      renderFocus();
    }
  }

  async function bootstrap() {
    applyTheme(state.theme);
    bindEvents();
    window.setInterval(updateFocusClock, 250);
    window.setInterval(() => {
      if (state.user) refresh().catch(() => undefined);
    }, 60_000);
    renderReadyCountdown();
    if (!state.token) return;
    try {
      const user = await api("/api/v1/me");
      enterApp(user);
    } catch {
      leaveApp();
    }
  }

  bootstrap();
})();
