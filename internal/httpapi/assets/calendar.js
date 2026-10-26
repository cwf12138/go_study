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
    saving: false, requestID: 0, detailRequestID: 0, query: '', source: 'all', owner: token(), loading: false, fitnessDirty: false, initialized: false, direction: 1, historyRequestID: 0, historyCache: new Map(),
  };
  let eventDirty = false;

  async function api(path, options = {}) {
    const owner = token();
    const headers = new Headers(options.headers || {});
    if (token()) headers.set("Authorization", `Bearer ${token()}`);
    if (options.body) headers.set("Content-Type", "application/json");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    try {
      const response = await fetch(path, { ...options, headers, signal: controller.signal, cache: 'no-store' });
      if (owner !== token()) throw new Error('账号已切换，请重新加载日历。');
      if (response.status === 204) return null;
      const payload = await response.json().catch(() => ({}));
      if (owner !== token()) throw new Error('账号已切换，请重新加载日历。');
      if (!response.ok) {
        if (response.status === 404 && path.startsWith("/api/v1/calendar")) {
          if (payload?.error?.code === 'not_found') throw new Error('该日程已不存在，请刷新日历后核对。');
          throw new Error("当前运行的 Go 服务不包含日历 API，请停止旧进程并重新执行 go run ./cmd/api。");
        }
        throw new Error(payload?.error?.message || `日历请求失败（${response.status}）`);
      }
      if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'data')) throw new Error('日历响应不完整，请保留表单后重试。');
      return payload.data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(timedOut ? '日历请求超时。保存日程时请先核对结果，再决定是否重试。' : '日历请求已取消。');
      throw error;
    } finally { window.clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }

  function notify(message, error = false) {
    if (window.DaynestUI) return window.DaynestUI.notify(message, error ? 'error' : 'success');
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
    const requestID = ++state.requestID, owner = token();
    const canvas = $("#calendar-canvas");
    if (!owner) { renderCalendar(); showCalendarError("请先登录后查看个人日程。"); return; }
    state.loading = true; state.fitnessDirty = false;
    const [start, end] = rangeForView();
    state.overview = null;
    state.detail = null;
    renderCalendar();
    $("#calendar-view-status").textContent = "正在加载所选日期范围…";
    if (animate) {
      canvas.style.setProperty("--calendar-shift", `${state.direction * 12}px`);
      canvas.classList.add("transitioning");
    }
    try {
      const result = await api(`/api/v1/calendar?start=${dateKey(start)}&end=${dateKey(end)}`);
      if (requestID !== state.requestID || owner !== token()) return;
      state.overview = result;
      renderCalendar();
      await loadDayDetail(state.selected);
    } catch (error) {
      if (requestID !== state.requestID || owner !== token()) return;
      renderCalendar();
      showCalendarError(error.message);
      $("#calendar-view-status").textContent = "扩展数据加载失败；日期仍可浏览，请点击重试。";
    } finally {
      if (requestID === state.requestID) {
        state.loading = false;
        requestAnimationFrame(() => canvas.classList.remove("transitioning")); if(state.fitnessDirty && owner===token() && $("#panel-calendar").classList.contains("active")) loadCalendar();
      }
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
    $("#calendar-jump").value = state.selected;
    $("#calendar-search-open").dataset.filtered = String(Boolean(state.query));
    $("#calendar-filter-open").dataset.filtered = String(state.source !== "all");
    $("#calendar-search-open").setAttribute("aria-label", state.query ? "搜索日程，已有搜索条件" : "搜索日程");
    $("#calendar-filter-open").setAttribute("aria-label", state.source !== "all" ? "筛选与日期跳转，已有来源筛选" : "筛选与日期跳转");
    const count = [...itemsByDate().values()].reduce((n, items) => n + items.length, 0);
    $("#calendar-view-status").textContent = (state.query || state.source !== 'all' ? '筛选后 · ' : '') + '当前日期范围 ' + count + ' 项安排 · 选择日期查看详情';
    document.querySelectorAll("[data-calendar-view]").forEach(button => {
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(button.dataset.calendarView === state.view));
    });
    $("#panel-calendar").dataset.calendarMode = state.view;
    document.querySelectorAll("[data-calendar-view]").forEach((button) => button.classList.toggle("active", button.dataset.calendarView === state.view));
    $("#calendar-weekdays").classList.toggle("hidden", state.view !== "month");
    if (state.view === "year") renderYear(); else if (state.view === "month") renderMonth(); else renderTimeView();
	if (!state.detail) renderDayPlaceholder();
    renderAgenda();
  }

  function renderDayPlaceholder() {
	const date = fromDateKey(state.selected);
	$("#calendar-detail-weekday").textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
	$("#calendar-detail-number").textContent = date.getDate();
	$("#calendar-detail-date").textContent = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
	$("#calendar-detail-lunar").textContent = "正在加载农历信息…";
    ["calendar-detail-ganzhi", "calendar-day-badges", "calendar-almanac-extra", "calendar-history-source"].forEach(id => { $("#" + id).textContent = ""; });
    $("#calendar-yi").textContent = "—";
    $("#calendar-ji").textContent = "—";
    $("#calendar-quote").textContent = "选择日期，留意这一天。";
    $("#calendar-quote-author").textContent = "";
  }

  function showCalendarError(message) {
	const canvas = $("#calendar-canvas");
	if (!canvas) return;
	canvas.insertAdjacentHTML("afterbegin", `<div class="calendar-load-error" role="alert"><b>日历扩展数据暂未加载</b><span>${escapeHTML(message)}</span><button type="button" data-calendar-retry>重试</button></div>`);
  }

  function dayMap() { return new Map((state.overview?.days || []).map((day) => [day.date, day])); }

  function itemsByDate() {
    const map = new Map();
    const add = (key, item) => { if (!key) return;
      if (state.source !== 'all' && (state.source === 'tasks' ? !['task','todo'].includes(item.type) : item.type !== state.source)) return;
      if (state.query && !item.title.toLowerCase().includes(state.query)) return; if (!map.has(key)) map.set(key, []); map.get(key).push(item); };
    (state.overview?.events || []).forEach((item) => add(dateKey(new Date(item.occurrence_start)), { type: "event", id: item.id, title: item.title, time: item.all_day ? "全天" : clock(new Date(item.occurrence_start)), color: validColor(item.color), raw: item }));
    (state.overview?.plan_blocks || []).forEach((item) => add(dateKey(new Date(item.start_at)), { type: "plan", id: item.id, title: item.title, time: clock(new Date(item.start_at)), color: "#845fe8", raw: item }));
    (state.overview?.tasks || []).forEach((item) => add(dateKey(new Date(item.due_at)), { type: "task", id: item.id, title: `任务 · ${item.title}`, time: clock(new Date(item.due_at)), color: "#e5963e", raw: item }));
    (state.overview?.todos || []).forEach((item) => add(dateKey(new Date(item.due_at)), { type: "todo", id: item.id, title: `待办 · ${item.title}`, time: clock(new Date(item.due_at)), color: "#e5963e", raw: item }));
    (state.overview?.mood_entries || []).forEach((item) => add(item.date, { type: "mood", id: item.id, title: `心情 · ${calendarMood(item.mood).label}`, time: "记录", color: "#25ae85", raw: item }));
    (state.overview?.fitness_days || []).forEach((item) => add(item.date, { type: "fitness", id: 'fitness-day-'+item.date, title: '运动 · 已锻炼', time: '打卡', color: '#718b5d', raw: item }));
    (state.overview?.care_entries || []).forEach((item,index)=>add(item.date,{type:'care',id:'care-'+item.item_id+'-'+index,title:(item.kind==='done'?'已照顾 · ':'保养 · ')+item.title,time:item.kind==='done'?'完成':'待办',color:'#46797d',raw:item}));
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
      html += `<button class="calendar-day-cell ${outside ? "outside" : ""} ${isToday(key) ? "today" : ""} ${key === state.selected ? "selected" : ""}" type="button" data-calendar-date="${key}" aria-label="${key}，${cellItems.length} 项安排" aria-pressed="${key === state.selected}" tabindex="${key === state.selected ? 0 : -1}">
        <span class="calendar-cell-head"><span class="calendar-solar-day">${date.getDate()}</span><span class="calendar-lunar-day ${special ? "special" : ""}">${escapeHTML(special || info.lunar)}</span></span>
        ${info.holiday_name ? `<span class="calendar-holiday-tag ${info.holiday_type === "work" ? "work" : ""}">${escapeHTML(info.holiday_type === "work" ? "班" : info.holiday_name)}</span>` : ""}
        <span class="calendar-cell-items">${cellItems.slice(0, 3).map((item) => `<span class="calendar-cell-item${item.type === "mood" ? " has-mood" : ""}" style="--item-color:${item.color}">${escapeHTML(item.time)} ${calendarItemTitle(item)}</span>`).join("")}${cellItems.length > 3 ? `<span class="calendar-cell-more">另 ${cellItems.length - 3} 项</span>` : ""}</span>
      </button>`;
    }
    $("#calendar-canvas").innerHTML = `${html}</div>`;
  }

  function renderYear() {
    const year = state.anchor.getFullYear();
    const fitnessDates = new Set([...itemsByDate()].filter(([,items])=>items.some(item=>item.type==='fitness')).map(([date])=>date));
    let html = '<div class="calendar-year-grid">';
    for (let month = 0; month < 12; month += 1) {
      const first = new Date(year, month, 1), start = startOfWeek(first), total = new Date(year, month + 1, 0).getDate();
      html += `<section class="calendar-mini-month"><h4><button type="button" data-calendar-month="${month}">${month + 1} 月</button></h4><div class="calendar-mini-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="calendar-mini-days">`;
      for (let index = 0; index < 42; index += 1) {
        const date = addDays(start, index), key = dateKey(date), outside = date.getMonth() !== month;
        html += `<button type="button" class="calendar-mini-day ${fitnessDates.has(key) ? "has-fitness" : ""} ${outside ? "outside" : ""} ${isToday(key) ? "today" : ""} ${state.selected === key ? "selected" : ""}" aria-label="${key}${fitnessDates.has(key)?'，已锻炼':''}" data-calendar-date="${key}" ${outside ? "tabindex=\"-1\"" : ""}>${outside ? "" : date.getDate()}</button>`;
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
    const fitnessDays=Array.from({length:count},(_,i)=>dateKey(addDays(start,i)));
    const fitnessStrip=fitnessDays.some(day=>(events.get(day)||[]).some(item=>['fitness','care'].includes(item.type)))?`<div class="calendar-fitness-strip"><span>记录</span>${fitnessDays.map(day=>{const entries=(events.get(day)||[]).filter(item=>['fitness','care'].includes(item.type));return `<div>${entries.slice(0,3).map(item=>item.type==='fitness'?`<button type="button" data-calendar-fitness="${day}" title="${escapeHTML(fitnessDescription(item.raw))}">✓ 已锻炼</button>`:`<button type="button" data-calendar-care="${escapeHTML(item.raw.item_id)}">${escapeHTML(item.title)}</button>`).join('')}${entries.length>3?`<button type="button" data-calendar-date="${day}">另 ${entries.length-3} 条</button>`:''}</div>`;}).join('')}</div>`:'';
    $("#calendar-canvas").innerHTML = `<div class="calendar-time-view" style="--day-count:${count}"><div class="calendar-time-head">${heads}</div>${fitnessStrip}<div class="calendar-time-grid">${columns}</div></div>`;
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
    state.detail = null;
    renderDayPlaceholder();
    $("#calendar-day-agenda").textContent = "正在加载所选日期…";
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
    const requestID = ++state.detailRequestID, owner = token();
    state.detail = null;
    renderDayPlaceholder();
    renderAgenda();
    $("#calendar-history").textContent = "正在切换日期…";
    try {
      const detail = await api(`/api/v1/calendar/days/${value}?history=false`);
      if (requestID !== state.detailRequestID || state.selected !== value || owner !== token()) return;
      state.detail = detail;
      renderDayDetail();
      loadHistory(value);
    } catch (error) {
      if (requestID === state.detailRequestID && state.selected === value && owner === token()) {
        $("#calendar-detail-lunar").textContent = "农历信息暂未加载";
        notify(error.message, true);
      }
    }
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
    agenda.innerHTML = items.length ? items.map((item) => `<div class="calendar-agenda-item" ${item.type === "event" ? `role="button" tabindex="0" aria-label="编辑 ${escapeHTML(item.title)}" data-calendar-event="${escapeHTML(item.id)}"` : ""}><span class="calendar-agenda-time">${escapeHTML(item.time)}</span><i class="calendar-agenda-color" style="--item-color:${item.color}"></i><span><b>${calendarItemTitle(item)}</b><small>${escapeHTML(item.type === "event" ? item.raw.category : item.type === "fitness" ? fitnessDescription(item.raw) : typeLabel(item.type))}</small>${item.type === "fitness" ? `<button type="button" class="calendar-fitness-link" data-calendar-fitness="${escapeHTML(item.raw.date)}">查看运动记录 ↗</button>` : item.type === "care" ? `<button type="button" class="calendar-fitness-link" data-calendar-care="${escapeHTML(item.raw.item_id)}">查看保养事项 ↗</button>` : ""}</span></div>`).join("") : "这一天还没有安排。";
  }

  function navigate(direction) {
    state.direction = direction;
    const anchor = new Date(state.anchor);
    if (state.view === "year") anchor.setFullYear(anchor.getFullYear() + direction);
    else if (state.view === "month") anchor.setMonth(anchor.getMonth() + direction, 1);
    else if (state.view === "week") anchor.setDate(anchor.getDate() + 7 * direction);
    else anchor.setDate(anchor.getDate() + direction);
    state.anchor = anchor;
    state.selected = dateKey(anchor);
    loadCalendar(true);
  }

  function setView(view) {
    if (!["year", "month", "week", "day"].includes(view) || state.view === view) return;
    state.view = view;
    try { localStorage.setItem("studyflow.calendar.view", view); } catch {}
    state.anchor = fromDateKey(state.selected);
    loadCalendar(true);
  }

  function openEventDialog(eventID = "", selectedDate = state.selected) {
    if (state.saving) return;
    eventDirty = false;
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
    if (state.saving) return;
    const start = new Date($("#calendar-event-start").value), end = new Date($("#calendar-event-end").value);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { notify("结束时间必须晚于开始时间。", true); return; }
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
    state.saving = true;
    $("#calendar-event-form").querySelectorAll("button,input,select,textarea").forEach(node => node.disabled = true);
    try {
      await api(id ? `/api/v1/calendar/events/${id}` : "/api/v1/calendar/events", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
      // Notification permission is requested only through an explicit reminder action.
      eventDirty = false;
      $("#calendar-event-dialog").close();
      await loadCalendar();
      notify(id ? "日程已更新。" : "日程已创建。持续安排，也给自己留出余量。");
    } catch (error) { notify(error.message + "，请核对日历后再重试。", true); }
    finally {
      state.saving = false;
      $("#calendar-event-form").querySelectorAll("button,input,select,textarea").forEach(node => node.disabled = false);
    }
  }

  async function deleteEvent() {
    if (state.saving) return;
    const id = $("#calendar-event-id").value;
    if (!id || !window.confirm("删除这个日程及其全部重复实例？")) return;
    try { await api(`/api/v1/calendar/events/${id}`, { method: "DELETE" }); $("#calendar-event-dialog").close(); await loadCalendar(); notify("日程已删除。"); }
    catch (error) { notify(error.message, true); }
  }

  function bind() {
    window.addEventListener('daynest:fitness-changed',fitnessChanged);
    window.addEventListener('daynest:care-changed',fitnessChanged);
    window.addEventListener('daynest:calendar-date',event=>{const day=event.detail?.date;if(!token()||typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<'2000-01-01'||day>'2100-12-31'||dateKey(fromDateKey(day))!==day)return;state.selected=day;state.anchor=fromDateKey(day);if($('#panel-calendar').classList.contains('active'))loadCalendar();});
    const tools = $("#calendar-tools-dialog");
    let toolsTrigger = null;
    function openTools(mode) {
      toolsTrigger = $("#calendar-" + mode + "-open");
      $("#calendar-tools-title").textContent = mode === "search" ? "搜索日程" : "筛选与日期跳转";
      $("#calendar-search-fields").classList.toggle("hidden", mode !== "search");
      $("#calendar-filter-fields").classList.toggle("hidden", mode !== "filter");
      tools.showModal();
      $(mode === "search" ? "#calendar-search" : "#calendar-source").focus();
    }
    $("#calendar-search-open").addEventListener("click", () => openTools("search"));
    $("#calendar-filter-open").addEventListener("click", () => openTools("filter"));
    ["close", "done"].forEach(id => $("#calendar-tools-" + id).addEventListener("click", () => tools.close()));
    tools.addEventListener("close", () => toolsTrigger?.focus());
    $("#calendar-search").addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); tools.close(); } });
    if (!["year","month","week","day"].includes(state.view)) state.view = "month";
    $("#calendar-jump").addEventListener("change", () => {
      const value = $("#calendar-jump").value;
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return;
      state.anchor = fromDateKey(value); state.selected = value; loadCalendar(true);
    });
    const filter = () => {
      state.query = $("#calendar-search").value.trim().toLowerCase();
      state.source = $("#calendar-source").value || "all";
      renderCalendar(); renderAgenda();
    };
    $("#calendar-search").addEventListener("input", filter);
    $("#calendar-source").addEventListener("change", filter);
    $("#calendar-reset-filters").addEventListener("click", () => {
      $("#calendar-search").value = ""; $("#calendar-source").value = "all"; filter();
    });
    $("#calendar-canvas").addEventListener("keydown", async event => {
      const cell = event.target.closest("[data-calendar-date]");
      const shifts = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7};
      if (state.view !== "month" || !cell || event.altKey || event.ctrlKey || event.metaKey || !(event.key in shifts)) return;
      event.preventDefault(); event.stopPropagation();
      const value = dateKey(addDays(fromDateKey(cell.dataset.calendarDate), shifts[event.key]));
      await selectDay(value);
      $("#calendar-canvas").querySelector('[data-calendar-date="' + state.selected + '"]')?.focus();
    });
    $("#calendar-day-agenda").addEventListener("keydown", event => {
      const target = event.target.closest("[data-calendar-event]");
      if (target && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openEventDialog(target.dataset.calendarEvent); }
    });
    const resetOwner = () => {
      if (state.owner === token()) return;
      state.owner = token(); state.requestID++; state.detailRequestID++; state.historyRequestID++;
      state.initialized = false;
      state.overview = null; state.detail = null; state.loading = false;
      state.selected = dateKey(new Date()); state.anchor = new Date();
      eventDirty = false;
      $("#calendar-event-dialog").close(); $("#calendar-event-form").reset();
      tools.close();
      state.query = ""; state.source = "all";
      $("#calendar-search").value = ""; $("#calendar-source").value = "all";
      renderCalendar(); renderAgenda();
      $("#calendar-history").textContent = ""; $("#calendar-history-source").textContent = "";
      if (state.owner && $("#panel-calendar").classList.contains("active")) loadCalendar();
    };
    if (typeof MutationObserver !== "undefined") new MutationObserver(resetOwner).observe($("#app-view"), {attributes:true,attributeFilter:["class"]});
    if (typeof MutationObserver !== 'undefined') new MutationObserver(() => {
      if (token() && $('#panel-calendar').classList.contains('active') && !state.initialized) { state.initialized = true; loadCalendar(); }
    }).observe($('#panel-calendar'), { attributes: true, attributeFilter: ['class'] });
    window.addEventListener("storage", e => { if (e.key === "studyflow.token") resetOwner(); else if(["daynest.fitness.changed","daynest.care.changed"].includes(e.key))fitnessChanged(); });

    $("[data-view=calendar]")?.addEventListener("click", () => {
	  activateCalendarPanel();
	  state.initialized = true;
	  loadCalendar();
	});
    const canCloseEvent = () => !state.saving && (!eventDirty || window.confirm('日程尚未保存，确定放弃修改吗？'));
    $("#calendar-event-form").addEventListener('input', () => { eventDirty = true; });
    $("#calendar-event-form").addEventListener('change', () => { eventDirty = true; });
    $("#calendar-event-dialog").addEventListener("cancel", event => { if (!canCloseEvent()) event.preventDefault(); });
    window.DaynestUI?.registerGuard?.('calendar', () => eventDirty && $('#calendar-event-dialog').open || state.saving);window.addEventListener('beforeunload', event => { if (eventDirty && $('#calendar-event-dialog').open || state.saving) { event.preventDefault(); event.returnValue = ''; } });
    $("#calendar-prev").addEventListener("click", () => navigate(-1));
    $("#calendar-next").addEventListener("click", () => navigate(1));
    $("#calendar-today").addEventListener("click", () => { state.anchor = new Date(); state.selected = dateKey(new Date()); state.direction = 0; loadCalendar(true); });
    document.querySelectorAll("[data-calendar-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.calendarView)));
    $("#calendar-create").addEventListener("click", () => openEventDialog());
    $("#calendar-quick-create").addEventListener("click", () => openEventDialog());
    $("#calendar-dialog-close").addEventListener("click", () => { if (canCloseEvent()) $("#calendar-event-dialog").close(); });
    $("#calendar-event-cancel").addEventListener("click", () => { if (canCloseEvent()) $("#calendar-event-dialog").close(); });
    $("#calendar-event-delete").addEventListener("click", deleteEvent);
    $("#calendar-event-form").addEventListener("submit", saveEvent);
    $("#calendar-notification-enable").addEventListener('click', async () => {
      if (!("Notification" in window)) { notify('当前浏览器不支持系统通知；需要 HTTPS 或 localhost。', true); return; }
      try { const permission = await Notification.requestPermission(); notify(permission === 'granted' ? '已允许提醒。网页关闭或设备休眠时不保证送达。' : '未开启浏览器提醒，仍可在日历中查看安排。', permission !== 'granted'); }
      catch (_) { notify('浏览器未允许通知，请检查站点权限。', true); }
    });
    $("#calendar-canvas").addEventListener("click", async (event) => {
	  if (event.target.closest("[data-calendar-retry]")) { await loadCalendar(); return; }
      const fitnessButton=event.target.closest("[data-calendar-fitness]");if(fitnessButton){openFitness(fitnessButton.dataset.calendarFitness);return;}
      const careButton=event.target.closest('[data-calendar-care]');if(careButton){openCare(careButton.dataset.calendarCare);return;}
      const eventButton = event.target.closest("[data-calendar-event]"); if (eventButton) { event.stopPropagation(); openEventDialog(eventButton.dataset.calendarEvent); return; }
      const month = event.target.closest("[data-calendar-month]"); if (month) { state.anchor = new Date(state.anchor.getFullYear(), Number(month.dataset.calendarMonth), 1); state.selected = dateKey(state.anchor); setView("month"); return; }
      const day = event.target.closest("[data-calendar-date]"); if (day) { await selectDay(day.dataset.calendarDate, state.view === "day"); }
    });
    $("#calendar-day-agenda").addEventListener("click", (event) => { const care=event.target.closest("[data-calendar-care]");if(care){openCare(care.dataset.calendarCare);return;}const fitness=event.target.closest("[data-calendar-fitness]");if(fitness){openFitness(fitness.dataset.calendarFitness);return;}const target = event.target.closest("[data-calendar-event]"); if (target) openEventDialog(target.dataset.calendarEvent); });
	$("#calendar-history").addEventListener("click", (event) => { if (event.target.closest("[data-history-retry]")) loadHistory(state.selected); });
    window.addEventListener("keydown", (event) => {
      if (!$("#panel-calendar").classList.contains("active") || $("#calendar-event-dialog").open || tools.open || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName) || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
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
  function fitnessDescription(day){return day.completed_sessions>0?`完成 / 补记 ${day.completed_sessions} 次 · 记录 ${Math.floor(day.recorded_seconds/60)} 分钟（含休息）${day.manual_check_in?' · 另有手动打卡':''}`:'手动打卡 · 未填写运动时长';}
  function openFitness(day){if(typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('daynest:fitness-date',{detail:{date:day}}));$('.nav-link[data-view="fitness"]')?.click();}
  function openCare(id){$('.nav-link[data-view="care"]')?.click();if(typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('daynest:care-item',{detail:{id}}));}
  function fitnessChanged(){if(!token())return;state.fitnessDirty=true;if($('#panel-calendar').classList.contains('active')&&!state.loading)loadCalendar();}
  function clock(date) { return Number.isNaN(date.getTime()) ? "" : `${pad(date.getHours())}:${pad(date.getMinutes())}`; }
  function calendarMood(value) {
    return [
      { value: "awful", label: "很糟" }, { value: "low", label: "低落" },
      { value: "neutral", label: "平静" }, { value: "good", label: "不错" },
      { value: "great", label: "很好" },
    ].find(mood => mood.value === value) || { value: "neutral", label: "平静" };
  }

  function calendarItemTitle(item) {
    if (item.type !== "mood") return escapeHTML(item.title);
    const mood = calendarMood(item.raw?.mood);
    return `<img class="calendar-mood-icon" src="/static/mood-art/${mood.value}-flat-v2.png" width="20" height="20" alt="" aria-hidden="true" draggable="false" loading="lazy" decoding="async"><span class="calendar-mood-label">${escapeHTML(item.title)}</span>`;
  }
  function typeLabel(value) { return ({ plan: "学习计划", task: "学习任务", todo: "待办事项", mood: "心情日记", fitness: "运动日常", care: "生活保养站" })[value] || value; }

  bind();
})();
