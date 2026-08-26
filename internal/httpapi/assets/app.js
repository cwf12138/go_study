(() => {
  "use strict";

  const state = {
    token: localStorage.getItem("studyflow.token") || "",
    user: null,
    dashboard: null,
    goals: [],
    tasks: [],
    decks: [],
    dueCards: [],
    currentView: "dashboard",
    focus: loadFocus(),
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

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch {
      throw new Error("无法连接到服务，请确认 Go API 正在运行。");
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.token) leaveApp();
      throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
    }
    return payload.data;
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

  function toISO(value) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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

  function authTab(tab) {
    const registering = tab === "register";
    $$("[data-auth-tab]").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
    $("#login-form").classList.toggle("hidden", registering);
    $("#register-form").classList.toggle("hidden", !registering);
  }

  function enterApp(user) {
    state.user = user;
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
    state.tasks = [];
    state.decks = [];
    state.dueCards = [];
    state.focus = null;
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

  async function refresh() {
    const [dashboard, goals, tasks, dueCards, decks] = await Promise.all([
      api("/api/v1/dashboard"),
      api("/api/v1/goals"),
      api("/api/v1/tasks"),
      api("/api/v1/cards/due?limit=50"),
      api("/api/v1/decks"),
    ]);
    state.dashboard = dashboard;
    state.goals = goals;
    state.tasks = tasks;
    state.dueCards = dueCards;
    state.decks = decks;
    render();
  }

  function render() {
    renderDashboard();
    renderGoals();
    renderTasks();
    renderReview();
    renderFocus();
    renderSelects();
  }

  function renderDashboard() {
    const data = state.dashboard || {};
    $("#metric-goals").textContent = data.active_goals ?? 0;
    $("#metric-tasks").textContent = data.pending_tasks ?? 0;
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
    if (!state.goals.length) {
      container.className = "goal-list empty-state";
      container.textContent = "还没有目标。先创建一个值得长期投入的方向。";
      return;
    }
    container.className = "goal-list";
    container.innerHTML = state.goals.map((goal) => {
      const progress = goal.status === "completed" ? 100 : goal.status === "archived" ? 0 : 35;
      const actions = goal.status === "active"
        ? `<button class="quiet" type="button" data-goal-status="completed" data-id="${goal.id}">完成</button><button class="quiet" type="button" data-goal-status="archived" data-id="${goal.id}">归档</button>`
        : `<button class="quiet" type="button" data-goal-status="active" data-id="${goal.id}">重新激活</button>`;
      return `<article class="list-row"><div class="row-main"><div class="row-actions"><h4>${escapeHTML(goal.title)}</h4><span class="pill ${goal.status === "completed" ? "done" : goal.status === "archived" ? "cancelled" : "in_progress"}">${goalStatusLabel(goal.status)}</span></div><p>${escapeHTML(goal.description || "尚未添加目标说明")} · 计划 ${goal.target_minutes} 分钟${goal.deadline ? ` · 截止 ${formatDate(goal.deadline)}` : ""}</p><div class="goal-progress"><span style="width:${progress}%"></span></div></div><div class="row-actions">${actions}</div></article>`;
    }).join("");
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
    $("#finish-focus").classList.toggle("hidden", !active);
    $("#abandon-focus").classList.toggle("hidden", !active);
    $("#start-focus").disabled = Boolean(active);
    form.querySelectorAll("input,select").forEach((field) => { field.disabled = Boolean(active); });
    if (!active) {
      $("#focus-clock").textContent = "00:00";
      $("#focus-state").textContent = "尚未开始专注";
      $("#focus-description").textContent = "选择一个任务和时长，开始第一段深度工作。";
      return;
    }
    const task = state.tasks.find((item) => item.id === active.taskID);
    $("#focus-state").textContent = "正在专注";
    $("#focus-description").textContent = task ? `当前任务：${task.title}` : "正在进行一段不关联任务的专注时间。";
    updateFocusClock();
  }

  function updateFocusClock() {
    if (!state.focus) return;
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(state.focus.startedAt).getTime()) / 1000));
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const rest = String(seconds % 60).padStart(2, "0");
    $("#focus-clock").textContent = `${minutes}:${rest}`;
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
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await action();
      event.currentTarget.reset();
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
    });
    $("#task-filter").addEventListener("change", renderTasks);

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

    $("#goal-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/goals", { method: "POST", body: JSON.stringify({ title: $("#goal-title").value, description: $("#goal-description").value, target_minutes: Number($("#goal-minutes").value || 0), deadline: toISO($("#goal-deadline").value) }) }), "目标已创建。"));
    $("#task-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/tasks", { method: "POST", body: JSON.stringify({ goal_id: $("#task-goal").value, title: $("#task-title").value, description: $("#task-description").value, estimated_minutes: Number($("#task-minutes").value || 0), priority: $("#task-priority").value, due_at: toISO($("#task-due").value), tags: $("#task-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean) }) }), "任务已创建。"));
    $("#deck-form").addEventListener("submit", (event) => submitForm(event, () => api("/api/v1/decks", { method: "POST", body: JSON.stringify({ name: $("#deck-name").value, description: $("#deck-description").value }) }), "卡组已创建。"));
    $("#card-form").addEventListener("submit", (event) => submitForm(event, () => api(`/api/v1/decks/${$("#card-deck").value}/cards`, { method: "POST", body: JSON.stringify({ prompt: $("#card-prompt").value, answer: $("#card-answer").value }) }), "复习卡已添加，今天就可以开始复习。"));
    $("#focus-form").addEventListener("submit", startFocus);
    $("#finish-focus").addEventListener("click", () => finishFocus(false));
    $("#abandon-focus").addEventListener("click", () => finishFocus(true));
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
      const session = await api("/api/v1/focus-sessions", { method: "POST", body: JSON.stringify({ task_id: $("#focus-task").value, planned_minutes: Number($("#focus-minutes").value) }) });
      state.focus = { id: session.id, userID: state.user.id, taskID: session.task_id, startedAt: session.started_at };
      persistFocus();
      renderFocus();
      notify("专注会话已开始，享受这一段不被打扰的时间。 ");
    } catch (error) {
      notify(error.message, "error");
      button.disabled = false;
    }
  }

  async function finishFocus(abandoned) {
    if (!state.focus) return;
    try {
      await api(`/api/v1/focus-sessions/${state.focus.id}/finish`, { method: "PATCH", body: JSON.stringify({ abandoned }) });
      state.focus = null;
      persistFocus();
      renderFocus();
      await refresh();
      notify(abandoned ? "已放弃本次专注会话。" : "专注会话已完成，做得好。" );
    } catch (error) { notify(error.message, "error"); }
  }

  async function bootstrap() {
    bindEvents();
    if (!state.token) return;
    try {
      const user = await api("/api/v1/me");
      enterApp(user);
    } catch {
      leaveApp();
    }
    window.setInterval(() => {
      if (state.user) refresh().catch(() => undefined);
      updateFocusClock();
    }, 1000);
  }

  bootstrap();
})();
