package app.daynest.personal;
public class NativePolicyCheck {
    public static void main(String[] args) throws Exception {
        for (String value : new String[]{"http://192.168.1.10:8080", "http://10.0.2.2:8080", "https://example.test"}) {
            if (!DaynestFilesPlugin.validServer(value).startsWith(value)) throw new AssertionError(value);
        }
        for (String value : new String[]{"http://127.0.0.1:8080", "http://localhost:8080", "http://8.8.8.8", "http://example.test", "http://010.0.0.1", "http://192.168.001.1", "http://192.168.1.1/secret", "http://user:pass@192.168.1.1", "http://192.168.1.1:70000", "file:///etc/passwd", "https://example.test?q=1"}) {
            boolean refused = false;
            try { DaynestFilesPlugin.validServer(value); } catch (Exception expected) { refused = true; }
            if (!refused) throw new AssertionError("accepted unsafe server " + value);
        }
        System.out.println("Native bridge source/API-stub compilation and server policy checks passed; not an APK build or device test.");
    }
}
