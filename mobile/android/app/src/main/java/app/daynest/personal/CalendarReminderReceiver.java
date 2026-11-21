package app.daynest.personal;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationManagerCompat;
import java.util.HashMap;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class CalendarReminderReceiver extends BroadcastReceiver {
    static final String OPEN = "app.daynest.personal.OPEN_CALENDAR_REMINDER";
    private static final String FIRE = "app.daynest.personal.FIRE_CALENDAR_REMINDER";
    private static final String SNOOZE = "app.daynest.personal.SNOOZE_CALENDAR_REMINDER";
    private static final String CHANNEL = "calendar-reminders";
    private static final int NOTIFICATION = 421, ALARM = 422, SNOOZE_ACTION = 423;
    private static final long SNOOZE_MS = 5 * 60 * 1000L;
    static final int LIMIT = 256;

    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences("calendar-reminders", Context.MODE_PRIVATE);
    }

    static boolean enabled(Context context) { return store(context).getBoolean("enabled", false); }

    static boolean exact(Context context) {
        return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    static boolean allowed(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel channel = context.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private static JSONArray readRows(Context context, String key) {
        try { return new JSONArray(store(context).getString(key, "[]")); }
        catch (JSONException invalid) { return new JSONArray(); }
    }

    static synchronized int count(Context context) { return readRows(context, "pending").length(); }

    static synchronized void setEnabled(Context context, boolean value) {
        if (!store(context).edit().putBoolean("enabled", value).commit()) {
            throw new IllegalStateException("无法更新本机提醒。");
        }
        if (!value) clear(context);
    }

    static synchronized void clear(Context context) {
        JSONArray empty = new JSONArray();
        saveAndSchedule(context, empty, clearDelivered(store(context).edit()));
        context.getSystemService(NotificationManager.class).cancel(NOTIFICATION);
    }

    private static SharedPreferences.Editor clearDelivered(SharedPreferences.Editor editor) {
        return editor.remove("delivered").remove("snoozeToken");
    }

    private static HashMap<String, JSONObject> byId(JSONArray rows) {
        HashMap<String, JSONObject> indexed = new HashMap<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null) indexed.put(row.optString("id"), row);
        }
        return indexed;
    }

    private static boolean sameSchedule(JSONObject previous, JSONObject current) {
        return previous != null && current != null && previous.optLong("at") == current.optLong("at")
            && previous.optLong("start") == current.optLong("start");
    }

    private static long triggerAt(JSONObject row) {
        return row.optLong("snoozeAt", row.optLong("at", Long.MAX_VALUE));
    }

    static synchronized void reconcile(Context context, JSONArray candidates) {
        if (!enabled(context) || !allowed(context)) { clear(context); return; }
        HashMap<String, JSONObject> queued = byId(readRows(context, "pending"));
        JSONArray next = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < candidates.length(); i++) {
            JSONObject row = candidates.optJSONObject(i);
            if (row == null || row.optLong("start") <= now) continue;
            JSONObject previous = queued.get(row.optString("id"));
            // Preserve only pending alarms tied to the same occurrence and schedule.
            if (sameSchedule(previous, row)) next.put(previous);
            else if (row.optLong("at") > now) next.put(row);
        }

        SharedPreferences.Editor editor = store(context).edit();
        JSONArray delivered = readRows(context, "delivered"), matching = new JSONArray();
        String token = null;
        if (delivered.length() != 0) {
            HashMap<String, JSONObject> updated = byId(candidates);
            for (int i = 0; i < delivered.length(); i++) {
                JSONObject row = delivered.optJSONObject(i);
                if (row != null && row.optLong("start") > now && sameSchedule(row, updated.get(row.optString("id")))) {
                    matching.put(row);
                }
            }
            if (matching.length() == 0) {
                clearDelivered(editor);
            } else if (matching.length() != delivered.length()) {
                editor.putString("delivered", matching.toString());
                if (canSnooze(matching, now)) token = store(context).getString("snoozeToken", null);
                else editor.remove("snoozeToken");
            }
        }
        saveAndSchedule(context, next, editor);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (delivered.length() != matching.length()) {
            if (matching.length() == 0) manager.cancel(NOTIFICATION);
            else for (StatusBarNotification notification : manager.getActiveNotifications()) {
                if (notification.getId() == NOTIFICATION) {
                    postNotification(context, matching, token, true);
                    break;
                }
            }
        }
    }

    static synchronized void replace(Context context, JSONArray rows) {
        saveAndSchedule(context, rows, store(context).edit());
    }

    private static void saveAndSchedule(Context context, JSONArray rows, SharedPreferences.Editor editor) {
        if (!editor.putString("pending", rows.toString()).commit()) {
            throw new IllegalStateException("无法保存本机提醒。");
        }
        scheduleNext(context, rows);
    }

    private static void scheduleNext(Context context, JSONArray rows) {
        Intent intent = new Intent(context, CalendarReminderReceiver.class).setAction(FIRE);
        PendingIntent alarm = PendingIntent.getBroadcast(context, ALARM, intent, PendingIntent.FLAG_IMMUTABLE);
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        long next = Long.MAX_VALUE;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null) next = Math.min(next, triggerAt(row));
        }
        if (!enabled(context) || !allowed(context) || next == Long.MAX_VALUE) {
            manager.cancel(alarm);
            return;
        }
        if (exact(context)) {
            try { manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm); return; }
            catch (SecurityException ignored) { /* Special access can be revoked during this call. */ }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm);
    }

    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        try {
            if (SNOOZE.equals(action)) snooze(context, intent.getStringExtra("token"));
            else if (FIRE.equals(action) || Intent.ACTION_BOOT_COMPLETED.equals(action)
                    || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                    || AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) deliver(context);
        }
        catch (RuntimeException error) { android.util.Log.w("DaynestReminders", "Unable to update system reminder schedule", error); }
    }

    private static synchronized void snooze(Context context, String token) {
        SharedPreferences prefs = store(context);
        if (token == null || !token.equals(prefs.getString("snoozeToken", null))) return;
        if (!enabled(context) || !allowed(context)) { clear(context); return; }

        long snoozeAt = System.currentTimeMillis() + SNOOZE_MS;
        JSONArray rows = readRows(context, "pending");
        int previousCount = rows.length();
        JSONArray delivered = readRows(context, "delivered");
        HashMap<String, JSONObject> queued = byId(rows);
        for (int i = 0; i < delivered.length() && rows.length() < LIMIT; i++) {
            JSONObject row = delivered.optJSONObject(i);
            if (row == null || row.optLong("start") <= snoozeAt || queued.containsKey(row.optString("id"))) continue;
            try { row.put("snoozeAt", snoozeAt); }
            catch (JSONException error) { throw new IllegalStateException(error); }
            rows.put(row);
        }
        if (rows.length() != previousCount) {
            saveAndSchedule(context, rows, clearDelivered(prefs.edit()));
            context.getSystemService(NotificationManager.class).cancel(NOTIFICATION);
        }
    }

    private static boolean canSnooze(JSONArray rows, long now) {
        for (int i = 0; i < rows.length(); i++) {
            if (rows.optJSONObject(i).optLong("start") > now + SNOOZE_MS) return true;
        }
        return false;
    }

    private static synchronized void deliver(Context context) {
        if (!enabled(context) || !allowed(context)) { clear(context); return; }
        JSONArray rows = readRows(context, "pending"), future = new JSONArray(), due = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null || row.optLong("start") <= now) continue;
            if (triggerAt(row) > now) future.put(row);
            else due.put(row);
        }
        if (due.length() == 0) {
            replace(context, future);
            return;
        }
        String token = canSnooze(due, now) ? UUID.randomUUID().toString() : null;
        SharedPreferences.Editor editor = clearDelivered(store(context).edit()).putString("delivered", due.toString());
        if (token != null) editor.putString("snoozeToken", token);
        saveAndSchedule(context, future, editor);
        postNotification(context, due, token, false);
    }

    private static void postNotification(Context context, JSONArray due, String token, boolean silentUpdate) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "日程提醒", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(context, MainActivity.class).setAction(OPEN).putExtra("date", due.optJSONObject(0).optString("date"));
        PendingIntent tap = PendingIntent.getActivity(context, NOTIFICATION, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        // No titles, locations or account details are stored or exposed on the lock screen.
        builder.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("日程提醒")
            .setContentText(due.length() == 1 ? "有一项日程即将开始。点此查看日历。" : "有 " + due.length() + " 项日程即将开始。点此查看日历。")
            .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(silentUpdate).setVisibility(Notification.VISIBILITY_PRIVATE);
        if (token != null) {
            Intent snooze = new Intent(context, CalendarReminderReceiver.class).setAction(SNOOZE).putExtra("token", token);
            PendingIntent action = PendingIntent.getBroadcast(context, SNOOZE_ACTION, snooze,
                PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE);
            builder.addAction(new Notification.Action.Builder(android.R.drawable.ic_popup_reminder, "稍后 5 分钟", action).build());
        }
        try { manager.notify(NOTIFICATION, builder.build()); }
        catch (SecurityException ignored) { /* Notification permission may be revoked while delivering. */ }
    }
}
