const DAY = 86_400_000;
const LIMIT = 256;

function beijingDate(time) {
  return new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function quietHoursInput(enabled, from, to) {
  const toMinute = value => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  };
  const start = toMinute(from), end = toMinute(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || (enabled && start === end)) {
    throw Error('请选择不同的免打扰开始和结束时间。');
  }
  return { enabled, start, end };
}

function timeValue(minute) {
  return [Math.floor(minute / 60), minute % 60].map(n => String(n).padStart(2, '0')).join(':');
}

export function calendarReminderEntries(overview, start, end, now) {
  if (overview?.start !== start || overview.end !== end || !Object.hasOwn(overview, 'events') ||
      (overview.events !== null && !Array.isArray(overview.events))) throw Error('日程提醒数据不完整。');
  const entries = [], ids = new Set();
  for (const event of overview.events || []) {
    const minutes = event?.reminder_minutes;
    if (minutes === 0) continue;
    const starts = Date.parse(event?.occurrence_start), id = event?.occurrence_id;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 40320 ||
        !Number.isFinite(starts) || !/^[A-Za-z0-9@_.:-]{1,180}$/.test(id || '') || ids.has(id)) {
      throw Error('日程提醒数据格式异常。');
    }
    ids.add(id);
    const at = starts - minutes * 60_000;
    if (starts > now && at <= now + 7 * DAY) entries.push({ id, at, start: starts, date: beijingDate(starts) });
  }
  // Prioritize future alarms if the device hits its queue limit.
  entries.sort((a, b) => Number(a.at <= now) - Number(b.at <= now) || a.at - b.at);
  return { entries: entries.slice(0, LIMIT), limited: entries.length > LIMIT };
}

