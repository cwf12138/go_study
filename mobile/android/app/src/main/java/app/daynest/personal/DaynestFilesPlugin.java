package app.daynest.personal;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.JSONObject;

@CapacitorPlugin(name = "DaynestFiles")
public class DaynestFilesPlugin extends Plugin {
    private static final int UPLOAD_MAX = 8 * 1024 * 1024, EXPORT_MAX = 64 * 1024 * 1024;
    private final ConcurrentHashMap<String, Task> tasks = new ConcurrentHashMap<>();
    private final AtomicReference<Task> chooser = new AtomicReference<>();
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 3, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16));
    private volatile String server = "", session = "";

    private static class Task {
        String id, owner, name, mime = "application/octet-stream";
        long expected, written;
        File file;
        PluginCall call;
        volatile boolean cancelled;
        volatile HttpURLConnection connection;
        AtomicBoolean settled = new AtomicBoolean(false);
    }
    private static String required(PluginCall call, String name) throws Exception {
        String value = call.getString(name);
        if (value == null) throw new Exception("缺少参数 " + name);
        return value;
    }
    private static boolean privateIPv4(String host) {
        if (!host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] parts = host.split("\\."); int[] p = new int[4];
        for (int i = 0; i < 4; i++) { p[i] = Integer.parseInt(parts[i]); if (p[i] > 255 || !parts[i].equals(String.valueOf(p[i]))) return false; }
        return p[0] == 10 || p[0] == 192 && p[1] == 168 || p[0] == 172 && p[1] >= 16 && p[1] <= 31;
    }
    static String validServer(String value) throws Exception {
        URI uri = new URI(value);
        String host = uri.getHost(), scheme = uri.getScheme();
        if (host == null || !("http".equals(scheme) || "https".equals(scheme)) || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || !(uri.getRawPath() == null || uri.getRawPath().isEmpty() || uri.getRawPath().equals("/")) || value.matches(".*[\\\\\\s\\x00-\\x1f].*")) throw new Exception("服务器地址不合法");
        if (host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1") || host.equals("0.0.0.0") || host.equals("[::1]") || host.equals("::1")) throw new Exception("请使用电脑的局域网地址");
        if ("http".equals(scheme) && !privateIPv4(host)) throw new Exception("HTTP 只允许明确的局域网 IPv4 地址");
        int port = uri.getPort(); if (port > 65535 || port == 0) throw new Exception("端口不合法");
        return new URI(scheme, null, host, port, null, null, null).toString();
    }
    private static String safeName(String value) {
        String name = value.replaceAll("[\\x00-\\x1f\\x7f/\\\\:*?\"<>|]", "-");
        return name.isEmpty() ? "daynest-file" : name.substring(0, Math.min(160, name.length()));
    }
    private void check(Task task) throws Exception {
        if (task.cancelled || !task.owner.equals(session)) throw new Exception("操作已取消或账号已切换");
    }
    private Task create(PluginCall call, String id) throws Exception {
        if (!id.matches("[A-Za-z0-9_-]{8,80}") || tasks.size() >= 20) throw new Exception("文件任务标识无效或任务过多");
        Task task = new Task(); task.id = id; task.owner = required(call, "token"); check(task);
        task.name = safeName(required(call, "filename"));
        if (tasks.putIfAbsent(id, task) != null) throw new Exception("同一个文件任务正在进行");
        return task;
    }
    private void clean(Task task) {
        tasks.remove(task.id, task);
        if (task.connection != null) task.connection.disconnect();
        // This is an app-generated private staging file, never the user's saved destination.
        if (task.file != null) task.file.delete();
    }
    private void fail(Task task, String message, String code) {
        if (task.settled.compareAndSet(false, true) && task.call != null) task.call.reject(message, code);
        clean(task);
    }
    private void execute(Task task, Runnable work) {
        try { workers.execute(work); } catch (RejectedExecutionException error) { fail(task, "文件通道繁忙，请稍后重试", "BUSY"); }
    }
    @PluginMethod public void configure(PluginCall call) {
        try {
            String next = validServer(required(call, "server"));
            if (!next.equals(server)) { for (Task task : tasks.values()) cancelTask(task); server = next; }
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage()); }
    }
    @PluginMethod public void setSession(PluginCall call) {
        String next = call.getString("token", ""); session = next;
        for (Task task : tasks.values()) if (!task.owner.equals(next)) cancelTask(task);
        call.resolve();
    }
    private void cancelTask(Task task) { task.cancelled = true; fail(task, "操作已取消；服务端结果仍需核对", "CANCELLED"); }
    @PluginMethod public void cancel(PluginCall call) { Task task = tasks.get(call.getString("id", "")); if (task != null) cancelTask(task); call.resolve(); }
    private HttpURLConnection open(Task task, String path, String method) throws Exception {
        check(task); if (server.isEmpty()) throw new Exception("尚未配置电脑服务");
        if (!path.startsWith("/api/v1/") || path.contains("\\") || path.contains("#") || java.util.regex.Pattern.compile("[\\x00-\\x20]").matcher(path).find()) throw new Exception("文件接口路径不合法");
        URL url = new URL(server + path);
        if (!url.toURI().getPath().startsWith("/api/v1/")) throw new Exception("文件接口路径不合法");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection(); task.connection = connection;
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(8000); connection.setReadTimeout(120000); connection.setUseCaches(false); connection.setRequestMethod(method);
        if (task.owner.isEmpty() || task.owner.length() > 16000 || task.owner.indexOf('\r') >= 0 || task.owner.indexOf('\n') >= 0) throw new Exception("请先登录");
        connection.setRequestProperty("Authorization", "Bearer " + task.owner); check(task); return connection;
    }
    @PluginMethod public void beginExport(PluginCall call) {
        Task task = null;
        try {
            task = create(call, java.util.UUID.randomUUID().toString());
            int size = call.getInt("size", -1); if (size < 0 || size > EXPORT_MAX) throw new Exception("导出文件超过 64 MiB 上限");
            task.expected = size;
            String mime = call.getString("mime", "application/octet-stream"); if (mime.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")) task.mime = mime;
            task.file = File.createTempFile("daynest-export-", ".part", getContext().getCacheDir());
            JSObject result = new JSObject(); result.put("id", task.id); call.resolve(result);
        } catch (Exception error) { if (task != null) clean(task); call.reject(error.getMessage()); }
    }
    @PluginMethod public void appendExport(PluginCall call) {
        try {
            Task task = tasks.get(required(call, "id")); if (task == null || task.call != null) throw new Exception("导出任务不存在"); check(task);
            String encoded = required(call, "data"); if (encoded.length() > 300000) throw new Exception("导出块过大");
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (call.getInt("offset", -1) != task.written || task.written + bytes.length > task.expected) throw new Exception("导出块顺序或大小不一致");
            try (OutputStream out = new FileOutputStream(task.file, true)) { out.write(bytes); }
            task.written += bytes.length; call.resolve();
        } catch (Exception error) { call.reject(error.getMessage()); }
    }
    @PluginMethod public void finishExport(PluginCall call) {
        Task task = tasks.get(call.getString("id", ""));
        if (task == null) { call.reject("导出任务不存在"); return; }
        task.call = call;
        try { check(task); if (task.written != task.expected) throw new Exception("导出尚未传完"); choose(task); }
        catch (Exception error) { fail(task, error.getMessage(), "EXPORT_FAILED"); }
    }
    private void choose(Task task) {
        if (!chooser.compareAndSet(null, task)) { fail(task, "另一个保存窗口尚未关闭", "BUSY"); return; }
        getActivity().runOnUiThread(() -> {
            try { check(task); Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType(task.mime); intent.putExtra(Intent.EXTRA_TITLE, task.name); startActivityForResult(task.call, intent, "saveDocument"); }
            catch (Exception error) { chooser.compareAndSet(task, null); fail(task, error.getMessage(), "EXPORT_FAILED"); }
        });
    }
    @ActivityCallback private void saveDocument(PluginCall call, ActivityResult result) {
        Task task = chooser.getAndSet(null); if (task == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { fail(task, "已取消保存", "CANCELLED"); return; }
        Uri uri = result.getData().getData();
        execute(task, () -> {
            try (InputStream input = new FileInputStream(task.file); OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new Exception("无法写入所选位置");
                byte[] buffer = new byte[65536]; int count;
                while ((count = input.read(buffer)) != -1) { check(task); output.write(buffer, 0, count); }
                output.flush(); check(task);
                if (task.settled.compareAndSet(false, true)) { JSObject out = new JSObject(); out.put("saved", true); task.call.resolve(out); }
            } catch (Exception error) { fail(task, "保存未完成，请核对所选文件：" + error.getMessage(), "SAVE_FAILED"); }
            finally { clean(task); }
        });
    }
    @PluginMethod public void download(PluginCall call) {
        Task task = null;
        try {
            String path = required(call, "path");
            if (!path.matches("/api/v1/exports/(data|learning\\.csv|planner\\.ics)(\\?[^#]*)?") && !path.matches("/api/v1/transfers/[A-Za-z0-9_-]{8,80}/content")) throw new Exception("不支持的下载接口");
            task = create(call, required(call, "id")); task.call = call;
            task.expected = call.getInt("expectedSize", -1);
            if (task.expected < -1 || task.expected > EXPORT_MAX) throw new Exception("文件大小无效");
            Task operation = task; execute(operation, () -> downloadFile(operation, path));
        } catch (Exception error) { if (task != null) clean(task); call.reject(error.getMessage()); }
    }
    private void downloadFile(Task task, String path) {
        try {
            HttpURLConnection connection = open(task, path, "GET");
            int status = connection.getResponseCode(); if (status != 200) throw new Exception("电脑拒绝下载（HTTP " + status + "），请检查登录或文件状态");
            String type = connection.getContentType(); if (path.startsWith("/api/v1/transfers/") && (type == null || !type.startsWith("application/octet-stream"))) throw new Exception("响应不是文件内容");
            if (connection.getContentLengthLong() > EXPORT_MAX) throw new Exception("文件超过 64 MiB 上限");
            task.file = File.createTempFile("daynest-download-", ".part", getContext().getCacheDir());
            try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(task.file)) {
                byte[] buffer = new byte[65536]; int count;
                while ((count = input.read(buffer)) != -1) { check(task); task.written += count; if (task.written > EXPORT_MAX) throw new Exception("文件超过 64 MiB 上限"); output.write(buffer, 0, count); }
            }
            connection.disconnect(); task.connection = null; check(task);
            if (task.expected >= 0 && task.written != task.expected) throw new Exception("下载大小与记录不符");
            choose(task);
        } catch (Exception error) { fail(task, error.getMessage(), task.cancelled ? "CANCELLED" : "DOWNLOAD_FAILED"); }
    }
    @PluginMethod public void upload(PluginCall call) {
        Task task;
        try { task = create(call, required(call, "id")); task.call = call; }
        catch (Exception error) { call.reject(error.getMessage()); return; }
        execute(task, () -> {
            try {
                String path = required(call, "path"), encoded = required(call, "data");
                if (!path.equals("/api/v1/transfers/" + task.id) || encoded.length() > 11200000) throw new Exception("上传路径或大小无效");
                byte[] data = Base64.decode(encoded, Base64.DEFAULT); if (data.length > UPLOAD_MAX) throw new Exception("手机版上传上限为 8 MiB");
                int ttl = call.getInt("ttl", -1); if (ttl != 0 && ttl != 24 && ttl != 168) throw new Exception("文件有效期无效");
                HttpURLConnection connection = open(task, path, "PUT"); connection.setDoOutput(true); connection.setFixedLengthStreamingMode(data.length);
                connection.setRequestProperty("Content-Type", "application/octet-stream");
                connection.setRequestProperty("X-File-Name", URLEncoder.encode(task.name, "UTF-8").replace("+", "%20")); connection.setRequestProperty("X-File-TTL", String.valueOf(ttl));
                long previous = 0;
                try (OutputStream output = connection.getOutputStream()) {
                    for (int i = 0; i < data.length; i += 65536) {
                        check(task); int count = Math.min(65536, data.length - i); output.write(data, i, count); task.written += count;
                        long now = SystemClock.elapsedRealtime(); if (now - previous > 100 || task.written == data.length) { previous = now; JSObject event = new JSObject(); event.put("id", task.id); event.put("loaded", task.written); event.put("total", data.length); notifyListeners("uploadProgress", event); }
                    }
                }
                int status = connection.getResponseCode();
                InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream();
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (input != null) try (InputStream in = input) { byte[] buffer = new byte[8192]; int count; while ((count = in.read(buffer)) != -1) { check(task); if (output.size() + count > 1024 * 1024) throw new Exception("上传响应过大，请刷新核对"); output.write(buffer, 0, count); } }
                check(task); JSObject result = new JSObject(); result.put("status", status); result.put("data", new JSONObject(output.toString(StandardCharsets.UTF_8.name())));
                if (task.settled.compareAndSet(false, true)) call.resolve(result);
            } catch (Exception error) { fail(task, error.getMessage(), task.cancelled ? "CANCELLED" : "UPLOAD_FAILED"); }
            finally { clean(task); }
        });
    }
    @Override protected void handleOnDestroy() {
        for (Task task : tasks.values()) cancelTask(task);
        workers.shutdownNow();
        super.handleOnDestroy();
    }
}
