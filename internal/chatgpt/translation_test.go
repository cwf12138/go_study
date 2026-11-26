package chatgpt

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestBigModelTranslationUsesOnlyReadingText(t *testing.T) {
	b := NewBigModel("fixture-translation-key", "")
	calls := 0
	providerText := "第一段。\n\n这是第二段。"
	b.client.Transport = mealTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var request struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if r.URL.String() != bigModelEndpoint || len(request.Messages) != 2 ||
			request.Messages[0].Content != translationInstructions || request.Messages[1].Role != "user" ||
			request.Messages[1].Content != `{"text":"First paragraph.\n\nHere is the second."}` {
			t.Fatal("unexpected provider request")
		}
		content, _ := json.Marshal(Translation{Text: providerText})
		result, _ := json.Marshal(map[string]any{"choices": []any{
			map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(content)}},
		}})
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(result)))}, nil
	})
	for _, text := range []string{" ", "1234", strings.Repeat("a", 4201)} {
		if _, err := b.TranslateReading(context.Background(), TranslationRequest{Text: text}); !errors.Is(err, ErrTranslationText) {
			t.Fatalf("expected text validation before calling provider, got %v", err)
		}
	}
	in := TranslationRequest{Text: "  First paragraph.\n\nHere is the second.  "}
	result, err := b.TranslateReading(context.Background(), in)
	if err != nil || calls != 1 || result.Text != providerText {
		t.Fatalf("translation result=%+v err=%v requests=%d", result, err, calls)
	}
	providerText = "Untranslated response"
	if _, err := b.TranslateReading(context.Background(), in); err == nil {
		t.Fatal("an untranslated response must not be presented as a Chinese translation")
	}
}

func TestLocalReadingTranslationUsesLoopback(t *testing.T) {
	before := localTranslator.Transport
	t.Cleanup(func() { localTranslator.Transport = before })
	localTranslator.Transport = mealTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "http://127.0.0.1:8094/translate" || r.Header.Get("Authorization") != "" {
			t.Fatal("unexpected local translation request")
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"translation":"安静的夜晚。"}`))}, nil
	})
	out, err := TranslateReadingLocally(context.Background(), TranslationRequest{Text: "A quiet night."})
	if err != nil || out.Text != "安静的夜晚。" {
		t.Fatalf("unexpected local translation response %+v, error %v", out, err)
	}
}
