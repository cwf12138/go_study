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

func TestBigModelTodoSteps(t *testing.T) {
	b := NewBigModel("fixture-key", "")
	calls := 0
	b.client.Transport = mealTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		var request struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if r.URL.String() != bigModelEndpoint || len(request.Messages) != 2 ||
			request.Messages[0].Content != todoInstructions || request.Messages[1].Content != `{"title":"准备搬家"}` {
			t.Fatal("unexpected provider request")
		}
		body := `{"choices":[{"finish_reason":"stop","message":{"content":"{\"steps\":[\" 联系搬家公司 \",\"整理随身用品\"]}"}}]}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	for _, title := range []string{" ", strings.Repeat("字", 201), "one\ntwo"} {
		if _, err := b.SuggestTodoSteps(context.Background(), TodoStepRequest{Title: title}); !errors.Is(err, ErrTodoTitle) {
			t.Fatalf("expected title validation error, got %v", err)
		}
	}
	out, err := b.SuggestTodoSteps(context.Background(), TodoStepRequest{Title: " 准备搬家 "})
	if err != nil || calls != 1 || strings.Join(out.Steps, ",") != "联系搬家公司,整理随身用品" {
		t.Fatalf("unexpected steps: %+v, provider calls: %d, error: %v", out, calls, err)
	}
}

func TestRejectInvalidModelSteps(t *testing.T) {
	for _, value := range []string{
		`{"steps":[]}`,
		`{"steps":["Check"," check "]}`,
		`{"steps":["line1\nline2"]}`,
		`{"steps":[null]}`,
		`{"steps":["1","2","3","4","5","6","7"]}`,
		`{"steps":["x"]}{}`,
		`{"steps":["` + strings.Repeat("字", 121) + `"]}`,
	} {
		if _, err := decodeTodoSteps(value); err == nil {
			t.Errorf("accepted invalid model output %q", value)
		}
	}
}
