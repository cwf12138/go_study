package com.getcapacitor;
public class JSObject extends org.json.JSONObject {
    @Override public JSObject put(String key, Object value) {
        try { super.put(key, value); } catch (org.json.JSONException error) { throw new RuntimeException(error); }
        return this;
    }
}
