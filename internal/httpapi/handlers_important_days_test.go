package httpapi

import (
	"context"
	"encoding/json"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestImportantDaysHTTPPersistence(t *testing.T) {
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "test.json"))
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("important-days-test-secret-long-enough", "test", time.Hour)
	svc := service.New(repo, tokens, bus)
	h := NewHandler(svc, tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if r := performJSON(t, h, "GET", "/api/v1/important-days", "", nil); r.Code != 401 {
		t.Fatal(r.Code)
	}
	register := func(email string) (string, string) {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Days", "email": email, "password": "safe-password-123"})
		var a struct {
			Data struct {
				Token string
				User  domain.User
			}
		}
		if r.Code != 201 || json.Unmarshal(r.Body.Bytes(), &a) != nil {
			t.Fatal(r.Body.String())
		}
		return a.Data.Token, a.Data.User.ID
	}
	alice, user := register("days-alice@example.test")
	bob, _ := register("days-bob@example.test")
	input := map[string]any{"title": "周年", "date": "2024-02-29", "category": "anniversary", "note": "测试", "annual": true, "pinned": true, "deleted": false, "revision": 0}
	for i := 0; i < 2; i++ {
		r := performJSON(t, h, "PUT", "/api/v1/important-days/day-sample", alice, input)
		var out struct{ Data domain.ImportantDay }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || out.Data.Revision != 1 {
			t.Fatal("retry", r.Code, r.Body.String())
		}
	}
	input["title"] = "不同内容"
	if r := performJSON(t, h, "PUT", "/api/v1/important-days/day-sample", alice, input); r.Code != 409 {
		t.Fatal("conflict", r.Code)
	}
	input["revision"] = 1
	input["date"] = "2026-02-29"
	if r := performJSON(t, h, "PUT", "/api/v1/important-days/day-sample", alice, input); r.Code != 400 {
		t.Fatal("invalid date", r.Code)
	}
	input["date"] = "2024-02-29"
	input["deleted"] = true
	if r := performJSON(t, h, "PUT", "/api/v1/important-days/day-sample", alice, input); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	var list struct{ Data []domain.ImportantDay }
	r := performJSON(t, h, "GET", "/api/v1/important-days", bob, nil)
	if json.Unmarshal(r.Body.Bytes(), &list) != nil || len(list.Data) != 0 {
		t.Fatal("isolation", r.Body.String())
	}
	if r := performJSON(t, h, "PUT", "/api/v1/important-days/day-sample", bob, input); r.Code != 404 {
		t.Fatal("cross account update", r.Code)
	}
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err := repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	restored := store.NewMemory()
	if err := restored.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	items, err := restored.ListImportantDays(context.Background(), user)
	if err != nil || len(items) != 1 || !items[0].Deleted || items[0].Revision != 2 {
		t.Fatal(items, err)
	}
	bundle, err := svc.ExportUserData(context.Background(), user)
	if err != nil || bundle.Counts["important_days"] != 1 {
		t.Fatal("export", err, bundle.Counts)
	}
	for _, asset := range []string{"important-days-core.js", "important-days.js", "important-days.css"} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", "/static/"+asset, nil))
		if rr.Code != 200 {
			t.Fatal(asset, rr.Code)
		}
	}
}
