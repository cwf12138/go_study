package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestWriteObservationHTTPTruthAndScope(t *testing.T) {
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("write-status-test-secret", "test", time.Hour)
	h := NewHandler(service.New(repo, tokens, bus), tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	register := func(email string) string {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Fixture", "email": email, "password": "fixture-password-123"})
		if r.Header().Get(writeReceiptHeader) != "" {
			t.Fatal("auth got a write receipt")
		}
		var value struct {
			Data struct {
				Token string `json:"token"`
			} `json:"data"`
		}
		json.Unmarshal(r.Body.Bytes(), &value)
		return value.Data.Token
	}
	a, b := register("write-a@example.test"), register("write-b@example.test")
	created := performJSON(t, h, "POST", "/api/v1/todos", a, map[string]any{"title": "tracked", "priority": "medium"})
	receipt := created.Header().Get(writeReceiptHeader)
	if created.Code != 201 || !strings.HasPrefix(receipt, "w1.") {
		t.Fatal(created.Code, receipt, created.Body.String())
	}
	check := func(token string) string {
		r := performJSON(t, h, "POST", "/api/v1/system/write-status", token, map[string]any{"receipts": []string{receipt}})
		if r.Code != 200 || r.Header().Get(writeReceiptHeader) != "" || r.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(r.Code, r.Body.String())
		}
		var value struct {
			Data struct {
				Receipts []store.WriteReceiptStatus `json:"receipts"`
				Checking bool                       `json:"checking_triggers_write"`
			} `json:"data"`
		}
		json.Unmarshal(r.Body.Bytes(), &value)
		if value.Data.Checking || len(value.Data.Receipts) != 1 {
			t.Fatal(r.Body.String())
		}
		return value.Data.Receipts[0].State
	}
	if check(a) != "waiting_snapshot" || check(b) != "unverifiable" {
		t.Fatal("wrong initial/scope status")
	}
	if repo.SnapshotStatus().LastResult != "not_attempted" {
		t.Fatal("poll triggered disk write")
	}
	if err := repo.SaveJSON(filepath.Join(t.TempDir(), "snapshot.json")); err != nil {
		t.Fatal(err)
	}
	if check(a) != "snapshot_written" {
		t.Fatal("snapshot did not confirm")
	}
	failed := performJSON(t, h, "POST", "/api/v1/todos", a, map[string]any{"title": ""})
	if failed.Code != 400 || failed.Header().Get(writeReceiptHeader) != "" {
		t.Fatal("failed validation got a receipt")
	}
	read := performJSON(t, h, "GET", "/api/v1/todos", a, nil)
	if read.Header().Get(writeReceiptHeader) != "" {
		t.Fatal("read got a write receipt")
	}
	if r := performJSON(t, h, "POST", "/api/v1/system/write-status", "", map[string]any{"receipts": []string{receipt}}); r.Code != 401 {
		t.Fatal(r.Code)
	}
	if r := performJSON(t, h, "POST", "/api/v1/system/write-status", a, map[string]any{"receipts": make([]string, 21)}); r.Code != 400 {
		t.Fatal("unbounded batch", r.Code)
	}
	for _, body := range []map[string]any{{}, {"receipts": nil}, {"receipts": []string{strings.Repeat("x", 181)}}, {"receipts": []string{}, "unknown": true}} {
		if r := performJSON(t, h, "POST", "/api/v1/system/write-status", a, body); r.Code != 400 {
			t.Fatal("invalid status query accepted", r.Code)
		}
	}
	for _, route := range []string{"/api/v1/auth/register", "/api/v1/transfers/x", "/api/v1/data-center/transfers/check", "/api/v1/system/write-status", "/api/v1/memos-malicious"} {
		if observesWrite(route, "POST") {
			t.Fatal("out-of-scope route", route)
		}
	}
}
