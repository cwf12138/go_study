package app.daynest.personal;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "DaynestBrowsers")
public class DaynestBrowsersPlugin extends Plugin {
    private static final String PREFERENCE = "article_browser";
    private static final String SYSTEM = "system";

    @PluginMethod
    public void openArticle(PluginCall call) {
        Uri uri = articleUri(call.getString("url", ""));
        if (uri == null) {
            call.reject("这篇文章没有有效的 HTTPS 原文地址。", "INVALID_URL");
            return;
        }
        getActivity().runOnUiThread(() -> openOrChoose(call, uri));
    }

    private void openOrChoose(PluginCall call, Uri uri) {
        SharedPreferences prefs = getContext().getSharedPreferences("daynest_reading", Context.MODE_PRIVATE);
        String chosen = prefs.getString(PREFERENCE, "");
        List<Browser> browsers = installedBrowsers();
        if (!Boolean.TRUE.equals(call.getBoolean("choose", false)) && !chosen.isEmpty()) {
            boolean available = SYSTEM.equals(chosen) || browsers.stream().anyMatch(browser -> browser.packageName.equals(chosen));
            if (available && launch(uri, chosen)) {
                call.resolve();
                return;
            }
        }

        List<String> labels = new ArrayList<>();
        labels.add("跟随系统默认");
        for (Browser browser : browsers) labels.add(browser.label);
        new AlertDialog.Builder(getActivity())
            .setTitle("选择阅读全文的浏览器")
            .setItems(labels.toArray(new String[0]), (dialog, index) -> {
                String selected = index == 0 ? SYSTEM : browsers.get(index - 1).packageName;
                if (launch(uri, selected)) {
                    prefs.edit().putString(PREFERENCE, selected).apply();
                    call.resolve();
                } else {
                    call.reject("这个浏览器无法打开该链接，请选择其他浏览器。", "OPEN_FAILED");
                }
            })
            .setNegativeButton("取消", (dialog, which) -> call.resolve())
            .setOnCancelListener(dialog -> call.resolve())
            .show();
    }

    private List<Browser> installedBrowsers() {
        PackageManager packages = getContext().getPackageManager();
        Intent browserApp = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_BROWSER);
        Map<String, Browser> browsers = new LinkedHashMap<>();
        for (ResolveInfo entry : packages.queryIntentActivities(browserApp, PackageManager.MATCH_ALL)) {
            if (entry.activityInfo == null || !entry.activityInfo.exported) continue;
            String name = entry.activityInfo.packageName;
            if (webIntent(Uri.parse("https://example.invalid/")).setPackage(name).resolveActivity(packages) == null) continue;
            browsers.putIfAbsent(name, new Browser(name, entry.activityInfo.applicationInfo.loadLabel(packages).toString()));
        }
        List<Browser> list = new ArrayList<>(browsers.values());
        list.sort((a, b) -> a.label.compareToIgnoreCase(b.label));
        return list;
    }

    private boolean launch(Uri uri, String selected) {
        Intent intent = webIntent(uri);
        if (!SYSTEM.equals(selected)) intent.setPackage(selected);
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException error) {
            return false;
        }
    }

    private static Intent webIntent(Uri uri) {
        return new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
    }

    private static Uri articleUri(String value) {
        try {
            URI parsed = URI.create(value);
            if ("https".equalsIgnoreCase(parsed.getScheme()) && parsed.getHost() != null && parsed.getUserInfo() == null) {
                return Uri.parse(parsed.toASCIIString()).normalizeScheme();
            }
        } catch (IllegalArgumentException ignored) {
        }
        return null;
    }

    private static class Browser {
        final String packageName;
        final String label;
        Browser(String packageName, String label) {
            this.packageName = packageName;
            this.label = label;
        }
    }
}
