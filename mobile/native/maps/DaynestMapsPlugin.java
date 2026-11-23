package app.daynest.personal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DaynestMaps")
public class DaynestMapsPlugin extends Plugin {
    @PluginMethod
    public void openPlace(PluginCall call) {
        double lat = call.getDouble("lat", Double.NaN);
        double lng = call.getDouble("lng", Double.NaN);
        if (!Double.isFinite(lat) || Math.abs(lat) > 90 || !Double.isFinite(lng) || Math.abs(lng) > 180) {
            call.reject("该商场还没有有效位置", "BAD_MAP_INPUT");
            return;
        }
        String name = call.getString("name", "商场位置");
        boolean gcj = "gcj02".equals(call.getString("coordinateSystem"));
        Uri marker = new Uri.Builder().scheme("androidamap").authority("viewMap")
                .appendQueryParameter("sourceApplication", "Daynest")
                .appendQueryParameter("poiname", name)
                .appendQueryParameter("lat", Double.toString(lat))
                .appendQueryParameter("lon", Double.toString(lng))
                .appendQueryParameter("dev", gcj ? "0" : "1")
                .build();
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, marker).setPackage("com.autonavi.minimap");
                intent.addCategory(Intent.CATEGORY_DEFAULT);
                getActivity().startActivity(intent);
                resolveOpen(call, "app");
            } catch (ActivityNotFoundException | SecurityException unavailable) {
                Uri web = new Uri.Builder().scheme("https").authority("uri.amap.com").path("/marker")
                        .appendQueryParameter("position", lng + "," + lat)
                        .appendQueryParameter("name", name)
                        .appendQueryParameter("coordinate", gcj ? "gaode" : "wgs84")
                        .appendQueryParameter("callnative", "0")
                        .appendQueryParameter("src", "Daynest")
                        .build();
                try {
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW, web));
                    resolveOpen(call, "web");
                } catch (ActivityNotFoundException | SecurityException error) {
                    call.reject("手机暂时无法打开高德地图", "MAP_OPEN_FAILED");
                }
            }
        });
    }

    private void resolveOpen(PluginCall call, String target) {
        JSObject result = new JSObject();
        result.put("target", target);
        call.resolve(result);
    }

    @PluginMethod
    public void pick(PluginCall call) {
        if (getContext().getString(R.string.daynest_amap_android_key).isEmpty()) {
            call.reject("此安装包尚未配置高德地图", "MISSING_AMAP_KEY");
            return;
        }
        JSObject selected = call.getObject("selected");
        JSArray candidates = call.getArray("candidates", new JSArray());
        if (candidates.length() > 8) {
            call.reject("商场候选最多 8 个", "BAD_MAP_INPUT");
            return;
        }
        Intent intent = new Intent(getActivity(), MallMapActivity.class);
        if (selected != null) intent.putExtra("selected", selected.toString());
        intent.putExtra("candidates", candidates.toString());
        getActivity().runOnUiThread(() -> startActivityForResult(call, intent, "locationPicked"));
    }

    @ActivityCallback
    private void locationPicked(PluginCall call, ActivityResult response) {
        if (call == null) return;
        Intent data = response.getData();
        JSObject result = new JSObject();
        if (response.getResultCode() != Activity.RESULT_OK || data == null) {
            result.put("cancelled", true);
        } else if (data.hasExtra("error")) {
            call.reject("高德地图暂时无法打开", "AMAP_LOAD_FAILED");
            return;
        } else if (data.hasExtra("candidate")) {
            int index = data.getIntExtra("candidate", -1);
            if (index == -1) result.put("existing", true);
            else result.put("candidate", index);
        } else {
            result.put("lat", data.getDoubleExtra("lat", Double.NaN));
            result.put("lng", data.getDoubleExtra("lng", Double.NaN));
        }
        call.resolve(result);
    }
}
