package chatgpt

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(body string) *http.Response {
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
}
func signingKey(t *testing.T) (*rsa.PrivateKey, jwk) {
	t.Helper()
	k, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	return k, jwk{ID: "test-key", Type: "RSA", Use: "sig", Alg: "RS256", N: base64.RawURLEncoding.EncodeToString(k.N.Bytes()), E: base64.RawURLEncoding.EncodeToString(big.NewInt(int64(k.E)).Bytes())}
}
func sign(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "test-key"})
	body, _ := json.Marshal(claims)
	text := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
	hash := sha256.Sum256([]byte(text))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hash[:])
	if err != nil {
		t.Fatal(err)
	}
	return text + "." + base64.RawURLEncoding.EncodeToString(sig)
}
func TestIdentityValidation(t *testing.T) {
	key, j := signingKey(t)
	now := time.Now()
	claims := map[string]any{"iss": issuer, "sub": "account", "aud": "oaiapp_test", "nonce": "nonce", "exp": now.Add(time.Hour).Unix()}
	token := sign(t, key, claims)
	if _, err := verifyIdentity(token, "oaiapp_test", "nonce", []jwk{j}, now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []struct {
		field string
		value any
	}{{"iss", "https://evil.test"}, {"aud", "other"}, {"nonce", "wrong"}, {"sub", ""}, {"exp", now.Add(-time.Minute).Unix()}, {"nbf", now.Add(time.Hour).Unix()}, {"aud", []string{"oaiapp_test", "other"}}, {"azp", "other"}} {
		c := map[string]any{}
		for k, v := range claims {
			c[k] = v
		}
		c[change.field] = change.value
		if _, err := verifyIdentity(sign(t, key, c), "oaiapp_test", "nonce", []jwk{j}, now); err == nil {
			t.Fatalf("accepted %s", change.field)
		}
	}
	parts := strings.Split(token, ".")
	parts[1] = base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"forged"}`))
	if _, err := verifyIdentity(strings.Join(parts, "."), "oaiapp_test", "nonce", []jwk{j}, now); err == nil {
		t.Fatal("accepted forged signature")
	}
}
func TestLocalAuthorizationLifecycle(t *testing.T) {
	key, j := signingKey(t)
	file := filepath.Join(t.TempDir(), "registration.json")
	m := New(file)
	authorization, err := m.Begin("alice")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Disconnect(context.Background(), "alice") })
	u, _ := url.Parse(authorization)
	q := u.Query()
	if q.Get("client_id") != "dynamic_agent_client" || !hasScope(q.Get("scope"), "chatgpt.tokens.use.direct") || !strings.HasPrefix(q.Get("ext_agent_host_id"), "urn:uuid:") {
		t.Fatal("incorrect authorization parameters")
	}
	callback, _ := url.Parse(q.Get("redirect_uri"))
	if callback.Hostname() != "127.0.0.1" {
		t.Fatal(callback)
	}
	callback.RawQuery = url.Values{"state": {"wrong"}}.Encode()
	r, err := http.Get(callback.String())
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 400 || !m.Status("alice").Pending {
		t.Fatal("invalid state consumed login")
	}
	var calls atomic.Int32
	m.client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/api/accounts/oauth/token":
			calls.Add(1)
			r.ParseForm()
			if r.Form.Get("client_id") != "oaiapp_test" || r.Form.Get("redirect_uri") != q.Get("redirect_uri") {
				t.Error("wrong code exchange")
			}
			v := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if base64.RawURLEncoding.EncodeToString(v[:]) != q.Get("code_challenge") {
				t.Error("PKCE mismatch")
			}
			token := sign(t, key, map[string]any{"iss": issuer, "sub": "account", "email": "alice@example.test", "aud": "oaiapp_test", "nonce": q.Get("nonce"), "exp": time.Now().Add(time.Hour).Unix()})
			b, _ := json.Marshal(credentials{Access: "private-access", ID: token, Type: "Bearer", Expires: 3600, Scope: scopes})
			return response(string(b)), nil
		case "/.well-known/jwks.json":
			b, _ := json.Marshal(map[string]any{"keys": []jwk{j}})
			return response(string(b)), nil
		}
		t.Errorf("unexpected endpoint %s", r.URL.Path)
		return response(`{}`), nil
	})
	callback.RawQuery = url.Values{"state": {q.Get("state")}, "code": {"secret-code"}, "client_id": {"oaiapp_test"}}.Encode()
	r, err = http.Get(callback.String())
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if strings.Contains(string(body), "private-access") || strings.Contains(string(body), "secret-code") {
		t.Fatal("callback leaked secret")
	}
	if !m.Status("alice").Connected || m.Status("bob").Connected || calls.Load() != 1 {
		t.Fatal("incorrect isolation/status")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"private-access", "id_token", "access_token", "refresh_token", "secret-code", "alice@example.test"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("registration leaked %s", secret)
		}
	}
	host := q.Get("ext_agent_host_id")
	m.Disconnect(context.Background(), "alice")
	again, err := m.Begin("alice")
	if err != nil {
		t.Fatal(err)
	}
	next, _ := url.Parse(again)
	if next.Query().Get("client_id") != "oaiapp_test" || next.Query().Get("ext_agent_host_id") != host || next.Query().Get("agent_name_hint") != "" {
		t.Fatal("registration not reused")
	}
	m.Disconnect(context.Background(), "alice")
	restarted := New(file)
	again, err = restarted.Begin("alice")
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Disconnect(context.Background(), "alice")
	next, _ = url.Parse(again)
	if next.Query().Get("client_id") != "oaiapp_test" || next.Query().Get("ext_agent_host_id") != host || restarted.Status("alice").Connected {
		t.Fatal("restart persistence/credential lifetime")
	}
}
func TestCompletionStream(t *testing.T) {
	text, err := readCompletion(strings.NewReader("event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\ndata: {\"type\":\"response.completed\"}\n\n"))
	if err != nil || text != "hello" {
		t.Fatal(text, err)
	}
	for _, data := range []string{`data: {"type":"response.failed"}`, `data: {"type":"response.incomplete"}`, `data: {"type":"response.refusal.delta"}`, `data: {"type":"response.output_text.delta","delta":"partial"}`, `data: invalid`} {
		if _, err := readCompletion(strings.NewReader(data + "\n\n")); err == nil {
			t.Fatal("accepted", data)
		}
	}
	if _, err := readCompletion(strings.NewReader("data: {\n" + "data: \"type\":\"response.completed\"}\n\n")); err != nil {
		t.Fatal("multiline SSE", err)
	}
}
func TestRecommendationValidation(t *testing.T) {
	in := MealRequest{Model: "test", Prompt: "晚餐", Meal: "dinner", Channel: "delivery", Budget: 35, Flavor: "mild", Hunger: "hearty"}
	if ValidateRequest(in) != nil {
		t.Fatal("valid request")
	}
	raw := `{"summary":"鸡腿饭比较直接，请确认忌口和实际价格","choices":[{"title":"鸡腿饭","order":"鸡腿饭套餐，不加辣","reason":"适合吃饱的晚餐","budget_low":20,"budget_high":35,"channel":"delivery","flavor":"mild","portion":"hearty","vegetarian":false}]}`
	var out Recommendation
	json.Unmarshal([]byte(raw), &out)
	if err := validateRecommendation(&out, in); err != nil {
		t.Fatal(err)
	}
	id := out.Choices[0].ID
	if !strings.HasPrefix(id, "food-ai-") {
		t.Fatal(id)
	}
	if err := validateRecommendation(&out, in); err != nil || out.Choices[0].ID != id {
		t.Fatal("unstable IDs", err)
	}
	for _, change := range []func(*Recommendation){func(o *Recommendation) { o.Choices[0].BudgetHigh = 36 }, func(o *Recommendation) { o.Choices[0].BudgetLow = 40 }, func(o *Recommendation) { o.Choices[0].Channel = "ready" }, func(o *Recommendation) { o.Choices[0].Flavor = "spicy" }, func(o *Recommendation) { o.Choices[0].Portion = "light" }, func(o *Recommendation) { o.Choices[0].Order = "" }, func(o *Recommendation) { o.Choices = append(o.Choices, o.Choices[0]) }, func(o *Recommendation) { o.Choices[0].Title = "x\ny" }} {
		json.Unmarshal([]byte(raw), &out)
		change(&out)
		if validateRecommendation(&out, in) == nil {
			t.Fatal("invalid choice accepted")
		}
	}
	json.Unmarshal([]byte(raw), &out)
	in.Exclude = []string{"鸡腿"}
	if validateRecommendation(&out, in) == nil {
		t.Fatal("excluded food accepted")
	}
	in.Exclude = nil
	in.Vegetarian = true
	json.Unmarshal([]byte(raw), &out)
	if validateRecommendation(&out, in) == nil {
		t.Fatal("nonvegetarian accepted")
	}
	if err := validateRecommendation(&Recommendation{Summary: "没有符合条件的食物"}, in); err != nil {
		t.Fatal(err)
	}
}
func TestRefreshPermissionAndCancellation(t *testing.T) {
	m := New(filepath.Join(t.TempDir(), "reg.json"))
	s := m.get("alice")
	s.reg = registration{Client: "oaiapp_test", Subject: "alice"}
	s.cred = credentials{Access: "old", Refresh: "refresh", Scope: scopes, Until: time.Now().Add(-time.Minute)}
	m.client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/api/accounts/oauth/token" {
			r.ParseForm()
			if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("client_id") != "oaiapp_test" || r.Form.Has("scope") {
				t.Error("wrong refresh")
			}
			return response(`{"access_token":"new","refresh_token":"replacement","token_type":"Bearer","expires_in":3600,"scope":"chatgpt.tokens.use.direct resource.invoke"}`), nil
		}
		if r.Header.Get("Authorization") != "Bearer new" {
			t.Error("old credential used")
		}
		return response(`{"models":[{"slug":"eligible","display_name":"Eligible","visibility":"list"},{"slug":"hidden","visibility":"hide"}]}`), nil
	})
	rows, err := m.Models(context.Background(), "alice")
	if err != nil || len(rows) != 1 || s.cred.Refresh != "replacement" {
		t.Fatal(rows, err)
	}
	if _, err := m.Models(context.Background(), "bob"); err == nil {
		t.Fatal("cross-account access")
	}
	ctx, active, g, _, err := m.acquire(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, _, err := m.acquire(context.Background(), "alice"); err == nil {
		t.Fatal("parallel refresh allowed")
	}
	s.cred.Refresh = ""
	m.Disconnect(context.Background(), "alice")
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("disconnect did not cancel")
	}
	m.release(active, g)
	if m.Status("alice").Connected {
		t.Fatal("disconnected session revived")
	}
	s.cred = credentials{Access: "identity-only", Scope: "openid email"}
	if _, err := m.Models(context.Background(), "alice"); err == nil {
		t.Fatal("identity scope allowed inference")
	}
}
func TestCorruptRegistryAlwaysFails(t *testing.T) {
	file := filepath.Join(t.TempDir(), "reg.json")
	if err := os.WriteFile(file, []byte(`{"host_id":"urn:uuid:bad",`), 0600); err != nil {
		t.Fatal(err)
	}
	m := New(file)
	for i := 0; i < 2; i++ {
		if _, err := m.Begin("alice"); err == nil {
			t.Fatal("corrupt registry allowed sign-in")
		}
	}
}

func TestRecommendRequestContract(t *testing.T) {
	m := New(filepath.Join(t.TempDir(), "reg.json"))
	s := m.get("alice")
	s.cred = credentials{Access: "secret-access", Scope: scopes, Until: time.Now().Add(time.Hour)}
	var inference atomic.Int32
	m.client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer secret-access" {
			t.Error("missing bearer credential")
		}
		if r.URL.Path == "/v1/models" {
			return response(`{"models":[{"slug":"eligible","display_name":"Eligible","visibility":"list"}]}`), nil
		}
		inference.Add(1)
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Fatal("invalid request")
		}
		if body["store"] != false || body["stream"] != true || body["model"] != "eligible" {
			t.Error("wrong plan-usage contract")
		}
		if _, ok := body["input"].([]any); !ok {
			t.Error("input must be array")
		}
		for _, field := range []string{"temperature", "max_output_tokens", "previous_response_id"} {
			if _, ok := body[field]; ok {
				t.Errorf("unsupported field %s", field)
			}
		}
		if !strings.Contains(body["instructions"].(string), "不要菜谱") && !strings.Contains(body["instructions"].(string), "不要菜谱、备料") {
			t.Error("cooking instruction not removed")
		}
		text := `{"summary":"推荐鸡腿饭，核对忌口和实际价格","choices":[{"title":"鸡腿饭","order":"鸡腿饭套餐","reason":"不用自己做，适合吃饱","budget_low":20,"budget_high":30,"channel":"delivery","flavor":"mild","portion":"hearty","vegetarian":false}]}`
		event, _ := json.Marshal(map[string]string{"type": "response.output_text.delta", "delta": text})
		res := response("data: " + string(event) + "\n\ndata: {\"type\":\"response.completed\"}\n\n")
		res.Header.Set("Content-Type", "text/event-stream")
		return res, nil
	})
	in := MealRequest{Model: "eligible", Prompt: "晚餐", Meal: "dinner", Channel: "delivery", Budget: 35, Flavor: "mild", Hunger: "hearty"}
	out, err := m.Recommend(context.Background(), "alice", in)
	if err != nil || len(out.Choices) != 1 || !strings.HasPrefix(out.Choices[0].ID, "food-ai-") {
		t.Fatal(out, err)
	}
	in.Model = "not-eligible"
	if _, err = m.Recommend(context.Background(), "alice", in); err == nil || inference.Load() != 1 {
		t.Fatal("unlisted model performed inference")
	}
}
