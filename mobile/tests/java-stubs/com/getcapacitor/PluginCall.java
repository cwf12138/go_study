package com.getcapacitor;
public class PluginCall {
    public String getString(String key) { return null; }
    public String getString(String key, String fallback) { return fallback; }
    public Integer getInt(String key, Integer fallback) { return fallback; }
    public void resolve() {}
    public void resolve(JSObject value) {}
    public void reject(String message) {}
    public void reject(String message, String code) {}
}
