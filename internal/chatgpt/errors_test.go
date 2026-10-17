package chatgpt

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
)

func TestFailureDiagnosisWithoutSecrets(t *testing.T) {
	for _, row := range []struct{ body, contentType, format, code string }{
		{`{"error":"invalid_grant","error_description":"secret-auth-code"}`, "application/json", "json_error", "invalid_grant"},
		{`{"error":{"code":"subscription_sharing_user_not_eligible","message":"private-email@example.test"}}`, "application/json", "json_error", "subscription_sharing_user_not_eligible"},
		{`{"detail":"secret-access-token"}`, "application/json", "json_detail", ""},
		{`{"error":{"code":"secret-access-token","message":"secret-refresh-token"}}`, "application/json", "json_error", ""},
		{`<!doctype html><html>secret-access-token<script>alert(1)</script></html>`, "text/html", "html", ""},
		{"secret-access-token", "text/plain", "text", ""},
		{"", "application/json", "empty", ""},
		{strings.Repeat("x", (64<<10)+2), "text/html", "oversized", ""},
	} {
		res := response(row.body)
		res.StatusCode = 403
		res.Header.Set("Content-Type", row.contentType)
		res.Header.Set("openai-request-id", "req_safe-123")
		res.Header.Set("cf-ray", "abcdef1234567890-SIN")
		e := responseFailure(res, "token_exchange")
		if e.Format != row.format || e.Code != row.code || e.HTTPStatus != 403 || e.Stage != "token_exchange" || e.RequestID != "req_safe-123" {
			t.Fatalf("bad diagnostic: %+v", e)
		}
		serialized, _ := json.Marshal(e)
		all := e.Error() + string(serialized)
		for _, secret := range []string{"secret-auth-code", "secret-access-token", "secret-refresh-token", "private-email", "<script>", "alert(1)"} {
			if strings.Contains(all, secret) {
				t.Fatal("diagnostic leaked", secret)
			}
		}
		if !strings.Contains(e.Error(), "交换授权码失败（HTTP 403）") {
			t.Fatal(e.Error())
		}
	}
	for _, header := range []string{"sk-private-token", `<script>alert(1)</script>`, "Bearer private-token", strings.Repeat("a", 1024)} {
		if requestID(header) != "" {
			t.Fatal("unsafe request ID", header)
		}
	}
	if requestStage(issuer+"/api/accounts/oauth/token", url.Values{"grant_type": {"refresh_token"}}) != "token_refresh" || requestStage(issuer+"/.well-known/jwks.json", nil) != "identity_keys" {
		t.Fatal("stage mapping")
	}
}

func TestCallbackKeepsSafeFailureStage(t *testing.T) {
	m := New(filepath.Join(t.TempDir(), "registry.json"))
	authorization, err := m.Begin("alice")
	if err != nil {
		t.Fatal(err)
	}
	defer m.Disconnect(context.Background(), "alice")
	u, _ := url.Parse(authorization)
	callback, _ := url.Parse(u.Query().Get("redirect_uri"))
	callback.RawQuery = url.Values{"state": {u.Query().Get("state")}, "code": {"private-code"}, "client_id": {"oaiapp_test"}}.Encode()
	m.client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		res := response(`{"error":{"code":"invalid_scope","message":"private-code private-access-token"}}`)
		res.StatusCode = 403
		res.Header.Set("x-request-id", "req_callback-123")
		return res, nil
	})
	res, err := http.Get(callback.String())
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), "stage=token_exchange") || !strings.Contains(string(body), "invalid_scope") || strings.Contains(string(body), "private-code") || strings.Contains(string(body), "private-access-token") {
		t.Fatal("callback diagnosis missing or leaks", string(body))
	}
	status := m.Status("alice")
	if status.Connected || status.Pending || status.Diagnostic == nil || status.Diagnostic.Stage != "token_exchange" {
		t.Fatal("incorrect failed status", status)
	}
	if m.Status("bob").Diagnostic != nil {
		t.Fatal("cross-account diagnostic")
	}
	if _, err := m.Begin("alice"); err != nil {
		t.Fatal(err)
	}
	if m.Status("alice").Diagnostic != nil {
		t.Fatal("stale failure persisted during new attempt")
	}
}
