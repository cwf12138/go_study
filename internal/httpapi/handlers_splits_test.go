package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestSplitsHTTP(t *testing.T) {
	bus := event.NewBus()
	tokens := security.NewTokenManager("splits-test-secret-long-enough", "test", time.Hour)
	h := NewHandler(service.New(store.NewMemory(), tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, route := range [][2]string{{"GET", "/api/v1/splits"}, {"PUT", "/api/v1/splits/group-weekend"}} {
		if r := performJSON(t, h, route[0], route[1], "", nil); r.Code != 401 {
			t.Fatal("auth", r.Code)
		}
	}
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Split", "email": email, "password": "safe-password-123"})
		var out struct{ Data struct{ Token string } }
		if r.Code != 201 || json.Unmarshal(r.Body.Bytes(), &out) != nil {
			t.Fatal(r.Body.String())
		}
		return out.Data.Token
	}
	alice, bob := register("aa-alice@example.test"), register("aa-bob@example.test")
	input := service.SaveSplitInput{Title: "一分钱", Date: "2026-10-21", State: "open", Members: []domain.SplitMember{{ID: "member-alice", Name: "我"}, {ID: "member-bravo", Name: "朋友"}}, Expenses: []domain.SplitExpense{{ID: "expense-coffee", Title: "咖啡", Date: "2026-10-21", AmountCents: 1, PaidBy: "member-alice", Mode: "equal", Shares: []domain.SplitShare{{MemberID: "member-alice"}, {MemberID: "member-bravo"}}}}}
	for i := 0; i < 2; i++ {
		r := performJSON(t, h, "PUT", "/api/v1/splits/group-weekend", alice, input)
		var out struct{ Data domain.SplitView }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || out.Data.Revision != 1 || out.Data.Report.TotalCents != 1 || out.Data.Expenses[0].Shares[0].AmountCents != 1 || r.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	r := performJSON(t, h, "GET", "/api/v1/splits", bob, nil)
	var rows struct{ Data []domain.SplitView }
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &rows) != nil || len(rows.Data) != 0 {
		t.Fatal(r.Code, r.Body.String())
	}
	input.Revision = 1
	input.Title = "只属于 Alice"
	if r = performJSON(t, h, "PUT", "/api/v1/splits/group-weekend", bob, input); r.Code != 404 {
		t.Fatal(r.Code)
	}
	input.Title = "新标题"
	if r = performJSON(t, h, "PUT", "/api/v1/splits/group-weekend", alice, input); r.Code != 200 {
		t.Fatal(r.Code)
	}
	input.Title = "过期版本"
	if r = performJSON(t, h, "PUT", "/api/v1/splits/group-weekend", alice, input); r.Code != 409 {
		t.Fatal(r.Code, r.Body.String())
	}
	for _, raw := range []string{`{"title":"bad","report":{}}`, `{"title":"bad"} {}`, `{"title":"bad","expenses":[{"amount_cents":1.2}]}`, `null`} {
		req := httptest.NewRequest("PUT", "/api/v1/splits/group-reject", strings.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+alice)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != 400 {
			t.Fatal(raw, rr.Code)
		}
	}
	for _, path := range []string{"/static/splits.js", "/static/splits-core.js", "/static/splits.css"} {
		req := httptest.NewRequest("GET", path, nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != 404 {
			t.Fatal(path, rr.Code)
		}
	}
}
