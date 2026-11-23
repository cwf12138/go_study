package app.daynest.personal;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.amap.api.maps.AMap;
import com.amap.api.maps.CameraUpdateFactory;
import com.amap.api.maps.CoordinateConverter;
import com.amap.api.maps.MapView;
import com.amap.api.maps.MapsInitializer;
import com.amap.api.maps.model.BitmapDescriptorFactory;
import com.amap.api.maps.model.LatLng;
import com.amap.api.maps.model.LatLngBounds;
import com.amap.api.maps.model.Marker;
import com.amap.api.maps.model.MarkerOptions;
import com.amap.apis.utils.core.api.AMapUtilCoreApi;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class MallMapActivity extends AppCompatActivity {
    private static final String CONSENT = "amap_map_consent_v1";
    private static final String MAP_STATE = "map";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable loadTimeout = () -> reportFailure("高德地图加载超时。返回后可使用联网搜索或重试。");
    private FrameLayout mapContainer;
    private TextView status;
    private Button confirm;
    private MapView mapView;
    private Marker pin;
    private LatLng pending;
    private Integer candidate;
    private String pendingName;
    private boolean resumed;
    private boolean failed;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        createLayout();
        if (getPreferences(MODE_PRIVATE).getBoolean(CONSENT, false)) {
            startMap(state);
            return;
        }
        showConsent();
    }

    private void createLayout() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        root.setBackgroundColor(dark ? 0xff17201e : 0xfff4f8f6);
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightStatusBars(!dark);
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightNavigationBars(!dark);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return windowInsets;
        });
        setContentView(root);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), 0, dp(16), 0);
        Button back = new Button(this, null, android.R.attr.borderlessButtonStyle);
        back.setText("返回");
        back.setOnClickListener(view -> finish());
        TextView title = new TextView(this);
        title.setText("高德地图选点");
        title.setTextSize(19);
        ViewCompat.setAccessibilityHeading(title, true);
        bar.addView(back);
        bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(bar, new LinearLayout.LayoutParams(-1, dp(56)));

        mapContainer = new FrameLayout(this);
        root.addView(mapContainer, new LinearLayout.LayoutParams(-1, 0, 1));
        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.VERTICAL);
        footer.setPadding(dp(16), dp(10), dp(16), dp(8));
        status = new TextView(this);
        status.setTextSize(15);
        status.setAccessibilityLiveRegion(TextView.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setText("正在准备高德地图…");
        confirm = new Button(this);
        confirm.setText("使用这个位置");
        confirm.setEnabled(false);
        confirm.setOnClickListener(view -> confirmSelection());
        footer.addView(status, new LinearLayout.LayoutParams(-1, -2));
        footer.addView(confirm, new LinearLayout.LayoutParams(-1, dp(48)));
        root.addView(footer, new LinearLayout.LayoutParams(-1, -2));
    }

    private void showConsent() {
        AlertDialog consent = new AlertDialog.Builder(this)
                .setTitle("使用高德地图")
                .setMessage("地图由北京高德图强科技有限公司的高德开放平台地图 SDK 提供，用于显示底图和选择商场位置。高德可能处理用于展示和鉴权的设备、应用及网络信息。Daynest 不通过此功能请求手机定位权限，也不会把评分和备注发送给高德。")
                .setNegativeButton("暂不使用", (dialog, button) -> finish())
                .setPositiveButton("同意并打开", (dialog, button) -> {
                    getPreferences(MODE_PRIVATE).edit().putBoolean(CONSENT, true).apply();
                    startMap(null);
                })
                .setNeutralButton("高德隐私政策", null)
                .setOnCancelListener(dialog -> finish())
                .create();
        consent.show();
        consent.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://lbs.amap.com/pages/privacy/")));
            } catch (ActivityNotFoundException error) {
                status.setText("请在浏览器打开 lbs.amap.com/pages/privacy/ 查看隐私政策。");
            }
        });
    }

    private void startMap(Bundle state) {
        String key = getString(R.string.daynest_amap_android_key);
        if (key.isEmpty()) {
            reportFailure("此安装包尚未配置高德地图。");
            return;
        }
        try {
            MapsInitializer.updatePrivacyShow(getApplicationContext(), true, true);
            MapsInitializer.updatePrivacyAgree(getApplicationContext(), true);
            AMapUtilCoreApi.setCollectInfoEnable(false);
            MapsInitializer.setApiKey(key);
            mapView = new MapView(this);
            mapView.onCreate(state == null ? null : state.getBundle(MAP_STATE));
            mapContainer.addView(mapView, new FrameLayout.LayoutParams(-1, -1));
            if (resumed) mapView.onResume();

            AMap map = mapView.getMap();
            map.getUiSettings().setRotateGesturesEnabled(false);
            map.getUiSettings().setTiltGesturesEnabled(false);
            if ((getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES) {
                map.setMapType(AMap.MAP_TYPE_NIGHT);
            }
            if (state != null && state.containsKey("lat")) {
                pending = new LatLng(state.getDouble("lat"), state.getDouble("lng"));
                if (state.containsKey("candidate")) candidate = state.getInt("candidate");
                pendingName = state.getString("name");
            }
            map.setOnMapClickListener(point -> select(map, point, null, "已选择地图位置"));
            map.setOnMarkerClickListener(marker -> {
                if (marker.getObject() instanceof Integer index) select(map, marker.getPosition(), index, marker.getTitle());
                return true;
            });
            handler.postDelayed(loadTimeout, 18000);
            map.setOnMapLoadedListener(() -> {
                if (failed || isFinishing() || isDestroyed()) return;
                handler.removeCallbacks(loadTimeout);
                try {
                    showSavedAndCandidatePoints(map, state == null);
                    if (pending != null) select(map, pending, candidate, pendingName);
                    else status.setText("轻点地图或商场标记，然后确认位置。");
                } catch (RuntimeException | JSONException error) {
                    reportFailure("商场位置暂时无法在地图上显示。");
                }
            });
        } catch (RuntimeException | LinkageError error) {
            reportFailure("高德地图暂时无法打开。");
        }
    }

    private void showSavedAndCandidatePoints(AMap map, boolean firstLoad) throws JSONException {
        String selected = getIntent().getStringExtra("selected");
        LatLng current = selected == null ? null : addPlace(map, new JSONObject(selected), -1);
        JSONArray places = new JSONArray(getIntent().getStringExtra("candidates"));
        LatLngBounds.Builder bounds = LatLngBounds.builder();
        LatLng first = null;
        boolean multiple = false;
        for (int i = 0; i < places.length(); i++) {
            LatLng point = addPlace(map, places.getJSONObject(i), i);
            if (point == null) continue;
            if (first == null) first = point;
            else multiple |= !first.equals(point);
            bounds.include(point);
        }
        if (!firstLoad) return;
        if (current != null) map.moveCamera(CameraUpdateFactory.newLatLngZoom(current, 16));
        else if (multiple) map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), dp(52)));
        else if (first != null) map.moveCamera(CameraUpdateFactory.newLatLngZoom(first, 16));
        else map.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(35, 104), 4));
    }

    private LatLng addPlace(AMap map, JSONObject data, int index) {
        double lat = data.optDouble("lat"), lng = data.optDouble("lng");
        if (!Double.isFinite(lat) || Math.abs(lat) > 90 || !Double.isFinite(lng) || Math.abs(lng) > 180) return null;
        LatLng point = new LatLng(lat, lng);
        if (!"gcj02".equals(data.optString("coordinateSystem"))) {
            point = new CoordinateConverter(this).from(CoordinateConverter.CoordType.GPS).coord(point).convert();
            if (point == null) return null;
        }
        String name = data.optString("name", "").trim();
        Marker marker = map.addMarker(new MarkerOptions().position(point).title(name.isEmpty() ? "已绑定位置" : name));
        if (marker != null) marker.setObject(index);
        return point;
    }

    private void select(AMap map, LatLng point, Integer index, String name) {
        if (failed) return;
        if (pin != null) pin.remove();
        pin = map.addMarker(new MarkerOptions().position(point).zIndex(1)
                .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_GREEN)));
        pending = point;
        candidate = index;
        pendingName = name;
        status.setText(name);
        confirm.setEnabled(true);
    }

    private void confirmSelection() {
        if (pending == null) return;
        Intent result = new Intent();
        if (candidate != null) result.putExtra("candidate", candidate);
        else result.putExtra("lat", pending.latitude).putExtra("lng", pending.longitude);
        setResult(RESULT_OK, result);
        finish();
    }

    private void reportFailure(String message) {
        failed = true;
        handler.removeCallbacks(loadTimeout);
        status.setText(message);
        confirm.setEnabled(true);
        confirm.setText("返回商场足迹");
        confirm.setOnClickListener(view -> {
            setResult(RESULT_OK, new Intent().putExtra("error", true));
            finish();
        });
    }

    private int dp(int value) { return Math.round(getResources().getDisplayMetrics().density * value); }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (mapView != null) mapView.onResume();
    }

    @Override protected void onPause() {
        resumed = false;
        if (mapView != null) mapView.onPause();
        super.onPause();
    }

    @Override public void onLowMemory() {
        super.onLowMemory();
        if (mapView != null) mapView.onLowMemory();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (mapView != null) {
            Bundle mapState = new Bundle();
            mapView.onSaveInstanceState(mapState);
            state.putBundle(MAP_STATE, mapState);
        }
        if (pending != null) {
            state.putDouble("lat", pending.latitude);
            state.putDouble("lng", pending.longitude);
            if (candidate != null) state.putInt("candidate", candidate);
            state.putString("name", pendingName);
        }
    }

    @Override protected void onDestroy() {
        handler.removeCallbacks(loadTimeout);
        if (mapView != null) mapView.onDestroy();
        super.onDestroy();
    }
}
