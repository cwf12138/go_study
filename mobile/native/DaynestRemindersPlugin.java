package app.daynest.personal;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashSet;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "DaynestReminders", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class DaynestRemindersPlugin extends Plugin {
    private volatile String openDate;

    @Override public void load() { readOpenDate(getActivity().getIntent()); }

    @Override protected void handleOnNewIntent(Intent intent) {
        readOpenDate(intent);
        if (openDate != null) notifyListeners("calendarOpened", new JSObject());
    }

    private void readOpenDate(Intent intent) {
        if (intent == null || !CalendarReminderReceiver.OPEN.equals(intent.getAction())) return;
        String date = intent.getStringExtra("date");
        if (date != null && date.matches("\\d{4}-\\d{2}-\\d{2}")) openDate = date;
        intent.removeExtra("date");
    }

    @PluginMethod public void takeOpenDate(PluginCall call) {
        String date = openDate;
        openDate = null;
        call.resolve(new JSObject().put("date", date));
    }

    @PluginMethod public void status(PluginCall call) {
        call.resolve(new JSObject().put("enabled", CalendarReminderReceiver.enabled(getContext()))
            .put("permitted", CalendarReminderReceiver.allowed(getContext()))
            .put("exact", CalendarReminderReceiver.exact(getContext())).put("count", CalendarReminderReceiver.count(getContext())));
    }

    @PluginMethod public void enable(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationResult");
        } else notificationResult(call);
    }

    @PermissionCallback private void notificationResult(PluginCall call) {
        try {
            CalendarReminderReceiver.setEnabled(getContext(), CalendarReminderReceiver.allowed(getContext()));
            status(call);
        } catch (RuntimeException error) { call.reject("无法更新本机提醒。"); }
    }

    @PluginMethod public void disable(PluginCall call) {
        try { CalendarReminderReceiver.setEnabled(getContext(), false); status(call); }
        catch (RuntimeException error) { call.reject("无法更新本机提醒。"); }
    }

    @PluginMethod public void clear(PluginCall call) {
        try { openDate = null; CalendarReminderReceiver.clear(getContext()); status(call); }
        catch (RuntimeException error) { call.reject("无法清除本机提醒。"); }
    }

    @PluginMethod public void openSettings(PluginCall call) {
        Intent intent = Build.VERSION.SDK_INT >= 26
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + getContext().getPackageName()));
        try { getActivity().startActivity(intent); call.resolve(); }
        catch (RuntimeException error) { call.reject("请在 Android 设置中检查 Daynest 的通知权限。"); }
    }

    @PluginMethod public void openExactSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 31) { call.resolve(); return; }
        Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
            android.net.Uri.parse("package:" + getContext().getPackageName()));
        try { getActivity().startActivity(intent); call.resolve(); }
        catch (RuntimeException error) { call.reject("请在 Android 设置中检查「闹钟和提醒」权限。"); }
    }

    @PluginMethod public void replace(PluginCall call) {
        try {
            JSONArray input = call.getArray("entries"), rows = new JSONArray();
            if (input == null || input.length() > CalendarReminderReceiver.LIMIT) throw new IllegalArgumentException();
            HashSet<String> ids = new HashSet<>();
            long now = System.currentTimeMillis();
            for (int i = 0; i < input.length(); i++) {
                JSONObject entry = input.getJSONObject(i);
                String id = entry.getString("id"), date = entry.getString("date");
                long at = entry.getLong("at"), start = entry.getLong("start");
                if (!id.matches("[A-Za-z0-9@_.:-]{1,180}") || !ids.add(id) || !date.matches("\\d{4}-\\d{2}-\\d{2}")
                    || at > now + 8L * 86400000 || start <= at || start - at > 28L * 86400000) throw new IllegalArgumentException();
                if (start <= now) continue;
                rows.put(new JSONObject().put("id", id).put("date", date).put("at", at).put("start", start));
            }
            CalendarReminderReceiver.reconcile(getContext(), rows);
            status(call);
        } catch (Exception error) { call.reject("无法安排本机日程提醒。"); }
    }
}
