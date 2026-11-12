package app.daynest.personal;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
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
import android.view.inputmethod.InputMethodManager;
import java.io.File;
import java.io.FileOutputStream;
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
        evaluate("document.querySelector('#mobile-tabs [data-mobile-view=all]').click();document.querySelector('[data-mobile-target=" + view + "]').click()");
        waitFor("document.body.dataset.mobileView === " + JSONObject.quote(view), "mobile page " + view);
        SystemClock.sleep(250);
    }

    @Test public void nativePagesAndEditorsFitPhone() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String email = args.getString("qaEmail"), label = args.getString("qaLabel");
        assumeTrue("Requires the isolated QA login test first", email != null && email.endsWith("@example.test") && label != null);
        launch();
        waitFor("window.DaynestMobileUX && window.DaynestAccount?.current?.() && document.getElementById('user-name').textContent.includes('MobileQA')", "verified QA session");
        assertEquals("5", evaluate("document.querySelectorAll('#mobile-tabs [data-mobile-view]').length"));
        JSONArray views = new JSONArray(evaluate("Array.from(document.querySelectorAll('.daynest-nav .nav-link[data-view]')).map(node=>node.dataset.view)"));
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

        String[][] dialogs = {{"bookmarks", "bookmark-new"}, {"ledger", "ledger-new"}, {"subscriptions", "sub-new"}, {"care", "care-new"}, {"fitness", "fit-log-open"}};
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
