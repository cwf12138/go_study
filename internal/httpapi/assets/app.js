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
    const [dashboard, goalPageResponse, activeGoalsResponse, moods, moodInsights, tasks, dueCards, decks, activeFocus] = await Promise.all([
      api("/api/v1/dashboard"),
      api(goalListURL(), { returnEnvelope: true }),
      api("/api/v1/goals?status=active&sort=title&order=asc&page=1&page_size=50", { returnEnvelope: true }),
      api(`/api/v1/moods?month=${state.moodMonth}`),
      api(`/api/v1/moods/insights?month=${state.moodMonth}`),
      api("/api/v1/tasks"),
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
      return `<article class="list-row goal-row"><div class="row-main"><div class="row-actions"><h4>${escapeHTML(goal.title)}</h4><span class="pill ${goal.status === "completed" ? "done" : goal.status === "archived" ? "cancelled" : "in_progress"}">${goalStatusLabel(goal.status)}</span></div><p>${escapeHTML(goal.description || "尚未添加目标说明")}</p><small class="goal-created-at">创建于 ${formatDate(goal.created_at, true)}</small><small class="goal-created-at">${deadline}</small></div><div class="row-actions">${actions}</div></article>`;
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
    container.innerHTML = tasks.map((task) => `<article class="list-row"><div class="row-main"><div class="row-actions"><h4>${escapeHTML(task.title)}</h4><span class="pill ${task.status}">${taskStatusLabel(task.status)}</span><span class="priority-${task.priority}">● ${priorityLabel(task.priority)}</span></div><p>${escapeHTML(task.description || "尚未添加完成说明")} · 预计 ${task.estimated_minutes} 分钟${task.due_at ? ` · 截止 ${formatDate(task.due_at, true)}` : ""}</p>${(task.tags || []).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("")}</div><div class="row-actions">${taskActions(task)}</div></article>`).join("");
  }

  function taskActions(task) {
    if (task.status === "todo") return `<button class="quiet" type="button" data-task-status="in_progress" data-id="${task.id}">开始</button><button class="quiet" type="button" data-task-status="done" data-id="${task.id}">完成</button>`;
    if (task.status === "in_progress") return `<button class="primary" type="button" data-task-status="done" data-id="${task.id}">标记完成</button><button class="quiet" type="button" data-task-status="todo" data-id="${task.id}">暂停</button>`;
    return `<button class="quiet" type="button" data-task-status="todo" data-id="${task.id}">重新打开</button>`;
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
      const taskButton = event.target.closest("[data-task-status]");
      if (taskButton) await changeTaskStatus(taskButton.dataset.id, taskButton.dataset.taskStatus);
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
    $("#task-filter").addEventListener("change", renderTasks);
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

  async function changeTaskStatus(id, status) {
    try { await api(`/api/v1/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); await refresh(); notify("任务状态已更新。"); }
    catch (error) { notify(error.message, "error"); }
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
