(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const E = window.DaynestCalendarEditorCore;
  const pad = (value) => String(value).padStart(2, "0");
  const escapeHTML = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function fromDateKey(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
  function addDays(date, count) { const next = new Date(date); next.setDate(next.getDate() + count); return next; }
  function startOfWeek(date) { const start = new Date(date); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return start; }
  function formatDateTimeLocal(date) { return `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
  function validColor(value, fallback = "#5b81ff") { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback; }
  function isToday(value) { return value === eventDay(new Date().toISOString()); }
  function eventDay(value) { return E ? E.day(value) : dateKey(new Date(value)); }
  function token() { return localStorage.getItem("studyflow.token") || ""; }

  // Helpers must be initialized before state because the initial selected day
  // is derived through dateKey(), which itself uses the pad() constant above.
  const state = {
    view: localStorage.getItem("studyflow.calendar.view") || "month",
    anchor: fromDateKey(eventDay(new Date().toISOString())), selected: eventDay(new Date().toISOString()), overview: null, detail: null,
    saving: false, requestID: 0, detailRequestID: 0, query: '', source: 'all', owner: token(), loading: false, fitnessDirty: false, initialized: false, direction: 1, historyRequestID: 0, historyCache: new Map(), historyController: null,
  };
  async function api(path, options = {}) {
    if (window.DaynestHTTP) return window.DaynestHTTP.json(path, options);
    // Read-only first-paint harness; the real editor requires the common client.
    if (options.method && options.method !== "GET") throw Error("请刷新页面加载日历请求模块。");
    const owner=token(), response=await fetch(path,{...options,headers:owner?{Authorization:"Bearer "+owner}:{},cache:"no-store"});
    const payload=await response.json();
    if(owner!==token())throw Error("账号已变化。");
    if(!response.ok)throw Error(payload?.error?.message||"日历暂不可用。");
    return payload.data;
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
    if (state.view === "agenda") { const start = fromDateKey(dateKey(anchor)); return [start, addDays(start, 31)]; }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(first);
    return [start, addDays(start, 42)];
  }

  async function loadCalendar(animate = false) {
    const requestID = ++state.requestID, owner = token();
    const canvas = $("#calendar-canvas");
    if (!owner) { renderCalendar(); showCalendarError("请先登录后查看个人日程。"); return; }
    if(window.DaynestHTTP&&!window.DaynestHTTP.capture().userID){renderCalendar();$("#calendar-view-status").textContent="正在核验当前账号…";return;}
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
    $("#calendar-offline-open")?.setAttribute("data-selected-date",state.selected);
    const anchor = state.anchor;
    const titles = {
      year: `${anchor.getFullYear()} 年`,
      month: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(anchor),
      week: `${shortDate(startOfWeek(anchor))} – ${shortDate(addDays(startOfWeek(anchor), 6))}`,
      day: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(anchor),
      agenda: `${shortDate(anchor)}起的日程`,
    };
    $("#calendar-title").textContent = titles[state.view];
    $("#calendar-jump").value = state.selected;
    $("#calendar-search-open").dataset.filtered = String(Boolean(state.query));
    $("#calendar-filter-open").dataset.filtered = String(state.source !== "all");
    $("#calendar-search-open").setAttribute("aria-label", state.query ? "搜索日程，已有搜索条件" : "搜索日程");
    $("#calendar-filter-open").setAttribute("aria-label", state.source !== "all" ? "筛选与日期跳转，已有来源筛选" : "筛选与日期跳转");
    const count = [...itemsByDate().values()].reduce((n, items) => n + items.length, 0);
    $("#calendar-view-status").textContent = (state.query || state.source !== 'all' ? '筛选后 · ' : '') + '当前日期范围 ' + count + ' 项安排 · 选择日期查看详情';
    if (state.loading && !state.overview) $("#calendar-view-status").textContent = "正在同步日程…";
    document.querySelectorAll("[data-calendar-view]").forEach(button => {
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(button.dataset.calendarView === state.view));
    });
    $("#panel-calendar").dataset.calendarMode = state.view;
    document.querySelectorAll("[data-calendar-view]").forEach((button) => button.classList.toggle("active", button.dataset.calendarView === state.view));
    $("#calendar-weekdays").classList.toggle("hidden", state.view !== "month");
    if (state.view === "year") renderYear(); else if (state.view === "month") renderMonth(); else if (state.view === "agenda") renderListView(); else renderTimeView();
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
    const [rangeStart,rangeEnd]=rangeForView();
    (state.overview?.events || []).forEach(item=>{
      const start=item.occurrence_start||item.start_at,end=item.occurrence_end||item.end_at;
      const dates=E&&end?E.covered(start,end,dateKey(rangeStart),dateKey(rangeEnd)):[eventDay(start)];
      dates.forEach(day=>add(day,{type:"event",id:item.id,title:item.title,time:item.all_day?"全天":day===eventDay(start)?clock(new Date(start)):"00:00 · 续",color:validColor(item.color),raw:item}));
    });
    (state.overview?.plan_blocks || []).forEach((item) => add(eventDay(item.start_at), { type: "plan", id: item.id, title: item.title, time: clock(new Date(item.start_at)), color: "#845fe8", raw: item }));
    (state.overview?.tasks || []).forEach((item) => add(eventDay(item.due_at), { type: "task", id: item.id, title: `任务 · ${item.title}`, time: clock(new Date(item.due_at)), color: "#e5963e", raw: item }));
    (state.overview?.todos || []).forEach((item) => add(item.due_at ? eventDay(item.due_at) : item.my_day_date, { type: "todo", id: item.id, title: `待办 · ${item.title}`, time: item.due_at ? clock(new Date(item.due_at)) : "当天", color: "#e5963e", raw: item }));
    (state.overview?.focus_sessions || []).forEach(item=>add(eventDay(item.started_at),{type:"focus",id:item.id,title:`专注 · ${item.title_snapshot || (state.overview?.tasks||[]).find(t=>t.id===item.task_id)?.title || "自由专注"}`,time:clock(new Date(item.started_at)),color:"#577e9a",raw:item}));
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

  function renderListView() {
    const entries = [...itemsByDate()].sort(([a], [b]) => a.localeCompare(b));
    $("#calendar-canvas").innerHTML = entries.length ? `<div class="calendar-list">${entries.map(([day, items]) => `
      <section class="calendar-list-day"><button type="button" class="calendar-list-date" data-calendar-date="${day}" aria-label="${day}"><strong>${fromDateKey(day).getDate()}</strong><small>${fromDateKey(day).getMonth()+1}月<br>${new Intl.DateTimeFormat('zh-CN', {weekday: 'short'}).format(fromDateKey(day))}</small></button>
      <div>${items.map(item => `<button type="button" class="calendar-list-event" title="${escapeHTML(item.title)}" ${item.type === 'event' ? `data-calendar-event="${escapeHTML(item.id)}"` : `data-calendar-date="${day}"`} style="--item-color:${item.color}"><time>${escapeHTML(item.time)}</time><span><b>${calendarItemTitle(item)}</b><small>${escapeHTML(typeLabel(item.type))}</small></span></button>`).join('')}</div></section>`).join('')}</div>` : `<div class="empty-state">${state.loading ? '正在同步日程…' : '未来 31 天没有符合条件的安排。'}</div>`;
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
      const currentLine = isToday(key) ? `<i class="calendar-current-line" style="top:${(Number(clock(new Date()).slice(0,2)) * 60 + Number(clock(new Date()).slice(3,5))) * .8}px"></i>` : "";
      const timed = (events.get(key) || []).filter(item => ['event', 'plan'].includes(item.type) && !item.raw.all_day);
      columns += `<div class="calendar-time-column" data-calendar-date="${key}">${currentLine}${timedLayouts(timed, key).map(layout => timedEventHTML(layout.item, key, layout)).join("")}</div>`;
    }
    const fitnessDays=Array.from({length:count},(_,i)=>dateKey(addDays(start,i)));
    const fitnessStrip=fitnessDays.some(day=>(events.get(day)||[]).some(item=>['fitness','care'].includes(item.type)))?`<div class="calendar-fitness-strip"><span>记录</span>${fitnessDays.map(day=>{const entries=(events.get(day)||[]).filter(item=>['fitness','care'].includes(item.type));return `<div>${entries.slice(0,3).map(item=>item.type==='fitness'?`<button type="button" data-calendar-fitness="${day}" title="${escapeHTML(fitnessDescription(item.raw))}">✓ 已锻炼</button>`:`<button type="button" data-calendar-care="${escapeHTML(item.raw.item_id)}">${escapeHTML(item.title)}</button>`).join('')}${entries.length>3?`<button type="button" data-calendar-date="${day}">另 ${entries.length-3} 条</button>`:''}</div>`;}).join('')}</div>`:'';
    const allDay=fitnessDays.some(day=>(events.get(day)||[]).some(item=>item.type==='event'&&item.raw.all_day))?`<div class="calendar-all-day-strip"><span>全天</span>${fitnessDays.map(day=>`<div>${(events.get(day)||[]).filter(item=>item.type==='event'&&item.raw.all_day).map(item=>`<button type="button" data-calendar-event="${escapeHTML(item.id)}" style="--item-color:${item.color}">${escapeHTML(item.title)}</button>`).join('')}</div>`).join('')}</div>`:'';
    $("#calendar-canvas").innerHTML = `<div class="calendar-time-scroll"><div class="calendar-time-view" style="--day-count:${count}"><div class="calendar-time-head">${heads}</div>${allDay}${fitnessStrip}<div class="calendar-time-grid">${columns}</div></div></div>`;
    const selectedItems = events.get(state.selected) || [];
    const first = selectedItems.find(item => ['event', 'plan'].includes(item.type) && !item.raw.all_day);
    const hour = first ? Number(first.time.slice(0, 2)) : 8;
    requestAnimationFrame(() => {
      const scroll = $("#calendar-canvas").querySelector('.calendar-time-scroll');
      if (scroll) scroll.scrollTop = Math.max(0, hour * 48 - 40);
    });
  }

  function timedLayouts(items, day) {
    const midnight = E ? Date.parse(E.iso(day, true)) : fromDateKey(day).getTime();
    const rows = items.map(item => {
      const start = Math.max(0, (Date.parse(item.raw.occurrence_start || item.raw.start_at) - midnight) / 60000);
      const end = Math.min(1440, (Date.parse(item.raw.occurrence_end || item.raw.end_at) - midnight) / 60000);
      return {item, start, end: Math.max(start + 30, end), lane: 0, lanes: 1};
    }).sort((a, b) => a.start - b.start || b.end - a.end);
    let group = [], ends = [], groupEnd = 0;
    function finish() { for (const row of group) row.lanes = ends.length; }
    for (const row of rows) {
      if (row.start >= groupEnd) { finish(); group = []; ends = []; }
      let lane = ends.findIndex(end => end <= row.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = row.end;
      row.lane = lane;
      group.push(row);
      groupEnd = Math.max(...ends);
    }
    finish();
    return rows;
  }

  function timedEventHTML(item, day, layout) {
    const rawStart = item.raw.occurrence_start || item.raw.start_at;
    const rawEnd = item.raw.occurrence_end || item.raw.end_at;
    const start = new Date(rawStart), end = new Date(rawEnd);
    const midnight = E&&day?Date.parse(E.iso(day,true)):new Date(start.getFullYear(),start.getMonth(),start.getDate()).getTime();
    const minutes=Math.max(0,(start.getTime()-midnight)/60000),endMinutes=Math.min(1440,(end.getTime()-midnight)/60000);
    const top=Math.min(1128,minutes*.8),height=Math.min(1152-top,Math.max(24,(endMinutes-minutes)*.8));
    const eventAttribute = item.type === "event" ? `data-calendar-event="${escapeHTML(item.id)}"` : "";
    return `<button type="button" class="calendar-timed-event" ${eventAttribute} title="${escapeHTML(item.title)} · ${escapeHTML(item.time)}" style="top:${top}px;height:${height}px;--item-color:${item.color};left:calc(4px + (100% - 8px) * ${layout.lane} / ${layout.lanes});width:calc((100% - 8px) / ${layout.lanes} - 3px);right:auto"><b>${escapeHTML(item.title)}</b><br>${escapeHTML(item.time)}</button>`;
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
    state.historyRequestID++;
    state.historyController?.abort();
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
    const requestID = ++state.historyRequestID, owner = token();
    state.historyController?.abort();
    const cached = state.historyCache.get(value.slice(5));
    if (cached && Date.now() - cached.at < 86400000) {
      if (state.detail?.date === value) {
        state.detail.history = cached.events;
        state.detail.history_source = cached.source;
        renderHistory();
      }
      return;
    }
    $("#calendar-history").innerHTML = '<div class="empty-state">\u6b63\u5728\u8bfb\u53d6\u5386\u53f2\u4e8b\u4ef6\u2026</div>';
    $("#calendar-history-source").textContent = "";
    const controller = new AbortController();
    state.historyController = controller;
    const timeoutID = window.setTimeout(() => controller.abort(), 8000);
    try {
      const detail = await api(`/api/v1/calendar/days/${value}?history=true`, { signal: controller.signal });
      if (requestID !== state.historyRequestID || state.detail?.date !== value || owner !== token()) return;
      state.detail.history = detail.history || [];
      state.detail.history_source = detail.history_source || "";
      if (detail.history?.length) state.historyCache.set(value.slice(5), {events: detail.history, source: detail.history_source, at: Date.now()});
      renderHistory();
    } catch {
      if (requestID !== state.historyRequestID || state.detail?.date !== value || owner !== token()) return;
      $("#calendar-history").innerHTML = '<div class="empty-state">\u5386\u53f2\u4e8b\u4ef6\u6682\u672a\u52a0\u8f7d\u3002<button class="text-button" type="button" data-history-retry>\u91cd\u65b0\u52a0\u8f7d</button></div>';
      $("#calendar-history-source").textContent = "";
    } finally {
      window.clearTimeout(timeoutID);
      if (state.historyController === controller) state.historyController = null;
    }
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
    }).join("") : '<div class="empty-state">\u6682\u672a\u53d6\u5f97\u8fd9\u4e00\u5929\u7684\u5386\u53f2\u6761\u76ee\u3002<button class="text-button" type="button" data-history-retry>\u91cd\u65b0\u52a0\u8f7d</button></div>';
    $("#calendar-history-source").textContent = detail.history_source ? `内容来源：${detail.history_source}` : "";
  }

  function historyYearLabel(year) { return year < 0 ? `前${Math.abs(year)}` : (year || "—"); }

  function renderAgenda() {
    const items = itemsByDate().get(state.selected) || [];
    const agenda = $("#calendar-day-agenda");
    $("#calendar-agenda-title").textContent = `${shortDate(fromDateKey(state.selected))} · ${items.length} 项安排`;
    agenda.classList.toggle("empty-state", !items.length);
    agenda.innerHTML = items.length ? items.map((item) => `<div class="calendar-agenda-item" ${item.type === "event" ? `role="button" tabindex="0" aria-label="编辑 ${escapeHTML(item.title)}" data-calendar-event="${escapeHTML(item.id)}"` : ""}><span class="calendar-agenda-time">${escapeHTML(item.time)}</span><i class="calendar-agenda-color" style="--item-color:${item.color}"></i><span><b>${calendarItemTitle(item)}</b><small>${escapeHTML(item.type === "event" ? item.raw.category : item.type === "fitness" ? fitnessDescription(item.raw) : item.type === "focus" ? `${item.raw.actual_minutes} 分钟 · 已完成` : typeLabel(item.type))}</small>${(item.type === "todo" || (item.type === "focus" && item.raw.todo_id)) ? `<button type="button" class="calendar-fitness-link" ${item.raw.memo_action_id ? `data-action-link="${escapeHTML(item.raw.memo_action_id)}"` : `data-action-todo-context="${escapeHTML(item.type === "todo" ? item.id : item.raw.todo_id)}"`}>查看待办与专注 ↗</button>` : ""}${item.type === "fitness" ? `<button type="button" class="calendar-fitness-link" data-calendar-fitness="${escapeHTML(item.raw.date)}">查看运动记录 ↗</button>` : item.type === "care" ? `<button type="button" class="calendar-fitness-link" data-calendar-care="${escapeHTML(item.raw.item_id)}">查看保养事项 ↗</button>` : ""}</span></div>`).join("") : "这一天还没有安排。";
  }

  function navigate(direction) {
    state.direction = direction;
    const anchor = new Date(state.anchor);
    if (state.view === "year") anchor.setFullYear(anchor.getFullYear() + direction);
    else if (state.view === "month") anchor.setMonth(anchor.getMonth() + direction, 1);
    else if (state.view === "agenda") anchor.setDate(anchor.getDate() + 31 * direction);
    else if (state.view === "week") anchor.setDate(anchor.getDate() + 7 * direction);
    else anchor.setDate(anchor.getDate() + direction);
    state.anchor = anchor;
    state.selected = dateKey(anchor);
    loadCalendar(true);
  }

  function setView(view) {
    if (!["year", "month", "week", "day", "agenda"].includes(view) || state.view === view) return;
    state.view = view;
    try { localStorage.setItem("studyflow.calendar.view", view); } catch {}
    state.anchor = fromDateKey(state.selected);
    loadCalendar(true);
  }

  function openEventDialog(eventID = "", selectedDate = state.selected, minutes = null) {
    if (window.DaynestCalendarEvents) return window.DaynestCalendarEvents.open(eventID,selectedDate,minutes);
    notify("日程编辑模块未加载，请刷新页面并核对服务版本。",true);
  }

  function bind() {
    let gesture = null, suppressDateClick = false;
    const canvas = $("#calendar-canvas");
    canvas.addEventListener('pointerdown', event => {
      if (!['month', 'year'].includes(state.view) || event.isPrimary === false || event.button > 0) return;
      gesture = {x: event.clientX, y: event.clientY, at: Date.now()};
    });
    canvas.addEventListener('pointercancel', () => { gesture = null; });
    canvas.addEventListener('pointerup', event => {
      if (!gesture) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y, elapsed = Date.now() - gesture.at;
      gesture = null;
      if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.6 || elapsed > 900) return;
      suppressDateClick = true;
      window.setTimeout(() => { suppressDateClick = false; }, 400);
      navigate(dx < 0 ? 1 : -1);
    });
    canvas.addEventListener('click', event => {
      if (suppressDateClick) { suppressDateClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    document.addEventListener("daynest:account-ready",()=>{if(token()&&$("#panel-calendar").classList.contains("active")){state.initialized=true;loadCalendar();}else state.initialized=false;});
    window.addEventListener('daynest:fitness-changed',fitnessChanged);
    document.addEventListener('daynest:focus-changed',fitnessChanged);
    document.addEventListener('daynest:actions-changed',fitnessChanged);
    document.addEventListener('daynest:calendar-events-changed',fitnessChanged);
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
    $("#calendar-date-open").addEventListener("click", () => { openTools("filter"); toolsTrigger = $("#calendar-date-open"); $("#calendar-jump").focus(); });
    ["close", "done"].forEach(id => $("#calendar-tools-" + id).addEventListener("click", () => tools.close()));
    tools.addEventListener("close", () => toolsTrigger?.focus());
    tools.addEventListener('click', event => {
      if (event.target.closest('#calendar-recovery-open, #calendar-offline-open')) tools.close();
    });
    $("#calendar-search").addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); tools.close(); } });
    if (!["year","month","week","day","agenda"].includes(state.view)) state.view = "month";
    $("#calendar-jump").addEventListener("change", () => {
      const value = $("#calendar-jump").value;
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31' || dateKey(fromDateKey(value)) !== value) return;
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
      state.historyController?.abort();
      state.initialized = false;
      state.overview = null; state.detail = null; state.loading = false;
      state.selected = eventDay(new Date().toISOString()); state.anchor = fromDateKey(state.selected);
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
    $("#calendar-prev").addEventListener("click", () => navigate(-1));
    $("#calendar-next").addEventListener("click", () => navigate(1));
    $("#calendar-today").addEventListener("click", () => { state.selected = eventDay(new Date().toISOString()); state.anchor = fromDateKey(state.selected); state.direction = 0; loadCalendar(true); });
    document.querySelectorAll("[data-calendar-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.calendarView)));
    $("#calendar-create").addEventListener("click", () => openEventDialog());
    $("#calendar-quick-create").addEventListener("click", () => openEventDialog());
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
      const timeColumn = event.target.closest('.calendar-time-column');
      if (timeColumn && !event.target.closest('button')) {
        const minutes = Math.min(1410, Math.max(0, Math.floor((event.clientY - timeColumn.getBoundingClientRect().top) / 24) * 30));
        openEventDialog('', timeColumn.dataset.calendarDate, minutes);
        return;
      }
      const month = event.target.closest("[data-calendar-month]"); if (month) { state.anchor = new Date(state.anchor.getFullYear(), Number(month.dataset.calendarMonth), 1); state.selected = dateKey(state.anchor); setView("month"); return; }
      const day = event.target.closest("[data-calendar-date]"); if (day) { await selectDay(day.dataset.calendarDate, state.view === "day"); }
    });
    $("#calendar-day-agenda").addEventListener("click", (event) => { const care=event.target.closest("[data-calendar-care]");if(care){openCare(care.dataset.calendarCare);return;}const fitness=event.target.closest("[data-calendar-fitness]");if(fitness){openFitness(fitness.dataset.calendarFitness);return;}const target = event.target.closest("[data-calendar-event]"); if (target) openEventDialog(target.dataset.calendarEvent); });
	$("#calendar-history").addEventListener("click", (event) => { if (event.target.closest("[data-history-retry]")) loadHistory(state.selected); });
    window.addEventListener("keydown", (event) => {
      if (!$("#panel-calendar").classList.contains("active") || $("#calendar-event-dialog").open || tools.open || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName) || event.target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "arrowleft") navigate(-1); else if (key === "arrowright") navigate(1); else if (key === "t") { state.selected = eventDay(new Date().toISOString()); state.anchor = fromDateKey(state.selected); loadCalendar(true); }
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
  function clock(date) { return Number.isNaN(date.getTime()) ? "" : E?E.wall(date.toISOString()).slice(11):`${pad(date.getHours())}:${pad(date.getMinutes())}`; }
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
  function typeLabel(value) { return ({ event: "个人日程", plan: "学习计划", task: "学习任务", todo: "待办事项", mood: "心情日记", fitness: "运动日常", care: "生活保养站", focus: "已完成专注" })[value] || value; }

  bind();
})();