export function installMobileReminders(App, native) {
  const mount = () => {
    const tools = document.querySelector('#calendar-filter-fields .calendar-extra-actions');
    if (!tools) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'mobile-calendar-reminders'; dialog.className = 'mobile-connection';
    dialog.setAttribute('aria-labelledby', 'mobile-calendar-reminders-title');
    dialog.innerHTML = `<header><h2 id="mobile-calendar-reminders-title">手机日程提醒</h2><button type="button" aria-label="关闭手机日程提醒">×</button></header>
      <p>从日程的「提前提醒」生成未来 7 天的系统通知。开启后可在息屏时接收，投递时间可能受系统省电影响。</p>
      <p id="mobile-reminder-status" role="status" aria-live="polite"></p>
      <div class="mobile-reminder-actions"><button id="mobile-reminder-toggle" type="button" class="primary" disabled>启用提醒</button>
      <button id="mobile-reminder-sync" type="button" class="quiet" hidden>重新同步</button>
      <button id="mobile-reminder-settings" type="button" class="quiet" hidden>Android 通知设置</button>
      <button id="mobile-reminder-exact" type="button" class="quiet" hidden>准时提醒设置</button></div>
      <form class="mobile-reminder-quiet" hidden>
        <fieldset disabled><legend>免打扰</legend>
          <label class="mobile-reminder-quiet-switch"><input type="checkbox" name="quiet">启用免打扰</label>
          <div class="mobile-reminder-quiet-times">
            <label>开始<input name="from" type="time" required></label>
            <label>结束<input name="to" type="time" required></label>
          </div>
          <p>按手机时间计算，支持跨午夜。时段内到点的通知会跳过，日程仍保留在日历中。</p>
          <button type="submit" class="quiet">保存免打扰设置</button>
        </fieldset>
        <p data-quiet-status role="status" hidden></p>
      </form>`;
    document.body.append(dialog);
    const makeOpen = label => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'quiet'; button.textContent = label;
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', dialog.id);
      button.addEventListener('click', () => { if (!dialog.open) dialog.showModal(); sync(); });
      return button;
    };
    tools.append(makeOpen('手机日程提醒'));
    document.getElementById('calendar-event-reminder')?.closest('.calendar-form-row')?.after(makeOpen('设置手机提醒'));

    const toggle = dialog.querySelector('#mobile-reminder-toggle'), reload = dialog.querySelector('#mobile-reminder-sync');
    const settings = dialog.querySelector('#mobile-reminder-settings'), exactSettings = dialog.querySelector('#mobile-reminder-exact');
    const status = dialog.querySelector('#mobile-reminder-status');
    const quietForm = dialog.querySelector('.mobile-reminder-quiet');
    const quietFields = quietForm.querySelector('fieldset'), quietStatus = quietForm.querySelector('[data-quiet-status]');
    const { quiet, from, to } = quietForm.elements;
    let quietDirty = false, quietSaving = false;
    let sequence = 0, request, queue = Promise.resolve(), changing = false, snapshot, appReady = false;
    function withNative(task) {
      const result = queue.then(task);
      queue = result.catch(() => {});
      return result;
    }
    function render(data, message) {
      snapshot = data;
      toggle.disabled = changing || !data;
      toggle.textContent = data?.enabled ? '关闭提醒' : '启用提醒';
      reload.hidden = !data?.enabled || !data?.permitted;
      settings.hidden = data?.permitted !== false;
      exactSettings.hidden = !data?.enabled || !data?.permitted || data.exact;
      if (typeof data?.quietEnabled === 'boolean') {
        quietForm.hidden = false;
        quietFields.disabled = quietSaving;
        if (!quietDirty && !quietSaving) {
          quiet.checked = data.quietEnabled;
          from.value = timeValue(data.quietStart);
          to.value = timeValue(data.quietEnd);
        }
      }
      status.textContent = message ?? (data?.enabled && data.permitted ? `已安排 ${data.count} 条通知。${data.exact ? '已开启准时提醒。' : '当前为普通提醒，系统可能延迟投递。'}`
        : data?.permitted === false ? '请允许 Daynest 发送通知。' : '手机日程提醒已关闭。');
    }
    function invalidate() {
      request?.abort();
      return ++sequence;
    }
    async function clearForAccount() {
      invalidate();
      await withNative(() => native.clear());
    }
    async function sync() {
      if (changing) return;
      const turn = invalidate();
      const http = window.DaynestHTTP, account = window.DaynestAccount?.current?.();
      let currentStatus;
      try {
        currentStatus = await withNative(() => native.status());
        if (turn !== sequence) return;
        if (!account || !http || !currentStatus.enabled || !currentStatus.permitted) {
          render(currentStatus); return;
        }
        const context = http.capture(), now = Date.now();
        const start = beijingDate(now), end = beijingDate(now + 36 * DAY);
        const signal = (request = new AbortController()).signal;
        render(currentStatus, '正在从服务读取日程…');
        const overview = await http.json(`/api/v1/calendar?start=${start}&end=${end}`, { context, signal });
        const result = calendarReminderEntries(overview, start, end, Date.now());
        const data = await withNative(() => turn === sequence && http.current(context) && !http.authExpired()
          ? native.replace({ entries: result.entries }) : null);
        if (turn === sequence && data) render(data, result.limited ? `已安排 ${data.count} 条通知，达到本机容量上限。` : undefined);
      } catch (_) {
        if (turn === sequence) render(currentStatus, currentStatus?.enabled
          ? '同步未完成。此前安排的通知仍可能送达，请联网后重试。' : '暂时无法读取手机提醒状态。');
      }
    }
    async function openReminder() {
      const account = window.DaynestAccount?.current?.();
      if (!appReady || !account) return;
      try {
        const { date } = await native.takeOpenDate();
        if (!date || window.DaynestAccount?.current?.()?.sessionID !== account.sessionID) return;
        window.dispatchEvent(new CustomEvent('daynest:calendar-date', { detail: { date } }));
        document.querySelector('.nav-link[data-view="calendar"]')?.click();
      } catch (_) { /* The date is optional when launching the app. */ }
    }
    dialog.querySelector('header button').addEventListener('click', () => dialog.close());
    function showQuietStatus(message = '') {
      quietStatus.textContent = message;
      quietStatus.hidden = !message;
    }
    dialog.addEventListener('close', () => {
      quietDirty = false;
      showQuietStatus();
    });
    quietForm.addEventListener('input', () => {
      quietDirty = true;
      showQuietStatus();
    });
    quietForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (quietSaving) return;
      try {
        const settings = quietHoursInput(quiet.checked, from.value, to.value);
        quietSaving = quietFields.disabled = true;
        showQuietStatus('正在保存…');
        const data = await withNative(() => native.setQuietHours(settings));
        quietDirty = false;
        if (snapshot) snapshot = { ...snapshot, quietEnabled: data.quietEnabled, quietStart: data.quietStart, quietEnd: data.quietEnd };
        if (dialog.open) showQuietStatus('免打扰设置已保存到此设备。');
      } catch (error) {
        showQuietStatus(error.message || '无法保存免打扰设置，请重试。');
      } finally {
        quietSaving = quietFields.disabled = false;
      }
    });
    reload.addEventListener('click', sync);
    settings.addEventListener('click', () => native.openSettings().catch(error => render(snapshot, error.message)));
    exactSettings.addEventListener('click', () => native.openExactSettings().catch(error => render(snapshot, error.message)));
    toggle.addEventListener('click', async () => {
      changing = true;
      invalidate();
      render(snapshot, '正在更新通知设置…');
      try {
        render(await withNative(() => snapshot?.enabled ? native.disable() : native.enable()));
      } catch (error) {
        render(snapshot, error.message);
      } finally {
        changing = false;
        toggle.disabled = !snapshot;
      }
      if (snapshot?.enabled && snapshot.permitted) sync();
    });
    const clear = () => { dialog.close(); clearForAccount().catch(() => {}); };
    window.DaynestMobileReminders = { clearForAccount };
    document.addEventListener('daynest:mobile-ready', () => { appReady = true; openReminder(); });
    document.addEventListener('daynest:account-ready', () => { sync(); openReminder(); });
    document.addEventListener('daynest:account-leaving', clear);
    document.addEventListener('daynest:auth-expired', clear);
    document.addEventListener('daynest:calendar-events-changed', sync);
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) { sync(); openReminder(); } });
    native.addListener('calendarOpened', openReminder);
  };
  document.addEventListener('DOMContentLoaded', mount, { once: true });
}
