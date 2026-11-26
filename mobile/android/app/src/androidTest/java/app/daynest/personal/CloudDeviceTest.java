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
import java.util.Calendar;
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
            try {
                if ("true".equals(evaluate("Boolean(" + condition + ")"))) return;
            } catch (AssertionError error) {
                // Android can discard an evaluation callback while replacing the document.
                if (!"WebView evaluation timed out".equals(error.getMessage())) throw error;
            }
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
        assertEquals("true", evaluate("document.getElementById('mobile-auth-settings').hidden && document.getElementById('mobile-auth-offline').hidden"));
        report("healthy_login_hides_connection_and_offline_actions");

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

    private void clickOfflineControl(String selector) throws Exception {
        String element = "document.querySelector(" + JSONObject.quote(selector) + ")";
        waitFor("(()=>{const target=" + element + ";return target?.getClientRects().length && !target.disabled})()",
            "visible offline control " + selector);
        evaluate(element + ".click()");
    }

    @Test public void mallVisitsWorkOnPhysicalPhone() throws Exception {
        assumeTrue("Requires a dedicated mall visits fixture", "true".equals(InstrumentationRegistry.getArguments().getString("qaMallFixture")));
        Bundle args = openIsolatedFixture();
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(args.getString("qaEmail")) +
            ";document.getElementById('login-password').value=" + JSONObject.quote(args.getString("qaPassword")) +
            ";document.getElementById('login-form').requestSubmit()");
        waitFor("window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden", "mall fixture login");
        openMobilePage("timeline");
        clickOfflineControl("#mall-open");
        String modal = "document.getElementById('mall-dialog')";
        String totals = modal + ".querySelector('[data-visit-total]').textContent";
        String cards = modal + ".querySelectorAll('.mall-list-item')";
        String add = "{const form=" + modal + ".querySelector('form');form.elements.mallName.value='测试万象城';form.elements.city.value='杭州';form.requestSubmit()}";
        waitFor(modal + ".open && " + totals + " === '0'", "new mall book");
        assertEquals("true", evaluate(modal + ".getBoundingClientRect().width <= innerWidth"));
        evaluate(add);
        waitFor(totals + " === '1'", "first mall visit");
        evaluate(add);
        waitFor(modal + ".querySelector('[data-mall-status]').textContent.includes('当天已经记过')", "same-day visit deduplicated");
        assertEquals("\"1\"", evaluate(totals));
        report("mall_first_visit_saved_and_duplicate_suppressed");

        String previous = evaluate("(()=>{const d=new Date();d.setDate(d.getDate()-1);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})()");
        evaluate("{const form=" + modal + ".querySelector('form');form.elements.mallName.value='测试万象城';form.elements.city.value='杭州';" +
            "form.elements.day.value=" + previous + ";form.elements.day.dispatchEvent(new Event('change',{bubbles:true}));form.requestSubmit()}");
        waitFor(totals + " === '2' && " + cards + ".length === 1", "historical visit grouped");
        evaluate("{const form=" + modal + ".querySelector('form');form.elements.mallName.value='测试万象城';form.elements.city.value='上海';form.requestSubmit()}");
        waitFor(totals + " === '3' && " + cards + ".length === 2", "same names in distinct cities");
        evaluate("{const input=" + modal + ".querySelector('[data-mall-search]');input.value='上海';input.dispatchEvent(new Event('input',{bubbles:true}))}");
        waitFor(cards + ".length === 1 && " + cards + "[0].textContent.includes('上海')", "filter by city");
        report("mall_counts_group_dates_and_keep_cities_distinct");

        clickOfflineControl("#mall-dialog [data-mall-close]");
        waitFor("!" + modal + ".open", "close mall dialog");
        evaluate("window.__mallFixture=true; setTimeout(()=>location.reload(),0); true");
        waitFor("typeof window.__mallFixture === 'undefined' && window.DaynestAccount?.current?.()", "app restores after reload");
        openMobilePage("timeline");
        clickOfflineControl("#mall-open");
        waitFor(totals + " === '3'", "mall history persisted");
        evaluate("{const sort=" + modal + ".querySelector('[data-mall-sort]');sort.value='visits';sort.dispatchEvent(new Event('change',{bubbles:true}))}");
        assertEquals("true", evaluate(cards + "[0].textContent.includes('杭州')"));
        evaluate(cards + "[0].querySelector('summary').click()");
        evaluate("{const confirm=window.confirm;window.confirm=()=>{window.confirm=confirm;return true};" +
            "const date=[..." + cards + "[0].querySelectorAll('li')].find(row=>row.querySelector('time').dateTime===" + previous +
            ");date.querySelector('[data-remove-visit]').click()}");
        waitFor(totals + " === '2' && " + cards + ".length === 2", "remove only the selected visit");
        report("mall_history_persists_sorts_and_removes_one_visit");

        evaluate("""
            {
              const fetchOnline = window.fetch;
              window.fetch = (input, options) => {
                const endpoint = new URL(input, location.href);
                if (endpoint.hostname === 'commons.wikimedia.org') {
                  const imageinfo = [{mime:'image/png',thumburl:'https://upload.wikimedia.org/qa-mall.png',
                    descriptionurl:'https://commons.wikimedia.org/wiki/File:QA_mall.png',
                    extmetadata:{Artist:{value:'测试摄影师'},LicenseShortName:{value:'CC BY-SA 4.0'},
                      LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}];
                  return Promise.resolve(new Response(JSON.stringify({query:{pages:[{title:'File:杭州万象城.png',imageinfo}]}})));
                }
                if (endpoint.hostname === 'upload.wikimedia.org') {
                  return fetchOnline('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN48+kVAAWWAslgVeOLAAAAAElFTkSuQmCC');
                }
                if (endpoint.hostname !== 'photon.komoot.io') return fetchOnline(input, options);
                const features = ['杭州', '宁波'].filter(city => !endpoint.searchParams.get('q').includes('杭州') || city === '杭州')
                  .map((city, index) => ({geometry:{type:'Point', coordinates:[120.2 + index, 30.25]},
                    properties:{name:'万象城',city:city+'市',state:'浙江省',street:'富春路',osm_type:'W',osm_id:200+index,osm_key:'shop',osm_value:'mall'}}));
                return Promise.resolve(new Response(JSON.stringify({features}), {headers:{'Content-Type':'application/json'}}));
              };
            }
            """);
        evaluate("{const form=" + modal + ".querySelector('form');form.elements.mallName.value='万象城';form.elements.city.value='';}");
        clickOfflineControl("#mall-dialog [data-mall-find]");
        waitFor(modal + ".querySelectorAll('[data-mall-results] button').length === 2 && !" +
            modal + ".querySelector('[data-mall-location-value]').textContent", "ambiguous name should not auto-bind");
        evaluate("{const city=" + modal + ".querySelector('form').elements.city;city.value='杭州';city.dispatchEvent(new Event('input',{bubbles:true}));}");
        clickOfflineControl("#mall-dialog [data-mall-find]");
        waitFor(modal + ".querySelector('[data-mall-location-value]').textContent.includes('富春路')", "unique location auto-bound");
        waitFor(modal + ".querySelector('[data-mall-photo-gallery]').textContent.includes('CC BY-SA 4.0')",
            "matching a location prepares a licensed photo");
        String amapLink = modal + ".querySelector('[data-mall-open-amap]')";
        assertEquals("true", evaluate("new URL(" + amapLink + ".href).searchParams.get('coordinate')==='wgs84'"));
        if (instrumentation.getTargetContext().getString(R.string.daynest_amap_android_key).isEmpty()) {
            clickOfflineControl("#mall-dialog [data-mall-map-toggle]");
            waitFor(modal + ".querySelector('[data-mall-location-status]').textContent.includes('尚未配置高德地图') && !" +
                amapLink + ".hidden", "build without a key offers the AMap link");
        }
        evaluate("{const form=" + modal + ".querySelector('form');form.elements.rating.value='5';form.elements.notes.value='停车比较方便';form.requestSubmit()}");
        waitFor(totals + " === '3' && " + modal + ".querySelector('[data-mall-list]').textContent.includes('停车比较方便')", "location and review persisted");
        report("mall_location_search_selects_unique_place_and_stores_review");

        evaluate("{const card=[..." + cards + "].find(row=>row.querySelector('summary strong').textContent==='万象城');card.open=true;card.querySelector('[data-edit-visit]').click()}");
        evaluate("""
            {
              const nativePromise = window.Capacitor.nativePromise;
              window.Capacitor.nativePromise = (plugin, method, options) => {
                if (plugin !== 'DaynestMaps' || method !== 'pick') return nativePromise(plugin, method, options);
                window.qaMallPicker = options;
                return Promise.resolve(window.qaMallPickerResult || {cancelled:true});
              };
            }
            """);
        clickOfflineControl("#mall-dialog [data-mall-map-toggle]");
        waitFor("window.qaMallPicker?.selected?.coordinateSystem==='wgs84' && " +
            modal + ".querySelector('[data-mall-save]:enabled') && new URL(" + amapLink + ".href).searchParams.get('coordinate')==='wgs84'",
            "picker receives saved WGS84 location and cancellation leaves it unchanged");
        evaluate("window.qaMallPickerResult={lat:30.253,lng:120.206}");
        clickOfflineControl("#mall-dialog [data-mall-map-toggle]");
        waitFor("new URL(" + amapLink + ".href).searchParams.get('coordinate')==='gaode'", "manual selection uses GCJ-02");
        evaluate("{const form=" + modal + ".querySelector('form');form.elements.rating.value='4';form.elements.notes.value='已核对入口位置';form.requestSubmit()}");
        waitFor(totals + " === '3' && " + modal + ".querySelector('[data-mall-list]').textContent.includes('已核对入口位置')", "edit review and point without adding a visit");
        evaluate("{const card=[..." + cards + "].find(row=>row.querySelector('summary strong').textContent==='万象城');card.open=true;card.querySelector('[data-edit-visit]').click()}");
        assertEquals("true", evaluate("new URL(" + amapLink + ".href).searchParams.get('coordinate')==='gaode'"));
        report("mall_manual_pin_and_edit_update_the_same_visit");

        String form = modal + ".querySelector('form')";
        String photoCount = modal + ".querySelector('[data-mall-photo-count]').textContent";
        assertEquals("true", evaluate("['mallName','city','day'].every(key=>!" + form + ".elements[key].readOnly)"));
        evaluate("{const fields=" + form + ".elements;fields.mallName.value='测试万象城';fields.city.value='杭州';" + form + ".requestSubmit()}");
        waitFor(modal + ".querySelector('[data-mall-status]').textContent.includes('所选日期已有到访记录') && " + totals + " === '3'",
            "conflicting edit retains existing visits");
        evaluate("{const fields=" + form + ".elements;fields.mallName.value='改名商场';fields.city.value='宁波';fields.day.value=" + previous + ";" +
            "fields.city.dispatchEvent(new Event('input',{bubbles:true}));}");
        assertEquals("true", evaluate(amapLink + ".hidden"));
        evaluate("""
            (async () => {
              const fileInput = document.querySelector('[data-mall-photo-input]');
              const blob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN48+kVAAWWAslgVeOLAAAAAElFTkSuQmCC')).blob();
              const transfer = new DataTransfer();
              transfer.items.add(new File([blob], 'mall-test.png', {type:'image/png'}));
              fileInput.files = transfer.files;
              fileInput.dispatchEvent(new Event('change',{bubbles:true}));
            })()
            """);
        waitFor(photoCount + " === '2/3' && " + form + ".querySelector('[data-mall-save]:enabled')", "local photo prepared");
        evaluate(form + ".requestSubmit()");
        waitFor(totals + " === '3' && " + modal + ".querySelector('[data-mall-list]').textContent.includes('改名商场')",
            "edit moves name, city and date with photos attached");
        evaluate(modal + ".querySelector('[data-mall-photo-filter]').click()");
        assertEquals("true", evaluate(cards + ".length===1 && " + cards + "[0].querySelectorAll('.mall-photo-thumb').length===2 && " +
            cards + "[0].querySelector('time').dateTime===" + previous));
        report("mall_identity_date_and_photos_survive_edit");
    }

    @Test public void commuteClockWorksOnPhysicalPhone() throws Exception {
        assumeTrue("Requires a dedicated commute fixture", "true".equals(InstrumentationRegistry.getArguments().getString("qaCommuteFixture")));
        Bundle args = openIsolatedFixture();
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(args.getString("qaEmail")) +
            ";document.getElementById('login-password').value=" + JSONObject.quote(args.getString("qaPassword")) +
            ";document.getElementById('login-form').requestSubmit()");
        waitFor("window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden", "commute fixture login");
        openMobilePage("dashboard");
        clickOfflineControl("#commute-open");
        String dialog = "document.getElementById('commute-dialog')";
        waitFor(dialog + ".open && " + dialog + ".querySelectorAll('[data-stamp]:enabled').length === 4", "four commute buttons available");
        assertEquals("true", evaluate(dialog + ".getBoundingClientRect().width <= innerWidth"));
        clickOfflineControl("#commute-dialog [data-stamp=leave]");
        waitFor(dialog + ".querySelector('[data-stamp=leave]').dataset.recorded === 'true'", "one-tap departure is saved");
        clickOfflineControl("#commute-dialog [data-stamp=leave]");
        waitFor("!" + dialog + ".querySelector('[data-editor]').hidden", "existing timestamp opens its editor");
        clickOfflineControl("#commute-dialog [data-cancel]");
        report("commute_tap_records_once_and_existing_time_opens_editor");

        String historical = evaluate("(()=>{const d=new Date();d.setDate(d.getDate()-2);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')})()");
        String selectPast = "{const input=" + dialog + ".querySelector('[data-date]');input.value=" + historical +
            ";input.dispatchEvent(new Event('change',{bubbles:true}))}";
        evaluate(selectPast);
        String[][] rows = {{"leave", "21:45", "0"}, {"work", "22:15", "0"},
                           {"finish", "01:05", "1440"}, {"home", "01:35", "1440"}};
        for (String[] row : rows) {
            clickOfflineControl("#commute-dialog [data-stamp=" + row[0] + "]");
            waitFor("!" + dialog + ".querySelector('[data-editor]').hidden", "historical time editor");
            evaluate("{const form=" + dialog + ".querySelector('[data-editor]');form.elements.clock.value=" + JSONObject.quote(row[1]) +
                ";form.elements.offset.value=" + JSONObject.quote(row[2]) + ";form.requestSubmit()}");
            waitFor(dialog + ".querySelector('[data-stamp=" + row[0] + "]').dataset.recorded === 'true'", "historical stamp saved");
        }
        waitFor(dialog + ".querySelector('[data-duration]').textContent.includes('2 小时 50 分钟') && " +
            dialog + ".querySelector('[data-stamp=home] strong').textContent === '次日 01:35'", "overnight elapsed durations");
        report("commute_overnight_correction_calculates_duration");

        clickOfflineControl("#commute-dialog [data-close]");
        waitFor("!" + dialog + ".open", "close commute sheet");
        evaluate("window.__commuteFixture = true; setTimeout(()=>location.reload(),0); true");
        waitFor("typeof window.__commuteFixture === 'undefined' && window.DaynestAccount?.current?.()", "reload verified app session");
        openMobilePage("dashboard");
        clickOfflineControl("#commute-open");
        waitFor(dialog + ".open && " + dialog + ".querySelector('[data-stamp=leave]').dataset.recorded === 'true'", "today's timestamp persisted");
        evaluate(selectPast);
        waitFor(dialog + ".querySelector('[data-stamp=home] strong').textContent === '次日 01:35'", "historical note restored from device");
        clickOfflineControl("#commute-dialog summary");
        clickOfflineControl("#commute-dialog [data-span='30']");
        waitFor(dialog + ".querySelector('[data-sample]').textContent.includes('2 天有记录') && " +
            dialog + ".querySelector('[data-history]').textContent.includes('次日 01:35')", "rolling statistics and history restored");
        report("commute_records_persist_and_stats_include_both_days");
    }

    @Test public void todayWorkspaceWorksOnPhysicalPhone() throws Exception {
        assumeTrue("Requires a dedicated Today workspace fixture", "true".equals(InstrumentationRegistry.getArguments().getString("qaTodayFixture")));
        Bundle args = openIsolatedFixture();
        String label = args.getString("qaLabel");
        String todo = JSONObject.quote(label + " pending");
        String late = JSONObject.quote(label + " overdue");
        String appointment = JSONObject.quote(label + " appointment");
        String note = JSONObject.quote(label + " note");
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(args.getString("qaEmail")) +
            ";document.getElementById('login-password').value=" + JSONObject.quote(args.getString("qaPassword")) +
            ";document.getElementById('login-form').requestSubmit()");
        waitFor("window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden", "Today fixture login");
        openMobilePage("dashboard");
        String summary = "document.querySelectorAll('.mobile-today-filter')";
        waitFor(summary + "[0]?.textContent.startsWith('1') && " + summary + "[1]?.textContent.startsWith('1')", "Today loaded counts");
        assertEquals("true", evaluate("document.querySelector('.mobile-today-overview').getBoundingClientRect().right <= innerWidth"));
        assertEquals("true", evaluate("document.querySelector('.mobile-agenda-lead').textContent.includes(" + appointment + ")"));
        clickOfflineControl(".mobile-agenda-lead");
        waitFor("document.getElementById('calendar-event-dialog').open && document.getElementById('calendar-event-title').value === " + appointment, "Today opens the selected schedule item");
        clickOfflineControl("#calendar-dialog-close");
        report("today_counts_and_agenda_open_the_right_record");

        evaluate(summary + "[1].click()");
        waitFor("document.getElementById('today-todos').textContent.includes(" + late + ")", "overdue filter");
        assertEquals("false", evaluate("document.getElementById('today-todos').textContent.includes(" + todo + ")"));
        evaluate(summary + "[0].click()");
        clickOfflineControl("#today-todos [data-todo-completed='true']");
        waitFor(summary + "[0]?.textContent.startsWith('0') && " + summary + "[2]?.textContent.startsWith('1')", "completion updates the Today counts");
        evaluate(summary + "[2].click()");
        waitFor("document.getElementById('today-todos').textContent.includes(" + todo + ")", "completed filter retains the same task");
        report("today_completion_moves_one_task_to_completed");

        clickOfflineControl(".mobile-today-note-action");
        waitFor("document.getElementById('action-dialog').open && document.getElementById('action-todo-title').value === " + note, "saved note opens the linked action form");
        evaluate("document.getElementById('action-create-form').requestSubmit()");
        waitFor("document.getElementById('action-dialog').textContent.includes('打开原备忘录')", "action links back to its saved note");
        report("today_saved_note_creates_a_linked_todo_explicitly");
    }

    @Test public void offlineTodoCaptureWorksOnPhysicalPhone() throws Exception {
        assumeTrue("Requires an isolated offline capture fixture", "true".equals(InstrumentationRegistry.getArguments().getString("qaOfflineTodoFixture")));
        Bundle args = openIsolatedFixture();
        String title = JSONObject.quote(args.getString("qaLabel") + " offline todo");
        String frame = "document.getElementById('mobile-offline-frame').contentDocument";
        String inboxReady = "document.getElementById('mobile-offline-reader').open && " +
            frame + "?.getElementById('todo-outbox')?.hidden === false && " +
            frame + ".getElementById('ob-new').disabled === false";
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(args.getString("qaEmail")) +
            ";document.getElementById('login-password').value=" + JSONObject.quote(args.getString("qaPassword")) +
            ";document.getElementById('login-form').requestSubmit()");
        waitFor("window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden", "fixture login");
        evaluate("document.querySelector('.nav-link[data-view=dashboard]').click()");
        clickOfflineControl("#mobile-page-action");
        clickOfflineControl("[data-capture=local-todo]");
        waitFor(inboxReady, "verified account can use the new quick capture entry");
        clickOfflineControl("#mobile-offline-close");
        waitFor("!document.getElementById('mobile-offline-reader').open", "local capture closes");
        report("local_capture_ready_after_first_verified_login");

        fixtureControl(args, "offline");
        evaluate("setTimeout(()=>location.reload(),0); true");
        waitFor("document.getElementById('auth-view').dataset.mobileConnection === 'offline'", "offline cold launch");
        clickOfflineControl("#mobile-auth-offline");
        waitFor(frame + "?.querySelector('[data-offline-section=capture]')", "offline tabs loaded");
        evaluate(frame + ".querySelector('[data-offline-section=capture]').click()");
        waitFor(inboxReady, "offline entry opens previously verified inbox");
        evaluate(frame + ".getElementById('ob-new').click()");
        waitFor(frame + "?.getElementById('ob-editor')?.hidden === false", "open a local draft");
        evaluate("{const d=" + frame + ";const input=d.getElementById('ob-title');input.value=" + title +
            ";input.dispatchEvent(new Event('input',{bubbles:true}));d.getElementById('ob-save').click()}");
        waitFor(frame + ".getElementById('ob-items').textContent.includes(" + title + ") && " +
            frame + ".getElementById('ob-record-state').textContent.includes('本机已保存')", "local write is committed");
        report("offline_draft_is_committed_before_leaving");
        clickOfflineControl("#mobile-offline-close");
        waitFor("!document.getElementById('mobile-offline-reader').open && " +
            "document.getElementById('mobile-offline-frame').getAttribute('src') === 'about:blank'", "close and detach offline reader after writing");
        clickOfflineControl("#mobile-auth-offline");
        waitFor(frame + "?.querySelector('[data-offline-section=capture]')", "offline tabs loaded");
        evaluate(frame + ".querySelector('[data-offline-section=capture]').click()");
        waitFor(inboxReady, "reopened offline reader has verified identity");
        waitFor(inboxReady + " && " + frame + ".getElementById('ob-items').textContent.includes(" + title + ")", "draft reopens offline");
        report("offline_cold_launch_can_save_and_reopen_draft");

        fixtureControl(args, "online");
        clickOfflineControl("#mobile-offline-close");
        waitFor("!document.getElementById('mobile-offline-reader').open", "leave reader before retrying connection");
        clickOfflineControl("[data-mobile-retry]");
        waitFor("window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden", "session verified again");
        evaluate("document.querySelector('.nav-link[data-view=dashboard]').click()");
        clickOfflineControl("#mobile-page-action");
        clickOfflineControl("[data-capture=local-todo]");
        waitFor(inboxReady + " && " + frame + ".getElementById('ob-items').textContent.includes(" + title + ")", "draft retained after reconnect");
        evaluate(frame + ".querySelector('[data-outbox-id]').click()");
        waitFor(frame + ".getElementById('ob-editor').hidden === false && " +
            frame + ".getElementById('ob-title').value === " + title + " && " +
            frame + ".getElementById('ob-send').disabled === false", "saved draft loaded and explicit send available");
        evaluate(frame + ".getElementById('ob-send').click()");
        try {
            waitFor(frame + ".getElementById('ob-record-state').textContent.includes('已确认提交')", "manual submission confirmed");
        } catch (AssertionError error) {
            throw new AssertionError("Offline submission status: " + evaluate(frame + "?.getElementById('ob-status')?.textContent"), error);
        }
        report("reconnected_and_manually_submitted_local_draft");
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
        evaluate("location.hash='planner'");
        waitFor("location.hash==='#calendar' && !document.querySelector('#panel-planner,#panel-goals,#panel-tasks')", "retired learning pages");
        report("retired_learning_pages_redirect");
    }

    @Test public void learningRetirementWorksOnPhysicalPhone() throws Exception {
        assumeTrue("Requires a dedicated learning retirement fixture", "true".equals(InstrumentationRegistry.getArguments().getString("qaLearningRetirementFixture")));
        Bundle args = openIsolatedFixture();
        evaluate("document.getElementById('login-email').value=" + JSONObject.quote(args.getString("qaEmail")) +
            ";document.getElementById('login-password').value=" + JSONObject.quote(args.getString("qaPassword")) +
            ";document.getElementById('login-form').requestSubmit()");
        waitFor("window.DaynestAccount?.current?.() && !document.getElementById('mobile-tabs').hidden", "isolated fixture login");

        tapVisible("[data-mobile-view=all]");
        waitFor("document.getElementById('mobile-functions').open && document.querySelector('[data-mobile-target=todo]')", "function directory");
        for (String view : new String[]{"goals", "tasks", "insights", "planner"}) {
            assertEquals("Retired view " + view, "false",
                evaluate("Boolean(document.querySelector('#panel-" + view + ",.nav-link[data-view=" + view + "],[data-mobile-target=" + view + "]'))"));
        }
        tapVisible("#mobile-functions-close");
        report("retired_learning_entries_absent");

        for (String[] route : new String[][]{{"goals", "vocabulary"}, {"tasks", "todo"}, {"insights", "vocabulary"}, {"planner", "calendar"}}) {
            evaluate("location.hash=" + JSONObject.quote(route[0]));
            String destination = route[1];
            waitFor("location.hash==='#" + destination + "' && document.body.dataset.mobileView==='" + destination + "'", "legacy link " + route[0]);
        }
        report("legacy_learning_links_redirect");

        waitFor("document.querySelectorAll('[data-calendar-date]').length >= 28", "calendar shows month dates");
        String month = evaluate("document.getElementById('calendar-title').textContent");
        clickOfflineControl("#calendar-next");
        waitFor("document.getElementById('calendar-title').textContent !== " + month + " && document.querySelectorAll('[data-calendar-date]').length >= 28", "next calendar month");
        report("calendar_month_renders_and_navigates");

        String title = JSONObject.quote(args.getString("qaLabel") + " focus todo");
        openMobilePage("todo");
        clickOfflineControl("#mobile-page-action");
        waitFor("document.getElementById('mobile-todo-create').open", "todo creation sheet");
        evaluate("document.getElementById('todo-title').value=" + title +
            ";document.getElementById('todo-my-day').checked=true;document.getElementById('todo-form').requestSubmit()");
        waitFor("Array.from(document.querySelectorAll('.todo-item h4')).some(el => el.textContent === " + title + ")", "fixture todo appears in list");
        report("todo_created_in_app");

        openMobilePage("focus");
        waitFor("Array.from(document.querySelectorAll('#focus-task option')).some(el => el.value.startsWith('todo:') && el.textContent.includes(" + title + "))", "todo available to focus");
        String focusState = "document.getElementById('panel-focus').dataset.focusState";
        evaluate("const task=document.getElementById('focus-task');task.value=Array.from(task.options).find(el => el.textContent.includes(" + title +
            ")).value;task.dispatchEvent(new Event('change'));document.getElementById('focus-minutes').value=2;document.getElementById('focus-break-enabled').checked=false");
        clickOfflineControl("#start-focus");
        waitFor(focusState + " === 'running' && document.getElementById('focus-task').value.startsWith('todo:')", "todo focus started");
        clickOfflineControl("#pause-focus");
        waitFor(focusState + " === 'paused'", "focus paused");
        String time = evaluate("document.getElementById('focus-clock').textContent");
        SystemClock.sleep(1200);
        assertEquals("Paused time is stable", time, evaluate("document.getElementById('focus-clock').textContent"));
        clickOfflineControl("#resume-focus");
        waitFor(focusState + " === 'running' && document.getElementById('focus-clock').textContent !== " + time, "focus countdown resumed");
        clickOfflineControl("#finish-focus");
        waitFor(focusState + " === 'idle' && document.getElementById('focus-action-status').textContent.includes('已记录')", "focus record saved");
        report("todo_focus_starts_pauses_resumes_and_saves");
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

    private int localMinute(long time) {
        Calendar local = Calendar.getInstance();
        local.setTimeInMillis(time);
        return local.get(Calendar.HOUR_OF_DAY) * 60 + local.get(Calendar.MINUTE);
    }

    @Test public void quietHoursSkipDueNotificationsAfterSimulatedBoot() throws Exception {
        assumeTrue("Requires an explicit isolated quiet-hours run", "true".equals(InstrumentationRegistry.getArguments().getString("qaQuietHours")));
        Context context = instrumentation.getTargetContext();
        assumeTrue("Existing opted-in device reminders must be left alone",
            !CalendarReminderReceiver.enabled(context) && CalendarReminderReceiver.count(context) == 0);
        assertTrue(CalendarReminderReceiver.allowed(context));
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        CalendarReminderReceiver receiver = new CalendarReminderReceiver();
        CalendarReminderReceiver.QuietHours previous = CalendarReminderReceiver.quietHours(context);
        long now = System.currentTimeMillis(), minute = 60000L, dueAt = now - 10 * minute;
        var store = context.getSharedPreferences("calendar-reminders", Context.MODE_PRIVATE);
        Intent boot = new Intent(Intent.ACTION_BOOT_COMPLETED);
        JSONObject due = rebootFixtureEntry("quiet-due", dueAt, now + 15 * minute);
        JSONObject future = rebootFixtureEntry("quiet-future", now + 20 * minute, now + 40 * minute);
        try {
            CalendarReminderReceiver.setEnabled(context, true);
            long[][] windows = {
                { now - 2 * minute, now + 2 * minute }, // The OS delivered an earlier alarm during quiet hours.
                { dueAt - 2 * minute, dueAt + 2 * minute } // Boot resumed after a quiet-hours alarm.
            };
            for (long[] window : windows) {
                CalendarReminderReceiver.setQuietHours(context, new CalendarReminderReceiver.QuietHours(
                    true, localMinute(window[0]), localMinute(window[1])));
                assertTrue(store.edit().putString("pending", new JSONArray().put(due).put(future).toString()).commit());
                receiver.onReceive(context, boot);
                JSONArray pending = new JSONArray(store.getString("pending", "[]"));
                assertEquals(1, pending.length());
                assertEquals("quiet-future", pending.getJSONObject(0).getString("id"));
                assertEquals(0, notifications.getActiveNotifications().length);
            }
            report("quiet_hours_skip_delayed_and_missed_alarms_without_removing_future_alarms");
            CalendarReminderReceiver.setQuietHours(context, new CalendarReminderReceiver.QuietHours(false, 1320, 480));
            assertTrue(store.edit().putString("pending", new JSONArray().put(due).toString()).commit());
            receiver.onReceive(context, boot);
            waitForCalendarNotification(notifications, now - 1);
            assertEquals(0, CalendarReminderReceiver.count(context));
            report("alarm_resumes_when_quiet_hours_are_disabled");
        } finally {
            CalendarReminderReceiver.setEnabled(context, false);
            CalendarReminderReceiver.setQuietHours(context, previous);
        }
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
        assertEquals("0", evaluate("document.querySelectorAll('[data-mobile-target=memos],[data-mobile-target=inventory]').length"));
        tapVisible("#mobile-functions-close");
        for (String view : new String[]{"memos", "inventory"}) {
            evaluate("location.hash=" + JSONObject.quote("#" + view));
            waitFor("location.hash==='#dashboard' && document.body.dataset.mobileView==='dashboard'", "retired feature returns home");
        }
        report("retired_memos_and_inventory_are_absent");

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

        String[][] dialogs = {{"ledger", "ledger-new"}, {"subscriptions", "sub-new"}, {"fitness", "fit-log-open"}};
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

        openMobilePage("calendar");
        tapVisible("#mobile-page-action");
        waitFor("document.getElementById('calendar-event-dialog').open", "calendar editor");
        evaluate("document.getElementById('calendar-event-title').focus()");
        instrumentation.runOnMainSync(() -> {
            webView.requestFocus();
            InputMethodManager manager = (InputMethodManager) instrumentation.getTargetContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            manager.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
        });
        waitFor("document.body.classList.contains('mobile-keyboard-open')", "real keyboard resize");
        assertEquals("true", evaluate("(()=>{const r=document.getElementById('calendar-event-save').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=(window.visualViewport?.height||innerHeight)})()"));
        screenshot("calendar-keyboard");
        report("real_keyboard_preserves_save_action");
        instrumentation.runOnMainSync(() -> {
            InputMethodManager manager = (InputMethodManager) instrumentation.getTargetContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            manager.hideSoftInputFromWindow(webView.getWindowToken(), 0);
        });
        evaluate("document.activeElement.blur()");
        waitFor("!document.body.classList.contains('mobile-keyboard-open')", "keyboard closed");
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
        waitFor("!document.getElementById('calendar-event-dialog').open", "back closes the calendar editor");
        report("native_back_closes_calendar_editor");
        openMobilePage("dashboard");
    }
}
