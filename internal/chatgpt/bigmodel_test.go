package chatgpt

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

type mealTransport func(*http.Request) (*http.Response, error)

func (f mealTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestBigModelRecommendation(t *testing.T) {
	const fixtureKey = "fixture-credential.inference-test"
	const valid = `{"summary":"清淡晚餐","choices":[{"title":"鸡肉饭","order":"鸡肉饭加青菜","reason":"清淡且容易点到","budget_low":20,"budget_high":30,"channel":"delivery","flavor":"mild","portion":"hearty","vegetarian":false}]}`
	in := MealRequest{Model: defaultBigModel, Prompt: "晚餐想点外卖", Meal: "dinner", Channel: "delivery", Flavor: "mild", Hunger: "hearty", Budget: 35}
	for _, tc := range []struct {
		name, content, finish string
		status                int
		wantError             string
	}{
		{"complete", valid, "stop", 200, ""},
		{"truncated", valid, "length", 200, "没有完成"},
		{"budget", strings.Replace(valid, `"budget_high":30`, `"budget_high":40`, 1), "stop", 200, "预算"},
		{"overquoted", valid + `{}`, "stop", 200, "多余内容"},
		{"auth", "", "", 401, "未授权"},
		{"redirect", "", "", 302, "HTTP 302"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b := NewBigModel(fixtureKey, "")
			b.client.Transport = mealTransport(func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodPost || r.URL.String() != bigModelEndpoint || r.Header.Get("Authorization") != "Bearer "+fixtureKey {
					t.Fatal("unexpected provider request or authentication")
				}
				var request struct {
					Model    string              `json:"model"`
					Stream   bool                `json:"stream"`
					Format   map[string]string   `json:"response_format"`
					Messages []map[string]string `json:"messages"`
				}
				if json.NewDecoder(r.Body).Decode(&request) != nil || request.Model != defaultBigModel ||
					request.Stream || request.Format["type"] != "json_object" || len(request.Messages) != 2 ||
					request.Messages[0]["role"] != "system" || !strings.Contains(request.Messages[1]["content"], in.Prompt) {
					t.Fatal("unexpected request payload")
				}
				body, _ := json.Marshal(map[string]any{"choices": []any{
					map[string]any{"finish_reason": tc.finish, "message": map[string]string{"content": tc.content}},
				}})
				if tc.status != 200 {
					body = []byte(fixtureKey)
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(string(body))),
					Header: http.Header{"Location": {"https://example.test"}}}, nil
			})
			out, err := b.Recommend(context.Background(), in)
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) || strings.Contains(err.Error(), fixtureKey) {
					t.Fatal("expected a safe provider error")
				}
			} else if err != nil || len(out.Choices) != 1 || !strings.HasPrefix(out.Choices[0].ID, "food-ai-") {
				t.Fatal("validated recommendation not returned", err)
			}
		})
	}
}

func TestBigModelReportsSafeTransportDiagnostics(t *testing.T) {
	const sensitive = "fixture-credential.do-not-echo"
	for _, tc := range []struct {
		format string
		cause  error
	}{
		{"dns", &net.DNSError{Err: sensitive, Name: "proxy.example.test"}},
		{"tls_certificate", &tls.CertificateVerificationError{Err: errors.New(sensitive)}},
		{"tls_protocol", tls.RecordHeaderError{Msg: sensitive}},
		{"proxy_connect", &net.OpError{Op: "proxyconnect", Err: errors.New(sensitive)}},
		{"timeout", context.DeadlineExceeded},
		{"cancelled", context.Canceled},
		{"connection", errors.New(sensitive)},
	} {
		t.Run(tc.format, func(t *testing.T) {
			b := NewBigModel(sensitive, "")
			b.client.Transport = mealTransport(func(*http.Request) (*http.Response, error) {
				return nil, tc.cause
			})
			_, err := b.Recommend(context.Background(), MealRequest{Model: defaultBigModel})
			var failure *RequestFailure
			if !errors.As(err, &failure) || failure.Format != tc.format || failure.Stage != "bigmodel_inference" ||
				failure.HTTPStatus != 0 || strings.Contains(failure.Error(), sensitive) {
				t.Fatal("expected safe diagnostic for", tc.format)
			}
		})
	}
}

func TestBigModelRejectsKeyWithInternalWhitespace(t *testing.T) {
	b := NewBigModel("key-id.\nfixture", "")
	b.client.Transport = mealTransport(func(*http.Request) (*http.Response, error) {
		t.Fatal("malformed credential should be rejected before making a request")
		return nil, nil
	})
	_, err := b.Recommend(context.Background(), MealRequest{Model: defaultBigModel})
	if err == nil || !strings.Contains(err.Error(), "空格或换行") {
		t.Fatal("missing key formatting error")
	}
}
