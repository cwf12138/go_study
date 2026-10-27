package com.getcapacitor;
public class Plugin {
    public android.content.Context getContext() { return null; }
    public android.app.Activity getActivity() { return null; }
    public void startActivityForResult(PluginCall call, android.content.Intent intent, String callback) {}
    public void notifyListeners(String name, JSObject value) {}
    protected void handleOnDestroy() {}
}
