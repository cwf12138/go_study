(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const pad = (value) => String(value).padStart(2, "0");
  const escapeHTML = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function fromDateKey(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
  function addDays(date, count) { const next = new Date(date); next.setDate(next.getDate() + count); return next; }
  function startOfWeek(date) { const start = new Date(date); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return start; }
  function formatDateTimeLocal(date) { return `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
  function validColor(value, fallback = "#5b81ff") { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback; }
  function isToday(value) { return value === dateKey(new Date()); }
  function token() { return localStorage.getItem("studyflow.token") || ""; }

  // Helpers must be initialized before state because the initial selected day
  // is derived through dateKey(), which itself uses the pad() constant above.
  const state = {
    view: localStorage.getItem("studyflow.calendar.view") || "month",
    anchor: new Date(), selected: dateKey(new Date()), overview: null, detail: null,
    loading: false, initialized: false, direction: 1, historyRequestID: 0, historyCache: new Map(),
  };

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (token()) headers.set("Authorization", `Bearer ${token()}`);
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...options, headers });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404 && path.startsWith("/api/v1/calendar")) {
        throw new Error("当前运行的 Go 服务不包含日历 API，请停止旧进程并重新执行 go run ./cmd/api。");
      }
      throw new Error(payload?.error?.message || `日历请求失败（${response.status}）`);
    }
    return payload.data;
  }

  function notify(message, error = false) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast visible ${error ? "error" : ""}`;
    window.setTimeout(() => { if (toast.textContent === message) toast.className = "toast"; }, 3200);
  }

  function rangeForView() {
    const anchor = new Date(state.anchor);
    if (state.view === "year") return [new Date(anchor.getFullYear(), 0, 1), new Date(anchor.getFullYear() + 1, 0, 1)];
    if (state.view === "week") { const start = startOfWeek(anchor); return [start, addDays(start, 7)]; }
    if (state.view === "day") { const start = fromDateKey(dateKey(anchor)); return [start, addDays(start, 1)]; }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(first);
    return [start, addDays(start, 42)];
  }

  async function loadCalendar(animate = false) {
    if (state.loading) return;
	if (!token()) {
	  renderCalendar();
	  showCalendarError("登录状态尚未就绪，请重新登录后再打开智能日历。");
	  return;
	}
    state.loading = true;
    const canvas = $("#calendar-canvas");
	if (!state.overview) canvas.innerHTML = '<div class="empty-state">正在加载公历、农历与日程数据…</div>';
    if (animate) {
      canvas.style.setProperty("--calendar-shift", `${state.direction * 16}px`);
      canvas.classList.add("transitioning");
      await new Promise((resolve) => window.setTimeout(resolve, 115));
    }
    try {
      const [start, end] = rangeForView();
      state.overview = await api(`/api/v1/calendar?start=${dateKey(start)}&end=${dateKey(end)}`);
      renderCalendar();
      await loadDayDetail(state.selected);
    } catch (error) {
	  renderCalendar();
	  showCalendarError(error.message);
      notify(error.message, true);
    } finally {
      state.loading = false;
      requestAnimationFrame(() => canvas.classList.remove("transitioning"));
    }
  }

  function renderCalendar() {
    const anchor = state.anchor;
    const titles = {
      year: `${anchor.getFullYear()} 年`,
      month: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(anchor),
      week: `${shortDate(startOfWeek(anchor))} – ${shortDate(addDays(startOfWeek(anchor), 6))}`,
      day: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(anchor),
    };
    $("#calendar-title").textContent = titles[state.view];
    document.querySelectorAll("[data-calendar-view]").forEach((button) => button.classList.toggle("active", button.dataset.calendarView === state.view));
    $("#calendar-weekdays").classList.toggle("hidden", state.view !== "month");
    if (state.view === "year") renderYear(); else if (state.view === "month") renderMonth(); else renderTimeView();
	if (!state.detail) renderDayPlaceholder();
  }

  function renderDayPlaceholder() {
	const date = fromDateKey(state.selected);
	$("#calendar-detail-weekday").textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
	$("#calendar-detail-number").textContent = date.getDate();
	$("#calendar-detail-date").textContent = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
	$("#calendar-detail-lunar").textContent = "正在加载农历信息…";
  }

  function showCalendarError(message) {
	const canvas = $("#calendar-canvas");
	if (!canvas) return;
	canvas.insertAdjacentHTML("afterbegin", `<div class="calendar-load-error" role="alert"><b>日历扩展数据暂未加载</b><span>${escapeHTML(message)}</span><button type="button" data-calendar-retry>重试</button></div>`);
  }

  function dayMap() { return new Map((state.overview?.days || []).map((day) => [day.date, day])); }

  function itemsByDate() {
    const map = new Map();
    const add = (key, item) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(item); };
    (state.overview?.events || []).forEach((item) => add(dateKey(new Date(item.occurrence_start)), { type: "event", id: item.id, title: item.title, time: item.all_day ? "全天" : clock(new Date(item.occurrence_start)), color: validColor(item.color), raw: item }));
    (state.overview?.plan_blocks || []).forEach((item) => add(dateKey(new Date(item.start_at)), { type: "plan", id: item.id, title: item.title, time: clock(new Date(item.start_at)), color: "#845fe8", raw: item }));
    (state.overview?.tasks || []).forEach((item) => add(dateKey(new Date(item.due_at)), { type: "task", id: item.id, title: `任务 · ${item.title}`, time: clock(new Date(item.due_at)), color: "#e5963e", raw: item }));
    (state.overview?.todos || []).forEach((item) => add(dateKey(new Date(item.due_at)), { type: "todo", id: item.id, title: `待办 · ${item.title}`, time: clock(new Date(item.due_at)), color: "#e5963e", raw: item }));
    (state.overview?.mood_entries || []).forEach((item) => add(item.date, { type: "mood", id: item.id, title: `心情 · ${moodEmoji(item.mood)}`, time: "记录", color: "#25ae85", raw: item }));
    map.forEach((items) => items.sort((a, b) => a.time.localeCompare(b.time)));
    return map;
  }

  function renderMonth() {
    const days = dayMap(), items = itemsByDate();
    const [start] = rangeForView();
    let html = '<div class="calendar-month-grid">';
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(start, index), key = dateKey(date), info = days.get(key) || { date: key, lunar: "" };
      const cellItems = items.get(key) || [], outside = date.getMonth() !== state.anchor.getMonth();
      const special = info.solar_term || info.festivals?.[0];
      html += `<button class="calendar-day-cell ${outside ? "outside" : ""} ${isToday(key) ? "today" : ""} ${key === state.selected ? "selected" : ""}" type="button" data-calendar-date="${key}">
        <span class="calendar-cell-head"><span class="calendar-solar-day">${date.getDate()}</span><span class="calendar-lunar-day ${special ? "special" : ""}">${escapeHTML(special || info.lunar)}</span></span>
        ${info.holiday_name ? `<span class="calendar-holiday-tag ${info.holiday_type === "work" ? "work" : ""}">${escapeHTML(info.holiday_type === "work" ? "班" : info.holiday_name)}</span>` : ""}
        <span class="calendar-cell-items">${cellItems.slice(0, 3).map((item) => `<span class="calendar-cell-item" style="--item-color:${item.color}">${escapeHTML(item.time)} ${escapeHTML(item.title)}</span>`).join("")}${cellItems.length > 3 ? `<span class="calendar-cell-more">另 ${cellItems.length - 3} 项</span>` : ""}</span>
      </button>`;
    }
    $("#calendar-canvas").innerHTML = `${html}</div>`;
  }

  function renderYear() {
    const year = state.anchor.getFullYear();
    let html = '<div class="calendar-year-grid">';
    for (let month = 0; month < 12; month += 1) {
      const first = new Date(year, month, 1), start = startOfWeek(first), total = new Date(year, month + 1, 0).getDate();
      html += `<section class="calendar-mini-month"><h4 data-calendar-month="${month}">${month + 1} 月</h4><div class="calendar-mini-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="calendar-mini-days">`;
      for (let index = 0; index < 42; index += 1) {
        const date = addDays(start, index), key = dateKey(date), outside = date.getMonth() !== month;
        html += `<button type="button" class="calendar-mini-day ${outside ? "outside" : ""} ${isToday(key) ? "today" : ""} ${state.selected === key ? "selected" : ""}" data-calendar-date="${key}" ${outside ? "tabindex=\"-1\"" : ""}>${outside ? "" : date.getDate()}</button>`;
      }
      html += `</div><small>${total} 天</small></section>`;
    }
    $("#calendar-canvas").innerHTML = `${html}</div>`;
  }

  function renderTimeView() {
    const start = state.view === "week" ? startOfWeek(state.anchor) : fromDateKey(dateKey(state.anchor));
    const count = state.view === "week" ? 7 : 1;
    const events = itemsByDate();
    let heads = "<span></span>", columns = '<div class="calendar-hour-labels">';
    for (let hour = 0; hour < 24; hour += 1) columns += `<span>${pad(hour)}:00</span>`;
    columns += "</div>";
    for (let index = 0; index < count; index += 1) {
      const day = addDays(start, index), key = dateKey(day);
      heads += `<span>${["日", "一", "二", "三", "四", "五", "六"][day.getDay()]}<br><b>${day.getMonth() + 1}/${day.getDate()}</b></span>`;
      const currentLine = isToday(key) ? `<i class="calendar-current-line" style="top:${(new Date().getHours() * 60 + new Date().getMinutes()) * .8}px"></i>` : "";
      columns += `<div class="calendar-time-column" data-calendar-date="${key}">${currentLine}${(events.get(key) || []).filter((item) => item.type === "event" || item.type === "plan").map(timedEventHTML).join("")}</div>`;
    }
    $("#calendar-canvas").innerHTML = `<div class="calendar-time-view" style="--day-count:${count}"><div class="calendar-time-head">${heads}</div><div class="calendar-time-grid">${columns}</div></div>`;
  }

  function timedEventHTML(item) {
    const rawStart = item.raw.occurrence_start || item.raw.start_at;
    const rawEnd = item.raw.occurrence_end || item.raw.end_at;
    const start = new Date(rawStart), end = new Date(rawEnd);
    const top = item.raw.all_day ? 2 : (start.getHours() * 60 + start.getMinutes()) * .8;
    const height = item.raw.all_day ? 28 : Math.max(24, (end - start) / 60000 * .8);
    const eventAttribute = item.type === "event" ? `data-calendar-event="${escapeHTML(item.id)}"` : "";
    return `<button type="button" class="calendar-timed-event" ${eventAttribute} style="top:${top}px;height:${height}px;--item-color:${item.color}"><b>${escapeHTML(item.title)}</b><br>${escapeHTML(item.time)}</button>`;
  }

  async function selectDay(value, updateAnchor = false) {
    state.selected = value;
	const selectedDate = fromDateKey(value);
	if (state.view === "month" && (selectedDate.getMonth() !== state.anchor.getMonth() || selectedDate.getFullYear() !== state.anchor.getFullYear())) {
	  state.direction = selectedDate > state.anchor ? 1 : -1;
	  state.anchor = selectedDate;
	  await loadCalendar(true);
	  return;
	}
    if (updateAnchor) state.anchor = selectedDate;
    renderCalendar();
    await loadDayDetail(value);
  }

  async function loadDayDetail(value) {
    try {
	  // Calendar metadata is local and should render immediately. History is
	  // loaded independently because external Wikimedia access may be slower.
      state.detail = await api(`/api/v1/calendar/days/${value}?history=false`);
      renderDayDetail();
	  loadHistory(value);
    } catch (error) { notify(error.message, true); }
  }

  async function loadHistory(value) {
	const requestID = ++state.historyRequestID;
	const cacheKey = value.slice(5);
	const cached = state.historyCache.get(cacheKey);
	if (cached) {
	  if (state.detail?.date === value) { state.detail.history = cached.events; state.detail.history_source = cached.source; renderHistory(); }
	  return;
	}
	$("#calendar-history").innerHTML = '<div class="empty-state">正在从中文维基百科读取历史事件…</div>';
	$("#calendar-history-source").textContent = "";
	const controller = new AbortController();
	const timeoutID = window.setTimeout(() => controller.abort(), 8500);
	try {
	  const result = await firstUsefulHistory([
		api(`/api/v1/calendar/days/${value}?history=true`, { signal: controller.signal }).then((detail) => ({ events: detail.history || [], source: detail.history_source || "Wikipedia / CC BY-SA" })),
		fetchWikipediaHistory(value, controller.signal),
	  ]);
	  controller.abort();
	  if (requestID !== state.historyRequestID || state.detail?.date !== value) return;
	  state.historyCache.set(cacheKey, result);
	  state.detail.history = result.events;
	  state.detail.history_source = result.source;
	  renderHistory();
	} catch {
	  if (requestID !== state.historyRequestID || state.detail?.date !== value) return;
	  $("#calendar-history").innerHTML = '<div class="empty-state">历史数据源暂时无法连接。<button class="text-button" type="button" data-history-retry>重新加载</button></div>';
	  $("#calendar-history-source").textContent = "核心日历与个人日程不受影响";
	} finally {
	  window.clearTimeout(timeoutID);
	}
  }

  function firstUsefulHistory(promises) {
	return new Promise((resolve, reject) => {
	  let remaining = promises.length;
	  promises.forEach((promise) => Promise.resolve(promise).then((result) => {
		if (result?.events?.length) { resolve(result); return; }
		remaining -= 1;
		if (remaining === 0) reject(new Error("no history data"));
	  }).catch(() => {
		remaining -= 1;
		if (remaining === 0) reject(new Error("history providers unavailable"));
	  }));
	});
  }

  async function fetchWikipediaHistory(value, signal) {
	const date = fromDateKey(value), title = `${date.getMonth() + 1}月${date.getDate()}日`;
	const query = new URLSearchParams({ action: "query", prop: "extracts", explaintext: "1", redirects: "1", format: "json", formatversion: "2", titles: title, origin: "*" });
	const response = await fetch(`https://zh.wikipedia.org/w/api.php?${query}`, { signal, headers: { Accept: "application/json" } });
	if (!response.ok) throw new Error(`Wikipedia ${response.status}`);
	const payload = await response.json();
	const extract = payload?.query?.pages?.[0]?.extract || "";
	return { events: parseWikipediaHistory(extract, `https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}`), source: "中文维基百科日期条目 / CC BY-SA" };
  }

  function parseWikipediaHistory(extract, pageURL) {
	const simplified = "== 大事记 ==", traditional = "== 大事記 ==";
	let start = extract.indexOf(simplified), headerLength = simplified.length;
	if (start < 0) { start = extract.indexOf(traditional); headerLength = traditional.length; }
	if (start < 0) return [];
	let section = extract.slice(start + headerLength);
	const end = section.indexOf("\n== ");
	if (end >= 0) section = section.slice(0, end);
	const pattern = /^\s*(?:[*#]\s*)?(?:(?:公元前|前)(\d{1,5})|(\d{1,5}))年\s*[：:—－-]+\s*(.+?)\s*$/gm;
	const events = [];
	for (const match of section.matchAll(pattern)) {
	  const year = match[1] ? -Number(match[1]) : Number(match[2]);
	  const text = match[3].trim();
	  if (text) events.push({ year, text: text.length > 420 ? `${text.slice(0, 420)}…` : text, url: pageURL });
	}
	return events.sort((left, right) => right.year - left.year).slice(0, 6);
  }

  function renderDayDetail() {
    const detail = state.detail;
    if (!detail) return;
    const date = fromDateKey(detail.date), badges = [...(detail.festivals || [])];
    if (detail.solar_term && !badges.includes(detail.solar_term)) badges.push(detail.solar_term);
    if (detail.holiday_name) badges.push(`${detail.holiday_name}${detail.holiday_type === "work" ? " · 调休上班" : " · 休"}`);
    $("#calendar-detail-weekday").textContent = detail.weekday;
    $("#calendar-detail-number").textContent = date.getDate();
    $("#calendar-detail-date").textContent = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    $("#calendar-detail-lunar").textContent = `农历 ${detail.lunar_full} · ${detail.zodiac}年 · ${detail.constellation}座`;
    $("#calendar-detail-ganzhi").textContent = detail.gan_zhi;
    $("#calendar-day-badges").innerHTML = badges.map((item) => `<span>${escapeHTML(item)}</span>`).join("") || "<span>平常的一天</span>";
    $("#calendar-yi").textContent = detail.yi?.join(" · ") || "诸事皆宜";
    $("#calendar-ji").textContent = detail.ji?.join(" · ") || "无特别禁忌";
    $("#calendar-almanac-extra").textContent = `日神：${detail.lucky_god || "—"}　财神方位：${detail.wealth_god || "—"}　冲：${detail.chong || "—"}　煞：${detail.sha || "—"}`;
    $("#calendar-quote").textContent = detail.quote;
    $("#calendar-quote-author").textContent = `— ${detail.quote_author}`;
    renderAgenda();
	renderHistory();
  }

  function renderHistory() {
	const detail = state.detail;
	if (!detail) return;
    $("#calendar-history").innerHTML = detail.history?.length ? detail.history.map((item) => {
      const content = `<b>${historyYearLabel(item.year)}</b><span>${escapeHTML(item.text)}</span>`;
      return item.url?.startsWith("https://") ? `<a class="calendar-history-item" href="${escapeHTML(item.url)}" target="_blank" rel="noreferrer">${content}</a>` : `<div class="calendar-history-item">${content}</div>`;
    }).join("") : '<div class="empty-state">暂未取得这一天的历史条目，核心日历不受影响。</div>';
    $("#calendar-history-source").textContent = detail.history_source ? `内容来源：${detail.history_source}` : "";
  }

  function historyYearLabel(year) { return year < 0 ? `前${Math.abs(year)}` : (year || "—"); }

  function renderAgenda() {
    const items = itemsByDate().get(state.selected) || [];
    const agenda = $("#calendar-day-agenda");
    agenda.classList.toggle("empty-state", !items.length);
    agenda.innerHTML = items.length ? items.map((item) => `<div class="calendar-agenda-item" ${item.type === "event" ? `data-calendar-event="${escapeHTML(item.id)}"` : ""}><span class="calendar-agenda-time">${escapeHTML(item.time)}</span><i class="calendar-agenda-color" style="--item-color:${item.color}"></i><span><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.type === "event" ? item.raw.category : typeLabel(item.type))}</small></span></div>`).join("") : "这一天还没有安排。";
  }

  function navigate(direction) {
    state.direction = direction;
    const anchor = new Date(state.anchor);
    if (state.view === "year") anchor.setFullYear(anchor.getFullYear() + direction);
    else if (state.view === "month") anchor.setMonth(anchor.getMonth() + direction, 1);
    else if (state.view === "week") anchor.setDate(anchor.getDate() + 7 * direction);
    else anchor.setDate(anchor.getDate() + direction);
    state.anchor = anchor;
    if (state.view === "day") state.selected = dateKey(anchor);
    loadCalendar(true);
  }

  function setView(view) {
    if (!["year", "month", "week", "day"].includes(view) || state.view === view) return;
    state.view = view;
    localStorage.setItem("studyflow.calendar.view", view);
    state.anchor = fromDateKey(state.selected);
    loadCalendar(true);
  }

  function openEventDialog(eventID = "", selectedDate = state.selected) {
    const occurrence = (state.overview?.events || []).find((item) => item.id === eventID);
    const start = occurrence ? new Date(occurrence.start_at) : fromDateKey(selectedDate);
    if (!occurrence) start.setHours(9, 0, 0, 0);
    const end = occurrence ? new Date(occurrence.end_at) : new Date(start.getTime() + 60 * 60 * 1000);
    $("#calendar-dialog-title").textContent = occurrence ? "编辑日程" : "新建日程";
    $("#calendar-event-id").value = occurrence?.id || "";
    $("#calendar-event-title").value = occurrence?.title || "";
    $("#calendar-event-start").value = formatDateTimeLocal(start);
    $("#calendar-event-end").value = formatDateTimeLocal(end);
    $("#calendar-event-all-day").checked = occurrence?.all_day || false;
    $("#calendar-event-category").value = occurrence?.category || "学习";
    $("#calendar-event-color").value = validColor(occurrence?.color);
    $("#calendar-event-repeat").value = occurrence?.repeat_rule || "none";
    $("#calendar-event-repeat-until").value = occurrence?.repeat_until ? dateKey(new Date(occurrence.repeat_until)) : "";
    $("#calendar-event-reminder").value = String(occurrence?.reminder_minutes || 0);
    $("#calendar-event-location").value = occurrence?.location || "";
    $("#calendar-event-description").value = occurrence?.description || "";
    $("#calendar-event-delete").classList.toggle("hidden", !occurrence);
    $("#calendar-event-dialog").showModal();
    window.setTimeout(() => $("#calendar-event-title").focus(), 30);
  }

  async function saveEvent(event) {
    event.preventDefault();
    const id = $("#calendar-event-id").value;
    const repeatUntil = $("#calendar-event-repeat-until").value;
    const body = {
      title: $("#calendar-event-title").value, description: $("#calendar-event-description").value,
      location: $("#calendar-event-location").value, category: $("#calendar-event-category").value,
      color: $("#calendar-event-color").value, start_at: new Date($("#calendar-event-start").value).toISOString(),
      end_at: new Date($("#calendar-event-end").value).toISOString(), all_day: $("#calendar-event-all-day").checked,
      repeat_rule: $("#calendar-event-repeat").value, reminder_minutes: Number($("#calendar-event-reminder").value),
    };
    if (repeatUntil) body.repeat_until = new Date(`${repeatUntil}T23:59:59`).toISOString();
    if (id && !repeatUntil) body.clear_repeat_until = true;
    try {
      await api(id ? `/api/v1/calendar/events/${id}` : "/api/v1/calendar/events", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
	  if (body.reminder_minutes > 0 && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => undefined);
      $("#calendar-event-dialog").close();
      await loadCalendar();
      notify(id ? "日程已更新。" : "日程已创建。持续安排，也给自己留出余量。");
    } catch (error) { notify(error.message, true); }
  }

  async function deleteEvent() {
    const id = $("#calendar-event-id").value;
    if (!id || !window.confirm("删除这个日程及其全部重复实例？")) return;
    try { await api(`/api/v1/calendar/events/${id}`, { method: "DELETE" }); $("#calendar-event-dialog").close(); await loadCalendar(); notify("日程已删除。"); }
    catch (error) { notify(error.message, true); }
  }

  function bind() {
    $("[data-view=calendar]")?.addEventListener("click", () => {
	  activateCalendarPanel();
	  state.initialized = true;
	  loadCalendar();
	});
    $("#calendar-prev").addEventListener("click", () => navigate(-1));
    $("#calendar-next").addEventListener("click", () => navigate(1));
    $("#calendar-today").addEventListener("click", () => { state.anchor = new Date(); state.selected = dateKey(new Date()); state.direction = 0; loadCalendar(true); });
    document.querySelectorAll("[data-calendar-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.calendarView)));
    $("#calendar-create").addEventListener("click", () => openEventDialog());
    $("#calendar-quick-create").addEventListener("click", () => openEventDialog());
    $("#calendar-dialog-close").addEventListener("click", () => $("#calendar-event-dialog").close());
    $("#calendar-event-cancel").addEventListener("click", () => $("#calendar-event-dialog").close());
    $("#calendar-event-delete").addEventListener("click", deleteEvent);
    $("#calendar-event-form").addEventListener("submit", saveEvent);
    $("#calendar-canvas").addEventListener("click", async (event) => {
	  if (event.target.closest("[data-calendar-retry]")) { await loadCalendar(); return; }
      const eventButton = event.target.closest("[data-calendar-event]"); if (eventButton) { event.stopPropagation(); openEventDialog(eventButton.dataset.calendarEvent); return; }
      const month = event.target.closest("[data-calendar-month]"); if (month) { state.anchor = new Date(state.anchor.getFullYear(), Number(month.dataset.calendarMonth), 1); state.selected = dateKey(state.anchor); setView("month"); return; }
      const day = event.target.closest("[data-calendar-date]"); if (day) { await selectDay(day.dataset.calendarDate, state.view === "day"); }
    });
    $("#calendar-day-agenda").addEventListener("click", (event) => { const target = event.target.closest("[data-calendar-event]"); if (target) openEventDialog(target.dataset.calendarEvent); });
	$("#calendar-history").addEventListener("click", (event) => { if (event.target.closest("[data-history-retry]")) loadHistory(state.selected); });
    window.addEventListener("keydown", (event) => {
      if (!$("#panel-calendar").classList.contains("active") || $("#calendar-event-dialog").open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === "arrowleft") navigate(-1); else if (key === "arrowright") navigate(1); else if (key === "t") { state.anchor = new Date(); state.selected = dateKey(new Date()); loadCalendar(true); }
      else if (key === "c") openEventDialog(); else if ({ m: "month", w: "week", d: "day", y: "year" }[key]) setView({ m: "month", w: "week", d: "day", y: "year" }[key]);
    });
    if (location.hash === "#calendar" && token()) { state.initialized = true; window.setTimeout(loadCalendar, 0); }
	window.setInterval(checkReminders, 30_000);
	renderCalendar();
  }

  // Calendar keeps a small self-contained activation path so a cached older
  // app.js cannot leave the new navigation entry dead. The main application
  // still owns normal navigation once all assets are on the same version.
  function activateCalendarPanel() {
	document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === "panel-calendar"));
	document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === "calendar"));
	const kicker = $("#page-kicker"), title = $("#page-title"), sidebar = $(".sidebar");
	if (kicker) kicker.textContent = "SMART CALENDAR";
	if (title) title.textContent = "智能日历";
	if (sidebar) sidebar.classList.remove("open");
  }

  function checkReminders() {
	if (!state.overview || !("Notification" in window) || Notification.permission !== "granted") return;
	const now = Date.now();
	(state.overview.events || []).forEach((item) => {
	  if (!item.reminder_minutes) return;
	  const triggerAt = new Date(item.occurrence_start).getTime() - item.reminder_minutes * 60_000;
	  const reminderKey = `studyflow.calendar.reminded.${item.occurrence_id}`;
	  if (now >= triggerAt && now - triggerAt < 65_000 && !sessionStorage.getItem(reminderKey)) {
		sessionStorage.setItem(reminderKey, "1");
		new Notification(item.title, { body: `${item.all_day ? "全天" : clock(new Date(item.occurrence_start))}${item.location ? ` · ${item.location}` : ""}`, tag: item.occurrence_id });
	  }
	});
  }

  function shortDate(date) { return `${date.getMonth() + 1}月${date.getDate()}日`; }
  function clock(date) { return Number.isNaN(date.getTime()) ? "" : `${pad(date.getHours())}:${pad(date.getMinutes())}`; }
  function moodEmoji(value) { return ({ awful: "😣", low: "🙁", neutral: "😐", good: "🙂", great: "😄" })[value] || "😐"; }
  function typeLabel(value) { return ({ plan: "学习计划", task: "学习任务", todo: "待办事项", mood: "心情日记" })[value] || value; }

  bind();
})();
