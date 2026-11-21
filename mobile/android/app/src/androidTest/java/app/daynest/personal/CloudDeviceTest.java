package app.daynest.personal;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.Instrumentation;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONArray;
import android.graphics.Bitmap;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.inputmethod.InputMethodManager;
import android.service.notification.StatusBarNotification;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Opt-in device test: provide only an isolated QA account, never a personal account. */
@RunWith(AndroidJUnit4.class)
public class CloudDeviceTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private WebView webView;

    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup parent = (ViewGroup) view;
            for (int index = 0; index < parent.getChildCount(); index++) {
                WebView found = findWebView(parent.getChildAt(index));
                if (found != null) return found;
            }
        }
        return null;
    }

    private void launch() throws Exception {
        Context context = instrumentation.getTargetContext();
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        assertNotNull(intent);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        long deadline = SystemClock.elapsedRealtime() + 30000;
        while (SystemClock.elapsedRealtime() < deadline) {
            instrumentation.runOnMainSync(() -> {
                for (Activity activity : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)) {
                    webView = findWebView(activity.getWindow().getDecorView());
                    if (webView != null) break;
                }
            });
            if (webView != null) return;
            SystemClock.sleep(200);
        }
        fail("App WebView did not become ready");
    }

    private String evaluate(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> webView.evaluateJavascript(script, result -> {
            value.set(result);
            done.countDown();
        }));
        assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private void waitFor(String condition, String label) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 60000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate("Boolean(" + condition + ")"))) return;
            SystemClock.sleep(200);
        }
        fail("Timed out: " + label + "; status=" + evaluate("['toast-message','calendar-editor-status'].map(id=>document.getElementById(id)?.textContent).join(' | ')"));
    }

    private void report(String step) {
        Bundle status = new Bundle();
        status.putString("stream", "\nDEVICE_QA_PASS " + step + "\n");
        instrumentation.sendStatus(0, status);
    }

    @Test public void isolatedAccountCanUseCloudApp() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String email = args.getString("qaEmail"), password = args.getString("qaPassword"), label = args.getString("qaLabel");
        assumeTrue("Requires an explicitly provided isolated QA account", email != null && password != null && label != null);
        assertTrue(email.endsWith("@example.test"));
        launch();
        waitFor("window.DaynestMobile && document.getElementById('login-form') && !document.getElementById('mobile-connection').open", "automatic cloud connection");
        assertEquals("\"https://111.230.184.144\"", evaluate("DaynestMobile.getConnectionInfo().server"));
        report("trusted_cloud_connection");

        if ("true".equals(evaluate("!document.getElementById('app-view').classList.contains('hidden')"))) {
            evaluate("document.getElementById('logout').click()");
        }
        waitFor("!document.getElementById('auth-view').classList.contains('hidden')", "login form");
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(email) + ";document.getElementById('login-password').value=" + JSONObject.quote(password) + ";document.getElementById('login-form').requestSubmit()");
        waitFor("!document.getElementById('app-view').classList.contains('hidden') && document.getElementById('user-name').textContent.includes('MobileQA')", "real password login");
        assertEquals("true", evaluate("Boolean(localStorage.getItem('studyflow.token'))"));
        report("password_login_and_persisted_session");

        evaluate("document.querySelector('.nav-link[data-view=todo]').click()");
        waitFor("document.getElementById('todo-list').options.length > 0", "todo categories");
        evaluate("document.getElementById('todo-title').value=" + JSONObject.quote(label + " todo") + ";document.getElementById('todo-my-day').checked=true;document.getElementById('todo-form').requestSubmit()");
        waitFor("document.getElementById('todo-title').value === '' && document.getElementById('panel-todo').textContent.includes(" + JSONObject.quote(label + " todo") + ")", "new todo visible");
        report("create_todo_through_app_form");

        evaluate("document.querySelector('.nav-link[data-view=dashboard]').click();document.getElementById('today-note').value=" + JSONObject.quote(label + " memo: written on the physical Android device") + ";document.getElementById('today-note-form').requestSubmit()");
        waitFor("document.getElementById('today-note-status').textContent.includes('已存入备忘录')", "memo saved");
        report("create_memo_through_app_form");

        evaluate("document.querySelector('.nav-link[data-view=calendar]').click()");
        waitFor("window.DaynestCalendarEvents && document.getElementById('page-title').textContent.includes('日历')", "calendar navigation");
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT);
        format.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Shanghai"));
        String date = format.format(new java.util.Date());
        evaluate("DaynestCalendarEvents.open(''," + JSONObject.quote(date) + ")");
        waitFor("document.getElementById('calendar-event-title') && document.getElementById('calendar-event-dialog').open", "calendar editor");
        evaluate("document.getElementById('calendar-event-title').value=" + JSONObject.quote(label + " calendar") + ";document.getElementById('calendar-event-start').value=" + JSONObject.quote(date + "T15:00") + ";document.getElementById('calendar-event-end').value=" + JSONObject.quote(date + "T16:00") + ";document.getElementById('calendar-event-title').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('calendar-event-save').click()");
        waitFor("document.getElementById('calendar-editor-status').textContent.includes('日程已创建')", "calendar saved");
        report("create_calendar_event_through_app_form");
        evaluate("document.getElementById('calendar-dialog-close').click();document.querySelector('.nav-link[data-view=dashboard]').click()");
        report("core_navigation");
    }

    @Test public void restoresSessionAfterRelaunch() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String label = args.getString("qaLabel");
        assumeTrue("Requires the previous isolated device test", label != null && args.getString("qaEmail") != null);
        launch();
        waitFor("window.DaynestMobile && !document.getElementById('app-view').classList.contains('hidden') && document.getElementById('user-name').textContent.includes('MobileQA')", "session restored without entering password");
        report("session_restored_after_process_restart");
        evaluate("document.querySelector('.nav-link[data-view=todo]').click()");
        waitFor("document.getElementById('panel-todo').textContent.includes(" + JSONObject.quote(label + " todo") + ")", "todo reloaded from server");
        report("todo_reloaded_after_restart");
        evaluate("document.querySelector('.nav-link[data-view=memos]').click()");
        waitFor("document.getElementById('memo-note-list').textContent.includes(" + JSONObject.quote(label) + ")", "memo reloaded from server");
        report("memo_reloaded_after_restart");
        evaluate("document.querySelector('.nav-link[data-view=dashboard]').click()");
    }

    @Test public void calendarWorksOnPhysicalPhone() throws Exception {
        launch();
        waitFor("window.DaynestAccount?.current?.() && document.getElementById('user-name').textContent.includes('MobileQA')", "verified QA session");
        openMobilePage("calendar");
        evaluate("document.querySelector('[data-calendar-view=month]').click();document.getElementById('calendar-today').click();document.getElementById('toast-dismiss')?.click();window.scrollTo(0,0)");
        waitFor("document.querySelectorAll('.calendar-month-grid .calendar-day-cell').length===42", "complete month");
        assertEquals("true", evaluate("document.querySelector('.calendar-month-grid').getBoundingClientRect().bottom <= document.getElementById('mobile-tabs').getBoundingClientRect().top"));
        report("calendar_month_fits_first_screen");
        waitFor("document.querySelectorAll('#calendar-history .calendar-history-item').length > 0 && document.getElementById('calendar-history-source').textContent.length > 5", "live historical events and source");
        assertEquals("true", evaluate("document.getElementById('calendar-history-source').textContent.includes('百度百科') || document.getElementById('calendar-history-source').textContent.includes('Wikipedia') || document.getElementById('calendar-history-source').textContent.includes('维基')"));
        screenshot("calendar-month");
        report("calendar_live_history_and_attribution");
        evaluate("document.getElementById('calendar-date-open').click()");
        waitFor("document.getElementById('calendar-tools-dialog').open", "date title opens picker");
        evaluate("document.getElementById('calendar-tools-done').click();document.querySelector('[data-calendar-view=agenda]').click()");
        waitFor("document.querySelector('.calendar-list-event')", "saved events appear in agenda");
        screenshot("calendar-agenda");
        report("calendar_agenda_reads_saved_events");
        evaluate("document.querySelector('[data-calendar-view=day]').click()");
        waitFor("document.querySelector('.calendar-time-column')", "day timeline");
        assertEquals("true", evaluate("document.querySelector('.calendar-time-grid').scrollWidth <= innerWidth"));
        evaluate("document.querySelector('.calendar-time-column').click()");
        waitFor("document.getElementById('calendar-event-dialog').open && !document.getElementById('calendar-event-save').disabled", "time slot opens editor");
        assertEquals("true", evaluate("document.getElementById('calendar-event-start').value.endsWith('T00:00') && document.getElementById('calendar-event-end').value.endsWith('T00:30')"));
        report("calendar_time_slot_initializes_editor");
        evaluate("document.getElementById('calendar-dialog-close').click();document.querySelector('[data-calendar-view=month]').click()");
    }

    private void screenshot(String name) throws Exception {
        instrumentation.waitForIdleSync();
        SystemClock.sleep(350);
        File directory = new File(instrumentation.getTargetContext().getCacheDir(), "mobile-ux");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        AtomicReference<Boolean> focused = new AtomicReference<>(false);
        instrumentation.runOnMainSync(() -> focused.set(webView.hasWindowFocus()));
        assertTrue("Only capture the foreground test app", focused.get());
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot();
        assertNotNull(bitmap);
        try (FileOutputStream output = new FileOutputStream(new File(directory, name + ".png"))) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output));
        } finally { bitmap.recycle(); }
    }

    private void openMobilePage(String view) throws Exception {
        evaluate("document.querySelector('.nav-link[data-view=" + view + "]').click()");
        waitFor("document.body.dataset.mobileView === " + JSONObject.quote(view), "mobile page " + view);
        SystemClock.sleep(250);
    }

    private void tapVisible(String selector) throws Exception {
        String target = JSONObject.quote(selector);
        waitFor("(()=>{const el=document.querySelector(" + target + ");if(!el||el.disabled)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()", "tap target " + selector);
        JSONArray point = new JSONArray(evaluate("(()=>{const r=document.querySelector(" + target + ").getBoundingClientRect();const v=visualViewport;const scale=devicePixelRatio*v.scale;return [(r.x+r.width/2-v.offsetLeft)*scale,(r.y+r.height/2-v.offsetTop)*scale]})()"));
        int[] offset = new int[2];
        instrumentation.runOnMainSync(() -> webView.getLocationOnScreen(offset));
        float x = offset[0] + (float) point.getDouble(0), y = offset[1] + (float) point.getDouble(1);
        long now = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(now, now + 30, MotionEvent.ACTION_UP, x, y, 0);
        try {
            instrumentation.sendPointerSync(down);
            instrumentation.sendPointerSync(up);
        } finally {
            down.recycle();
            up.recycle();
        }
    }

    private Bundle openIsolatedFixture() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String server = args.getString("qaServer"), email = args.getString("qaEmail");
        String password = args.getString("qaPassword"), label = args.getString("qaLabel");
        assumeTrue("Requires a local fixture and a unique run label", server != null && email != null && password != null && label != null);
        assertTrue(server.matches("http://192\\.168\\.\\d{1,3}\\.\\d{1,3}:\\d{4,5}"));
        assertTrue(email.endsWith("@example.test"));
        assertTrue(label.matches("LayoutQA-[a-z0-9]{8,32}"));
        // Run before the first WebView in this process. The normal app process uses its usual profile.
        WebView.setDataDirectorySuffix(label);
        launch();
        waitFor("window.DaynestMobile?.openConnectionSettings && document.getElementById('mobile-connect')?.disabled === false", "connection controls");
        assertEquals("true", evaluate("localStorage.getItem('studyflow.token') === null"));
        evaluate("{DaynestMobile.openConnectionSettings();document.getElementById('mobile-advanced').open=true;const input=document.getElementById('mobile-server');input.value=" + JSONObject.quote(server) + ";input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('mobile-consent').checked=true;const confirm=window.confirm;window.confirm=message=>{window.confirm=confirm;return message.includes('切换服务需要重新登录')};document.getElementById('mobile-form').requestSubmit()}");
        waitFor("DaynestMobile.getConnectionInfo().server === " + JSONObject.quote(server) + " && !document.getElementById('mobile-connection').open && document.getElementById('auth-view').dataset.mobileConnection === 'ready'", "native HTTP to isolated Go fixture");
        waitFor("!document.getElementById('auth-view').classList.contains('hidden') && document.getElementById('login-form') && !document.getElementById('login-form').inert", "fixture login form");
        return args;
    }

    @Test public void mobileAuthWorksOnPhysicalPhone() throws Exception {
        Bundle args = openIsolatedFixture();
        String email = args.getString("qaEmail"), password = args.getString("qaPassword");
        waitFor("document.getElementById('auth-view').dataset.mobileConnection === 'ready'", "redesigned sign-in");
        assertEquals("true", evaluate("document.documentElement.scrollWidth <= screen.width + 1 && document.getElementById('mobile-auth-heading').textContent==='欢迎回来'"));
        screenshot("auth-login");
        tapVisible("#mobile-auth-settings");
        waitFor("document.getElementById('mobile-connection').open", "connection settings");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.getElementById('mobile-connection').open", "back to sign-in");
        report("connection_settings_and_native_back");

        tapVisible("[data-auth-tab=register]");
        waitFor("!document.getElementById('register-form').classList.contains('hidden')", "registration view");
        screenshot("auth-register");
        evaluate("document.querySelector('[data-auth-tab=login]').scrollIntoView({block:'nearest'})");
        tapVisible("[data-auth-tab=login]");
        tapVisible("#login-email");
        waitFor("document.body.classList.contains('mobile-keyboard-open')", "real keyboard in sign-in");
        instrumentation.runOnMainSync(() -> {
            InputMethodManager manager = (InputMethodManager) instrumentation.getTargetContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            manager.hideSoftInputFromWindow(webView.getWindowToken(), 0);
        });
        evaluate("document.activeElement.blur()");
        waitFor("!document.body.classList.contains('mobile-keyboard-open')", "keyboard dismissed");
        report("native_keyboard_and_registration_navigation");

        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(email) + ";document.getElementById('login-password').value='incorrect-fixture-password'");
        tapVisible("[aria-controls=login-password]");
        assertEquals("\"text\"", evaluate("document.getElementById('login-password').type"));
        tapVisible("[aria-controls=login-password]");
        assertEquals("\"password\"", evaluate("document.getElementById('login-password').type"));
        tapVisible("#login-form button[type=submit]");
        waitFor("!document.getElementById('login-form-error').hidden && document.getElementById('login-form-error').textContent.includes('不正确')", "inline rejected login");
        report("password_visibility_and_inline_login_error");
        evaluate("document.getElementById('login-password').value=" + JSONObject.quote(password));
        tapVisible("#login-form button[type=submit]");
        waitFor("window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden", "native password login");
        assertEquals("\"\"", evaluate("document.getElementById('login-password').value"));
        report("real_fixture_login_and_cleared_password");

        evaluate("document.getElementById('logout').click()");
        waitFor("!document.getElementById('auth-view').classList.contains('hidden')", "isolated sign-out");
        tapVisible("[data-auth-tab=register]");
        String newEmail = email.replace("@", "-new@");
        evaluate("document.getElementById('register-name').value='MobileQA register';document.getElementById('register-email').value=" + JSONObject.quote(newEmail) + ";document.getElementById('register-password').value=" + JSONObject.quote(password) + ";document.querySelector('#register-form button[type=submit]').scrollIntoView({block:'nearest'})");
        tapVisible("#register-form button[type=submit]");
        waitFor("window.DaynestAccount?.current?.() && document.getElementById('user-name').textContent === 'MobileQA register'", "native registration");
        report("real_fixture_registration");
    }

    private void fixtureControl(Bundle args, String action) throws Exception {
        URL endpoint = new URL(args.getString("qaServer") + "/__qa/" + args.getString("qaLabel") + "/" + action);
        HttpURLConnection connection = (HttpURLConnection) endpoint.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        try {
            assertEquals("Fixture control: " + action, 204, connection.getResponseCode());
        } finally {
            connection.disconnect();
        }
    }

    private void backgroundAndResume() throws Exception {
        evaluate("window.__devicePaused=false; window.addEventListener('daynest:mobile-pause',()=>window.__devicePaused=true,{once:true})");
        instrumentation.runOnMainSync(() -> {
            for (Activity activity : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)) {
                assertTrue("Move the test App to the background", activity.moveTaskToBack(true));
                break;
            }
        });
        waitFor("window.__devicePaused", "native lifecycle pause");
        webView = null;
        launch();
    }

    @Test public void mobileReliabilityWorksOnPhysicalPhone() throws Exception {
        assumeTrue("Requires the dedicated reliability fixture", "true".equals(InstrumentationRegistry.getArguments().getString("qaReliabilityFixture")));
        Bundle args = openIsolatedFixture();
        tapVisible("[data-auth-tab=register]");
        waitFor("!document.getElementById('register-form').classList.contains('hidden')", "registration page");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.getElementById('login-form').classList.contains('hidden') && document.getElementById('register-form').classList.contains('hidden')", "native back returns to login");
        report("registration_back_returns_to_login");

        String email = args.getString("qaEmail"), password = args.getString("qaPassword");
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(email) + ";document.getElementById('login-password').value=" + JSONObject.quote(password) + ";document.getElementById('login-form').requestSubmit()");
        waitFor("window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden", "fixture login");
        evaluate("window.__deviceOwner=DaynestAccount.current().userID");
        fixtureControl(args, "offline");
        backgroundAndResume();
        waitFor("document.getElementById('mobile-server-bar').dataset.connectionState === 'offline'", "connection warning after transport interruption");
        fixtureControl(args, "online");
        backgroundAndResume();
        waitFor("document.getElementById('mobile-server-bar').dataset.connectionState === 'online'", "connection restored on return");
        assertEquals("true", evaluate("DaynestAccount.current().userID === window.__deviceOwner"));
        report("resume_recovers_connection_and_keeps_session");

        openMobilePage("planner");
        waitFor("document.querySelectorAll('.mobile-planner-days button').length === 7", "weekly date picker");
        evaluate("document.querySelector('.mobile-planner-days button:last-child').click()");
        assertEquals("true", evaluate("document.getElementById('planner-block-date').value === document.querySelector('.mobile-planner-days button:last-child').dataset.mobilePlannerDay"));
        String title = args.getString("qaLabel") + " planner";
        evaluate("document.getElementById('planner-block-title').value=" + JSONObject.quote(title) + ";document.getElementById('planner-block-start').value='13:00';document.getElementById('planner-block-end').value='13:50'");
        fixtureControl(args, "hold-write");
        try {
            evaluate("document.getElementById('planner-block-form').requestSubmit()");
            waitFor("document.querySelector('#planner-block-form button[type=submit]').disabled", "planner save pending");
            evaluate("document.getElementById('planner-block-form').requestSubmit();document.getElementById('planner-block-title').value='Next entry draft';document.getElementById('planner-block-title').dispatchEvent(new Event('input',{bubbles:true}))");
        } finally {
            fixtureControl(args, "release-write");
        }
        waitFor("document.querySelector('.planner-day-column[data-mobile-day-active]').textContent.includes(" + JSONObject.quote(title) + ")", "weekly planner readback");
        assertEquals("\"Next entry draft\"", evaluate("document.getElementById('planner-block-title').value"));
        report("planner_selected_day_and_pending_edit_preserved");
    }

    private void reminderEvent(String email, String password) throws Exception {
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(email) + ";document.getElementById('login-password').value=" + JSONObject.quote(password) + ";document.getElementById('login-form').requestSubmit()");
        waitFor("window.DaynestAccount?.current?.() && !!document.getElementById('mobile-calendar-reminders')", "fixture login and reminder settings");
        openMobilePage("calendar");
        evaluate("document.getElementById('calendar-filter-open').click();document.querySelector('#calendar-filter-fields [aria-controls=mobile-calendar-reminders]').click()");
        waitFor("document.getElementById('mobile-calendar-reminders').open", "open reminder preferences");
    }

    private void createReminderEvent(int secondsUntilReminder) throws Exception {
        evaluate("window.__qaEvent=null;(async()=>{const start=Date.now()+600000+" + (secondsUntilReminder * 1000) + ";window.__qaEvent=await DaynestHTTP.json('/api/v1/calendar/events',{method:'POST',body:{title:'Fixture calendar reminder',start_at:new Date(start).toISOString(),end_at:new Date(start+3600000).toISOString(),reminder_minutes:10}});document.dispatchEvent(new CustomEvent('daynest:calendar-events-changed'))})()");
        waitFor("window.__qaEvent?.id", "create fixture reminder");
        waitFor("document.getElementById('mobile-reminder-status').textContent.includes('已安排 1 条')", "system reminder scheduled from the Go event");
    }

    @Test public void calendarRemindersWorkOnPhysicalPhone() throws Exception {
        assumeTrue("Requires the dedicated reminder fixture", "true".equals(InstrumentationRegistry.getArguments().getString("qaReminderFixture")));
        Bundle args = openIsolatedFixture();
        Context context = instrumentation.getTargetContext();
        CalendarReminderReceiver.setEnabled(context, false);
        reminderEvent(args.getString("qaEmail"), args.getString("qaPassword"));
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            waitFor("!document.getElementById('mobile-reminder-settings').hidden", "ungranted permission exposes Android settings");
            report("no_notification_permission_has_settings_entry");
            instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), "android.permission.POST_NOTIFICATIONS");
        }
        evaluate("document.getElementById('mobile-reminder-toggle').click()");
        try {
            waitFor("document.getElementById('mobile-reminder-status').textContent.includes('已安排 0 条')", "enable system reminders");
            waitFor("document.getElementById('mobile-reminder-status').textContent.includes('已开启准时提醒')", "precise scheduling available on the test device");
            createReminderEvent(600);
            evaluate("(async()=>{await DaynestHTTP.json('/api/v1/calendar/events/'+encodeURIComponent(window.__qaEvent.id),{method:'DELETE'});document.dispatchEvent(new CustomEvent('daynest:calendar-events-changed'))})()");
            waitFor("document.getElementById('mobile-reminder-status').textContent.includes('已安排 0 条')", "deleting the event removes its alarm");
            report("calendar_create_and_delete_reschedule_alarm");
            createReminderEvent(12);
            PowerManager power = context.getSystemService(PowerManager.class);
            NotificationManager notifications = context.getSystemService(NotificationManager.class);
            instrumentation.getUiAutomation().executeShellCommand("input keyevent KEYCODE_SLEEP").close();
            try {
                long deadline = SystemClock.elapsedRealtime() + 90000;
                boolean delivered = false, screenOff = false;
                while (SystemClock.elapsedRealtime() < deadline && !delivered) {
                    screenOff |= !power.isInteractive();
                    for (StatusBarNotification notification : notifications.getActiveNotifications()) {
                        if ("calendar-reminders".equals(notification.getNotification().getChannelId()) && screenOff) {
                            delivered = true;
                            break;
                        }
                    }
                    if (!delivered) SystemClock.sleep(400);
                }
                assertTrue("Android posted a calendar notification while the screen was off", delivered);
                report("system_notification_arrived_while_screen_off");
            } finally {
                instrumentation.getUiAutomation().executeShellCommand("input keyevent KEYCODE_WAKEUP").close();
            }
        } finally {
            try {
                evaluate("if(document.getElementById('mobile-reminder-toggle').textContent==='关闭提醒')document.getElementById('mobile-reminder-toggle').click()");
                waitFor("document.getElementById('mobile-reminder-status').textContent.includes('已关闭')", "test reminders disabled");
            } finally {
                CalendarReminderReceiver.setEnabled(context, false);
            }
        }
        report("test_reminders_disabled");
    }

    private JSONObject rebootFixtureEntry(String id, long at, long start) throws Exception {
        return new JSONObject().put("id", id).put("date", "2026-11-21").put("at", at).put("start", start);
    }

    private StatusBarNotification waitForCalendarNotification(NotificationManager manager, long after) {
        return waitForCalendarNotification(manager, after, 40000);
    }

    private StatusBarNotification waitForCalendarNotification(NotificationManager manager, long after, long timeoutMs) {
        return waitForCalendarNotification(manager, after, timeoutMs, "");
    }

    private StatusBarNotification waitForCalendarNotification(NotificationManager manager, long after, long timeoutMs, String expectedText) {
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < deadline) {
            for (StatusBarNotification notification : manager.getActiveNotifications()) {
                Notification posted = notification.getNotification();
                if ("calendar-reminders".equals(posted.getChannelId()) && notification.getPostTime() > after
                        && posted.extras.getString(Notification.EXTRA_TEXT, "").startsWith(expectedText)) return notification;
            }
            SystemClock.sleep(150);
        }
        throw new AssertionError("Calendar notification did not arrive");
    }

    @Test public void calendarRemindersRecoverAfterSimulatedBoot() throws Exception {
        assumeTrue("Requires an explicit isolated simulated boot run", "true".equals(InstrumentationRegistry.getArguments().getString("qaSimulateReminderBoot")));
        Context context = instrumentation.getTargetContext();
        assumeTrue("Existing opted-in device reminders must be left alone",
            !CalendarReminderReceiver.enabled(context) && CalendarReminderReceiver.count(context) == 0);
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        CalendarReminderReceiver receiver = new CalendarReminderReceiver();
        Intent boot = new Intent(Intent.ACTION_BOOT_COMPLETED);
        long now = System.currentTimeMillis();
        JSONObject future = rebootFixtureEntry("boot-fixture-future", now + 18000, now + 180000);
        JSONObject due = rebootFixtureEntry("boot-fixture-due", now - 10000, now + 120000);
        JSONObject expired = rebootFixtureEntry("boot-fixture-past", now - 120000, now - 1000);
        var store = context.getSharedPreferences("calendar-reminders", Context.MODE_PRIVATE);

        try {
            if (!CalendarReminderReceiver.allowed(context)) {
                CalendarReminderReceiver.setEnabled(context, true);
                assertTrue(store.edit().putString("pending", new JSONArray().put(due).toString()).commit());
                receiver.onReceive(context, boot);
                assertEquals(0, CalendarReminderReceiver.count(context));
                for (StatusBarNotification notification : notifications.getActiveNotifications()) {
                    assertFalse("Permission denial must prevent a reminder", "calendar-reminders".equals(notification.getNotification().getChannelId()));
                }
                report("boot_without_notification_permission_clears_unsendable_queue");
                instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), "android.permission.POST_NOTIFICATIONS");
            }
            assertTrue(CalendarReminderReceiver.allowed(context));
            assertTrue(CalendarReminderReceiver.exact(context));
            CalendarReminderReceiver.setEnabled(context, true);
            CalendarReminderReceiver.replace(context, new JSONArray().put(future));
            Intent fire = new Intent(context, CalendarReminderReceiver.class).setAction("app.daynest.personal.FIRE_CALENDAR_REMINDER");
            PendingIntent registeredAlarm = PendingIntent.getBroadcast(context, 422, fire, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE);
            assertNotNull("A system alarm exists before the simulated restart", registeredAlarm);
            context.getSystemService(AlarmManager.class).cancel(registeredAlarm);
            assertTrue(store.edit().putString("pending", new JSONArray().put(expired).put(due).put(future).toString()).commit());

            receiver.onReceive(context, boot);
            assertEquals("Only the future reminder remains scheduled", 1, CalendarReminderReceiver.count(context));
            StatusBarNotification unexpired = waitForCalendarNotification(notifications, now - 1);
            assertTrue(unexpired.getNotification().extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString().startsWith("有一项"));
            report("simulated_boot_drops_past_and_delivers_unexpired_reminder");

            SystemClock.sleep(250);
            receiver.onReceive(context, boot);
            for (StatusBarNotification notification : notifications.getActiveNotifications()) {
                if ("calendar-reminders".equals(notification.getNotification().getChannelId())) assertEquals(unexpired.getPostTime(), notification.getPostTime());
            }
            report("repeated_boot_callback_does_not_repeat_alert");

            waitForCalendarNotification(notifications, unexpired.getPostTime());
            assertEquals("AlarmManager dispatched the future reminder and emptied the queue", 0, CalendarReminderReceiver.count(context));
            report("android_delivers_rearmed_future_alarm");
        } finally {
            CalendarReminderReceiver.setEnabled(context, false);
        }
        assertEquals(0, CalendarReminderReceiver.count(context));
        report("fixture_reminders_cleared");
    }

    private Notification postCalendarFixture(Context context, JSONObject... rows) throws Exception {
        long before = System.currentTimeMillis() - 1;
        JSONArray queue = new JSONArray();
        for (JSONObject row : rows) queue.put(row);
        var store = context.getSharedPreferences("calendar-reminders", Context.MODE_PRIVATE);
        assertTrue(store.edit().putString("pending", queue.toString()).commit());
        new CalendarReminderReceiver().onReceive(context, new Intent(Intent.ACTION_BOOT_COMPLETED));
        return waitForCalendarNotification(context.getSystemService(NotificationManager.class), before).getNotification();
    }

    private void tapCalendarSnooze(Notification notification, Context context, int expectedCount) throws Exception {
        assertNotNull(notification.actions);
        assertEquals(1, notification.actions.length);
        assertEquals("稍后 5 分钟", notification.actions[0].title.toString());
        notification.actions[0].actionIntent.send();
        long deadline = SystemClock.elapsedRealtime() + 5000;
        while (SystemClock.elapsedRealtime() < deadline && CalendarReminderReceiver.count(context) != expectedCount) {
            SystemClock.sleep(50);
        }
        assertEquals(expectedCount, CalendarReminderReceiver.count(context));
    }

    @Test public void calendarReminderSnoozesOnPhysicalPhone() throws Exception {
        assumeTrue("Requires explicit isolated calendar snooze run", "true".equals(InstrumentationRegistry.getArguments().getString("qaReminderSnooze")));
        Context context = instrumentation.getTargetContext();
        assumeTrue("Existing opted-in device reminders must be left alone",
            !CalendarReminderReceiver.enabled(context) && CalendarReminderReceiver.count(context) == 0);
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        var store = context.getSharedPreferences("calendar-reminders", Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        JSONObject original = rebootFixtureEntry("snooze-fixture-long", now - 10000, now + 12 * 60000);
        JSONObject shortEvent = rebootFixtureEntry("snooze-fixture-short", now - 10000, now + 120000);
        JSONArray originalSnapshot = new JSONArray().put(original).put(shortEvent);
        try {
            if (!CalendarReminderReceiver.allowed(context)) {
                instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), "android.permission.POST_NOTIFICATIONS");
            }
            assertTrue(CalendarReminderReceiver.allowed(context));
            assertTrue(CalendarReminderReceiver.exact(context));
            CalendarReminderReceiver.setEnabled(context, true);

            Notification shortNotice = postCalendarFixture(context, shortEvent);
            assertTrue("No action when a snooze would run past the start", shortNotice.actions == null || shortNotice.actions.length == 0);
            CalendarReminderReceiver.clear(context);
            Notification grouped = postCalendarFixture(context, original, shortEvent);
            assertTrue(grouped.extras.getCharSequence(Notification.EXTRA_TEXT).toString().startsWith("有 2 项"));
            tapCalendarSnooze(grouped, context, 1);
            try {
                grouped.actions[0].actionIntent.send();
                throw new AssertionError("The same Notification action should not be accepted twice");
            } catch (PendingIntent.CanceledException expected) { }
            assertEquals(1, CalendarReminderReceiver.count(context));
            report("snooze_action_skips_imminent_event_and_consumes_once");

            JSONObject moved = rebootFixtureEntry(original.getString("id"), now + 15 * 60000, now + 25 * 60000);
            CalendarReminderReceiver.reconcile(context, new JSONArray().put(moved));
            JSONArray adjusted = new JSONArray(store.getString("pending", "[]"));
            assertEquals(moved.getLong("at"), adjusted.getJSONObject(0).getLong("at"));
            assertFalse(adjusted.getJSONObject(0).has("snoozeAt"));
            CalendarReminderReceiver.clear(context);

            tapCalendarSnooze(postCalendarFixture(context, original), context, 1);
            CalendarReminderReceiver.reconcile(context, new JSONArray());
            assertEquals(0, CalendarReminderReceiver.count(context));
            Notification staleNotice = postCalendarFixture(context, original);
            CalendarReminderReceiver.clear(context);
            CountDownLatch staleHandled = new CountDownLatch(1);
            staleNotice.actions[0].actionIntent.send(0, (intent, ignored, code, data, extras) -> staleHandled.countDown(), null);
            assertTrue(staleHandled.await(5, TimeUnit.SECONDS));
            assertEquals(0, CalendarReminderReceiver.count(context));
            report("reschedule_delete_and_session_clear_invalidate_old_snoozes");

            postCalendarFixture(context, original, shortEvent);
            CalendarReminderReceiver.reconcile(context, new JSONArray().put(original));
            Notification latest = waitForCalendarNotification(notifications, now - 1, 5000, "有一项").getNotification();
            long beforeTap = System.currentTimeMillis();
            tapCalendarSnooze(latest, context, 1);
            JSONArray delayed = new JSONArray(store.getString("pending", "[]"));
            long trigger = delayed.getJSONObject(0).getLong("snoozeAt");
            assertEquals(original.getString("id"), delayed.getJSONObject(0).getString("id"));
            assertTrue(trigger >= beforeTap + 300000 && trigger <= System.currentTimeMillis() + 300000);
            CalendarReminderReceiver.reconcile(context, originalSnapshot);
            new CalendarReminderReceiver().onReceive(context, new Intent(Intent.ACTION_BOOT_COMPLETED));
            assertEquals(trigger, new JSONArray(store.getString("pending", "[]")).getJSONObject(0).getLong("snoozeAt"));
            report("snooze_keeps_actual_five_minute_delay_after_sync_and_boot_callback");

            StatusBarNotification redelivered = waitForCalendarNotification(notifications, beforeTap, 360000);
            assertTrue("The system must not deliver before the chosen delay", redelivered.getPostTime() >= trigger - 500);
            assertEquals(0, CalendarReminderReceiver.count(context));
            CalendarReminderReceiver.reconcile(context, originalSnapshot);
            assertEquals(0, CalendarReminderReceiver.count(context));
            report("android_delivers_snoozed_alarm_without_replaying_original");
        } finally {
            CalendarReminderReceiver.setEnabled(context, false);
        }
        assertEquals(0, CalendarReminderReceiver.count(context));
        report("snooze_fixture_reminders_cleared");
    }

    @Test public void layoutPreviewUsesIsolatedWebViewProfile() throws Exception {
        Bundle args = openIsolatedFixture();
        String email = args.getString("qaEmail"), password = args.getString("qaPassword"), label = args.getString("qaLabel");
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(email) + ";document.getElementById('login-password').value=" + JSONObject.quote(password) + ";document.getElementById('login-form').requestSubmit()");
        waitFor("window.DaynestAccount?.current?.() && document.body.classList.contains('mobile-product') && !document.getElementById('mobile-tabs').hidden", "layout preview and fixture login");
        report("isolated_profile_and_native_login");

        JSONArray views = new JSONArray(evaluate("Array.from(new Set([...document.querySelectorAll('.nav-link[data-view]')].map(node=>node.dataset.view)))"));
        for (int index = 0; index < views.length(); index++) {
            String view = views.getString(index);
            openMobilePage(view);
            assertEquals("Page overflow: " + view, "true", evaluate("document.documentElement.scrollWidth <= screen.width + 1"));
            report("layout_" + view);
        }

        openMobilePage("dashboard");
        assertEquals("true", evaluate("document.querySelector('.today-grid > article').classList.contains('today-agenda') && document.querySelector('.today-agenda').getBoundingClientRect().top < document.getElementById('mobile-tabs').getBoundingClientRect().top"));
        screenshot("preview-today");
        tapVisible("#mobile-page-action");
        tapVisible("[data-capture=todo]");
        waitFor("document.getElementById('mobile-todo-create').open && document.getElementById('todo-list').options.length", "quick capture opens To-do composer");
        evaluate("document.getElementById('todo-title').value=" + JSONObject.quote(label + " todo") + ";document.getElementById('todo-title').dispatchEvent(new Event('input',{bubbles:true}))");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.getElementById('mobile-todo-create').open", "Android back closes composer");
        tapVisible("#mobile-page-action");
        assertEquals(JSONObject.quote(label + " todo"), evaluate("document.getElementById('todo-title').value"));
        evaluate("document.getElementById('todo-my-day').checked=true;document.getElementById('todo-form').requestSubmit()");
        waitFor("!document.getElementById('mobile-todo-create').open && document.getElementById('todo-items').textContent.includes(" + JSONObject.quote(label + " todo") + ")", "created To-do visible");
        tapVisible("#mobile-todo-filter");
        waitFor("document.getElementById('mobile-todo-options').open && document.getElementById('todo-drafts-open').getClientRects().length", "filters and local drafts reachable");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.getElementById('mobile-todo-options').open", "filters dismissed");
        evaluate("document.getElementById('toast-dismiss')?.click()");
        screenshot("preview-todo");
        report("quick_capture_retains_input_and_saves_todo");

        tapVisible("#mobile-tabs [data-mobile-view=all]");
        waitFor("document.getElementById('mobile-functions').open", "full-screen functions");
        assertEquals("true", evaluate("document.getElementById('mobile-functions').getBoundingClientRect().width >= innerWidth-1"));
        evaluate("const input=document.getElementById('mobile-functions-query'); input.value='运动';input.dispatchEvent(new Event('input',{bubbles:true}))");
        assertEquals("1", evaluate("document.querySelectorAll('[data-mobile-target]').length"));
        screenshot("preview-functions");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.getElementById('mobile-functions').open", "functions dismissed by Android back");
        report("full_screen_function_search_and_native_back");

        tapVisible("#mobile-tabs [data-mobile-view=all]");
        tapVisible("[data-mobile-category=记录]");
        tapVisible("[data-mobile-target=memos]");
        waitFor("document.body.dataset.mobileView==='memos'", "memo page");
        tapVisible("#mobile-page-action");
        waitFor("document.body.classList.contains('mobile-memo-editor') && document.getElementById('memo-title').value==='新备忘录'", "new memo ready");
        evaluate("{const title=document.getElementById('memo-title');title.value=" + JSONObject.quote(label + " memo") + ";title.dispatchEvent(new Event('input',{bubbles:true}));const body=document.getElementById('memo-content');body.value='Native preview fixture';body.dispatchEvent(new Event('input',{bubbles:true}));body.focus()}");
        instrumentation.runOnMainSync(() -> {
            webView.requestFocus();
            InputMethodManager manager = (InputMethodManager) instrumentation.getTargetContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            manager.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
        });
        waitFor("document.body.classList.contains('mobile-keyboard-open')", "memo uses real keyboard");
        assertEquals("true", evaluate("!document.getElementById('mobile-tabs').getClientRects().length && document.getElementById('memo-save').getBoundingClientRect().bottom <= visualViewport.height"));
        screenshot("preview-memo-keyboard");
        tapVisible("#memo-save");
        evaluate("window.__previewMemo=false;(async()=>{for(let i=0;i<50;i++){const r=await DaynestHTTP.json('/api/v1/memos');if(JSON.stringify(r).includes(" + JSONObject.quote(label + " memo") + ")){window.__previewMemo=true;return}await new Promise(resolve=>setTimeout(resolve,200));}})()");
        waitFor("window.__previewMemo", "memo visible in native API after save");
        instrumentation.runOnMainSync(() -> {
            InputMethodManager manager = (InputMethodManager) instrumentation.getTargetContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            manager.hideSoftInputFromWindow(webView.getWindowToken(), 0);
        });
        evaluate("document.activeElement.blur()");
        waitFor("!document.body.classList.contains('mobile-keyboard-open')", "keyboard dismissed");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.body.classList.contains('mobile-memo-editor')", "memo back to list");
        report("real_keyboard_memo_save_and_native_back");

        tapVisible("#mobile-tabs [data-mobile-view=calendar]");
        waitFor("document.body.dataset.mobileView==='calendar' && document.querySelectorAll('.calendar-month-grid .calendar-day-cell').length===42", "complete calendar month");
        assertEquals("true", evaluate("document.querySelector('.calendar-month-grid').getBoundingClientRect().bottom <= document.getElementById('mobile-tabs').getBoundingClientRect().top"));
        screenshot("preview-calendar");
        tapVisible("#mobile-page-action");
        waitFor("document.getElementById('calendar-event-dialog').open && !document.getElementById('calendar-event-save').disabled", "calendar plus opens editor");
        evaluate("{const title=document.getElementById('calendar-event-title');title.value=" + JSONObject.quote(label + " calendar") + ";title.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('calendar-event-save').click()}");
        waitFor("document.getElementById('calendar-editor-status').textContent.includes('日程已创建')", "calendar saved");
        report("calendar_full_month_and_quick_create_save");
    }

    @Test public void nativePagesAndEditorsFitPhone() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String email = args.getString("qaEmail"), label = args.getString("qaLabel");
        assumeTrue("Requires the isolated QA login test first", email != null && email.endsWith("@example.test") && label != null);
        launch();
        waitFor("window.DaynestMobileUX && window.DaynestAccount?.current?.() && document.getElementById('user-name').textContent.includes('MobileQA')", "verified QA session");
        assertEquals("5", evaluate("document.querySelectorAll('#mobile-tabs [data-mobile-view]').length"));
        JSONArray views = new JSONArray(evaluate("Array.from(new Set(Array.from(document.querySelectorAll('.nav-link[data-view]')).map(node=>node.dataset.view)))"));
        for (int index = 0; index < views.length(); index++) {
            String view = views.getString(index);
            openMobilePage(view);
            assertEquals("Page overflow: " + view, "true", evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
            screenshot("page-" + view);
            report("layout_" + view);
        }
        evaluate("document.querySelector('#mobile-tabs [data-mobile-view=all]').click();document.getElementById('mobile-functions-query').value='运动';document.getElementById('mobile-functions-query').dispatchEvent(new Event('input',{bubbles:true}))");
        assertEquals("1", evaluate("document.querySelectorAll('[data-mobile-target]').length"));
        screenshot("function-search");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.getElementById('mobile-functions').open", "Android back closes functions");
        report("function_search_and_native_back");

        String[][] dialogs = {{"ledger", "ledger-new"}, {"subscriptions", "sub-new"}, {"care", "care-new"}, {"fitness", "fit-log-open"}};
        for (String[] entry : dialogs) {
            openMobilePage(entry[0]);
            evaluate("document.getElementById(" + JSONObject.quote(entry[1]) + ").click()");
            waitFor("document.querySelector('dialog[open]')", "dialog " + entry[0]);
            assertEquals("Dialog bounds: " + entry[0], "true", evaluate("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=(window.visualViewport?.height||innerHeight)+1})()"));
            screenshot("dialog-" + entry[0]);
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            waitFor("!document.querySelector('dialog[open]')", "back closes " + entry[0]);
            report("dialog_" + entry[0]);
        }

        openMobilePage("memos");
        evaluate("document.getElementById('memo-new').click()");
        waitFor("!document.getElementById('memo-new').disabled && document.getElementById('memo-title').value === '新备忘录' && document.body.classList.contains('mobile-memo-editor') && !document.getElementById('memo-editor').classList.contains('hidden') && Math.abs(document.querySelector('.memo-editor-pane').getBoundingClientRect().left)<1", "new memo ready in full screen editor");
        String title = label + " mobile editor " + SystemClock.elapsedRealtime();
        evaluate("document.getElementById('memo-title').value=" + JSONObject.quote(title) + ";document.getElementById('memo-title').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('memo-content').value='Native mobile editor save and keyboard verification';document.getElementById('memo-content').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('memo-save').click()");
        evaluate("window.__qaMemoVerified=false;(async()=>{for(let i=0;i<80;i++){const response=await fetch('/api/v1/memos',{headers:{Authorization:'Bearer '+localStorage.getItem('studyflow.token')}});if(response.ok){const body=JSON.stringify(await response.json());if(body.includes(" + JSONObject.quote(title) + ")&&body.includes('Native mobile editor save and keyboard verification')){window.__qaMemoVerified=true;return;}}await new Promise(resolve=>setTimeout(resolve,250));}})()");
        waitFor("window.__qaMemoVerified", "saved memo read back from server");
        assertEquals("true", evaluate("(()=>{const r=document.getElementById('memo-save').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"));
        screenshot("memo-editor");
        report("memo_editor_save_control_and_real_save");

        evaluate("document.getElementById('memo-content').focus()");
        instrumentation.runOnMainSync(() -> {
            webView.requestFocus();
            InputMethodManager manager = (InputMethodManager) instrumentation.getTargetContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            manager.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
        });
        waitFor("document.body.classList.contains('mobile-keyboard-open')", "real keyboard resize");
        assertEquals("true", evaluate("(()=>{const r=document.getElementById('memo-save').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=(window.visualViewport?.height||innerHeight)})()"));
        screenshot("memo-keyboard");
        report("real_keyboard_preserves_save_action");
        instrumentation.runOnMainSync(() -> {
            InputMethodManager manager = (InputMethodManager) instrumentation.getTargetContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            manager.hideSoftInputFromWindow(webView.getWindowToken(), 0);
        });
        evaluate("document.activeElement.blur()");
        waitFor("!document.body.classList.contains('mobile-keyboard-open')", "keyboard closed");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.body.classList.contains('mobile-memo-editor')", "back returns to memo list");
        report("native_back_preserves_memo");
        openMobilePage("dashboard");
    }
}
