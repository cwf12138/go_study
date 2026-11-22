const filters = [
  { key: 'pending', label: '今天待做', empty: '今天没有待做事项。' },
  { key: 'overdue', label: '已逾期', empty: '没有逾期的待办。' },
  { key: 'done', label: '今日完成', empty: '今天的完成记录会显示在这里。' },
];
const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTime = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const rank = { high: 0, medium: 1, low: 2 };

function bounds(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: +start, end: +end };
}

export function classifyToday(todos, calendar, day, now) {
  const { start, end } = bounds(now);
  const lists = { pending: [], overdue: [], done: [] };
  for (const todo of todos) {
    const due = Date.parse(todo.due_at), completed = Date.parse(todo.completed_at);
    if (todo.status === 'completed') {
      if (completed >= start && completed < end) lists.done.push({ todo, completed });
    } else if (due < now) {
      lists.overdue.push({ todo, due });
    } else if (todo.my_day_date === day || due < end) {
      lists.pending.push({ todo, due });
    }
  }
  const dueTime = row => Number.isFinite(row.due) ? row.due : Infinity;
  const byDue = (a, b) => dueTime(a) - dueTime(b) ||
    (rank[a.todo.priority] ?? 3) - (rank[b.todo.priority] ?? 3) || a.todo.title.localeCompare(b.todo.title, 'zh-CN');
  lists.pending.sort(byDue);
  lists.overdue.sort(byDue);
  lists.done.sort((a, b) => b.completed - a.completed);

  const agenda = [
    ...(calendar?.events || []).map(item => ({ item, type: 'event', start: Date.parse(item.occurrence_start), end: Date.parse(item.occurrence_end), allDay: item.all_day })),
    ...(calendar?.plan_blocks || []).map(item => ({ item, type: 'plan', start: Date.parse(item.start_at), end: Date.parse(item.end_at), allDay: false })),
  ].filter(row => row.start < end && row.end > start && row.end > row.start)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);

  const upcoming = agenda.filter(row => row.allDay || row.end > now);
  const lead = upcoming.find(row => !row.allDay && row.start <= now) || upcoming.find(row => !row.allDay);
  return { lists, agenda, upcoming, lead };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = element('button', className, text);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function installMobileToday() {
  let root, current, selection = 'pending', expanded = false, allTodos = false;
  let buttons, card, agenda, todos, noteAction, savedMemo;
  function mount() {
    root = document.getElementById('panel-dashboard');
    card = root.querySelector('.today-todos');
    agenda = document.getElementById('today-agenda');
    todos = document.getElementById('today-todos');
    root.classList.add('mobile-today-ready');
    agenda.removeAttribute('role');
    root.querySelector('.today-agenda [data-goto="calendar"]')?.addEventListener('click', () => {
      if (current) window.dispatchEvent(new CustomEvent('daynest:calendar-date', { detail: { date: current.day } }));
    });

    const overview = element('section', 'mobile-today-overview');
    overview.setAttribute('aria-label', '今日待办概览');
    const date = document.getElementById('today-date');
    overview.append(date);
    const segments = element('div', 'mobile-today-segments');
    segments.setAttribute('role', 'group');
    segments.setAttribute('aria-label', '按状态查看待办');
    buttons = filters.map(filter => {
      const node = button('mobile-today-filter', null, () => {
        selection = filter.key;
        allTodos = false;
        paint();
        card.scrollIntoView({ block: 'start' });
      });
      node.append(element('strong', '', '—'), element('span', '', filter.label));
      node.setAttribute('aria-controls', 'today-todos');
      segments.append(node);
      return node;
    });
    overview.append(segments);
    root.querySelector('.today-heading').after(overview);

    noteAction = button('quiet mobile-today-note-action', '将刚保存的备忘录关联到待办', async () => {
      if (!savedMemo || !window.DaynestActions?.openMemo) return;
      try { await window.DaynestActions.openMemo(savedMemo, 0, 0); }
      catch (error) { window.DaynestUI?.notify(error.message, 'error'); }
    });
    noteAction.hidden = true;
    document.getElementById('today-note-form').after(noteAction);
    document.addEventListener('daynest:account-leaving', () => {
      savedMemo = null;
      noteAction.hidden = true;
      current = null;
      selection = 'pending';
      expanded = allTodos = false;
      agenda.replaceChildren();
      todos.replaceChildren();
      for (const node of buttons) {
        node.firstElementChild.textContent = '—';
        node.disabled = true;
      }
    });
  }

  function readState(target, state, name) {
    if (state === 'ready') return true;
    const box = element('div', 'mobile-today-empty', state === 'error' ? `${name}暂未加载成功。` : `正在读取${name}…`);
    if (state === 'error') box.append(button('quiet', '重试', async event => {
      const control = event.currentTarget;
      control.disabled = true;
      try { await current.retry(); }
      catch (error) { window.DaynestUI?.notify(error.message, 'error'); }
      finally { control.disabled = false; }
    }));
    target.replaceChildren(box);
    return false;
  }

  function agendaButton(row, day, now, highlight = false) {
    const { start, end } = bounds(now);
    const when = row.allDay ? '全天' : `${(row.start < start ? dateTime : time).format(row.start)} – ${(row.end >= end ? dateTime : time).format(row.end)}`;
    const phase = row.allDay ? '全天' : row.end <= now ? '已结束' : row.start <= now ? '进行中' : highlight ? '下一项' : '';
    const control = button(`mobile-agenda-item${highlight ? ' mobile-agenda-lead' : ''}`, null, () => {
      if (row.type === 'event' && window.DaynestCalendarEvents?.open) {
        window.DaynestCalendarEvents.open(row.item.id, day, null, row.item.original_start || row.item.occurrence_start);
      } else {
        window.dispatchEvent(new CustomEvent('daynest:calendar-date', { detail: { date: day } }));
        document.querySelector('.nav-link[data-view="calendar"]')?.click();
      }
    });
    const label = element('span', 'mobile-agenda-label');
    label.append(element('small', '', when), element('strong', '', row.item.title));
    control.append(label);
    const details = [phase && phase !== '全天' ? phase : '', row.type === 'plan' ? '学习计划' : '日程'].filter(Boolean).join(' · ');
    control.append(element('span', 'mobile-agenda-kind', details));
    return control;
  }

  function paintAgenda(model) {
    if (!readState(agenda, current.calendarState, '日程')) return;
    const { day, now } = current;
    const lead = model.lead;
    const rows = expanded ? model.agenda : model.upcoming.filter(row => row !== lead).slice(0, lead ? 2 : 3);
    const contents = document.createDocumentFragment();
    if (!expanded && lead) contents.append(agendaButton(lead, day, now, true));
    for (const row of rows) contents.append(agendaButton(row, day, now, row === lead));
    if (!lead && !rows.length) contents.append(element('p', 'mobile-today-empty', model.agenda.length ? '今天的日程均已结束。' : '今天还没有安排。'));
    if (expanded || model.agenda.length > rows.length + Number(!!lead)) {
      const more = button('text-button mobile-today-more', expanded ? '收起日程' : `查看今天全部 ${model.agenda.length} 项`, () => {
        expanded = !expanded;
        paint();
        agenda.querySelector('.mobile-today-more')?.focus({ preventScroll: true });
      });
      more.setAttribute('aria-expanded', String(expanded));
      contents.append(more);
    }
    agenda.replaceChildren(contents);
  }

  function paintTodos(model) {
    buttons.forEach((node, i) => {
      const filter = filters[i];
      node.firstElementChild.textContent = current.todoState === 'ready' ? String(model.lists[filter.key].length) : '—';
      node.setAttribute('aria-pressed', String(selection === filter.key));
      node.disabled = current.todoState !== 'ready';
    });
    card.querySelector('h3').textContent = filters.find(filter => filter.key === selection).label;
    if (!readState(todos, current.todoState, '待办')) return;
    const list = model.lists[selection];
    if (!list.length) {
      todos.replaceChildren(element('p', 'mobile-today-empty', filters.find(filter => filter.key === selection).empty));
      return;
    }
    const rows = document.createDocumentFragment();
    for (const { todo, due, completed } of allTodos ? list : list.slice(0, 5)) {
      const done = todo.status === 'completed';
      const check = button('mobile-today-check', done ? '✓' : '');
      check.dataset.todoCompleted = String(!done);
      check.dataset.id = todo.id;
      check.setAttribute('aria-label', `${done ? '重新打开' : '完成'}待办 ${todo.title}`);
      const detail = button('mobile-today-detail');
      detail.dataset.todoEdit = todo.id;
      detail.append(element('strong', '', todo.title));
      const { start, end } = bounds(current.now);
      const dueText = Number.isFinite(due) ? `${due < current.now ? '逾期' : '截止'} ${(due >= start && due < end ? time : dateTime).format(due)}` : '';
      const meta = [done ? `完成于 ${time.format(completed)}` : dueText || '加入今天', todo.priority === 'high' && !done ? '重要' : ''].filter(Boolean);
      detail.append(element('small', '', meta.join(' · ')));
      const row = element('div', 'mobile-today-todo');
      row.append(check, detail);
      rows.append(row);
    }
    if (list.length > 5) {
      const more = button('text-button mobile-today-more', allTodos ? '收起待办' : `查看全部 ${list.length} 项`, () => {
        allTodos = !allTodos;
        paint();
        todos.querySelector('.mobile-today-more')?.focus({ preventScroll: true });
      });
      more.setAttribute('aria-expanded', String(allTodos));
      rows.append(more);
    }
    todos.replaceChildren(rows);
  }

  function paint() {
    if (!current) return;
    const model = classifyToday(current.todos, current.calendar, current.day, current.now);
    paintAgenda(model);
    paintTodos(model);
  }

  window.DaynestMobileToday = {
    render(data) {
      if (!root) mount();
      if (current && data.day !== current.day) expanded = allTodos = false;
      current = data;
      paint();
    },
    memoSaved(note) {
      if (!noteAction || !note?.id) return;
      savedMemo = note;
      noteAction.hidden = false;
    },
  };
}
