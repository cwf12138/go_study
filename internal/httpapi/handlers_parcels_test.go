package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/service"
	"github.com/example/studyflow/internal/store"
)

func TestParcelsHTTPPersistence(t *testing.T) {
	t.Setenv("DATA_FILE", filepath.Join(t.TempDir(), "unused.json"))
	repo := store.NewMemory()
	bus := event.NewBus()
	tokens := security.NewTokenManager("parcel-http-tests-long-enough-secret", "test", time.Hour)
	svc := service.New(repo, tokens, bus)
	h := NewHandler(svc, tokens, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, method := range []string{"GET", "PUT"} {
		path := "/api/v1/parcels"
		if method == "PUT" {
			path += "/parcel-test"
		}
		if r := performJSON(t, h, method, path, "", nil); r.Code != 401 {
			t.Fatal("auth", r.Code)
		}
	}
	register := func(email string) (string, string) {
		r := performJSON(t, h, "POST", "/api/v1/auth/register", "", map[string]any{"name": "Parcel", "email": email, "password": "safe-password-123"})
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
	alice, user := register("parcel-alice@example.test")
	bob, _ := register("parcel-bob@example.test")
	if r := performJSON(t, h, "PUT", "/api/v1/parcels/blank-test", alice, map[string]any{"status": "ready"}); r.Code != 400 {
		t.Fatal("empty parcel", r.Code)
	}
	input := map[string]any{"title": "", "carrier": "中通", "location": "北门驿站", "pickup_code": "8-2-1234", "tracking": "", "deadline": "2026-10-27", "note": "", "status": "ready", "deleted": false, "revision": 0}
	var row domain.Parcel
	save := func() domain.Parcel {
		t.Helper()
		r := performJSON(t, h, "PUT", "/api/v1/parcels/parcel-test", alice, input)
		var out struct{ Data domain.Parcel }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &out) != nil || r.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(r.Code, r.Body.String())
		}
		return out.Data
	}
	row = save()
	if row.Revision != 1 || row.Title != "快递包裹" || !row.PickedAt.IsZero() {
		t.Fatal(row)
	}
	if r := save(); r.Revision != 1 {
		t.Fatal("immutable retry", r)
	}
	input["title"] = "另一个名称"
	if r := performJSON(t, h, "PUT", "/api/v1/parcels/parcel-test", alice, input); r.Code != 409 {
		t.Fatal("conflict", r.Code)
	}
	input["revision"] = 1
	input["status"] = "picked"
	row = save()
	if row.PickedAt.IsZero() {
		t.Fatal("missing pickup time")
	}
	retry := save()
	if !retry.PickedAt.Equal(row.PickedAt) || retry.Revision != 2 {
		t.Fatal("pickup retry changed time", retry)
	}
	input["revision"] = 2
	input["deleted"] = true
	row = save()
	if !row.Deleted || !row.PickedAt.Equal(retry.PickedAt) {
		t.Fatal("trash", row)
	}
	input["revision"] = 3
	input["deleted"] = false
	input["status"] = "ready"
	row = save()
	if !row.PickedAt.IsZero() {
		t.Fatal("undo", row)
	}
	input["revision"] = 4
	input["pickup_code"] = "bad\ncode"
	if r := performJSON(t, h, "PUT", "/api/v1/parcels/parcel-test", alice, input); r.Code != 400 {
		t.Fatal("control", r.Code)
	}
	input["pickup_code"] = "8-2-1234"
	input["deadline"] = "2026-02-29"
	if r := performJSON(t, h, "PUT", "/api/v1/parcels/parcel-test", alice, input); r.Code != 400 {
		t.Fatal("date", r.Code)
	}
	if r := performJSON(t, h, "PUT", "/api/v1/parcels/parcel-test", bob, input); r.Code != 400 {
		t.Fatal("validate before repository", r.Code)
	}
	input["deadline"] = ""
	if r := performJSON(t, h, "PUT", "/api/v1/parcels/parcel-test", bob, input); r.Code != 404 {
		t.Fatal("ownership", r.Code)
	}
	r := performJSON(t, h, "GET", "/api/v1/parcels", bob, nil)
	var list struct{ Data []domain.Parcel }
	if json.Unmarshal(r.Body.Bytes(), &list) != nil || len(list.Data) != 0 || strings.Contains(r.Body.String(), "8-2-1234") {
		t.Fatal("isolation", r.Body.String())
	}
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err := repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	restored := store.NewMemory()
	if err := restored.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	items, err := restored.ListParcels(context.Background(), user)
	if err != nil || len(items) != 1 || items[0].PickupCode != "8-2-1234" || items[0].Revision != 4 {
		t.Fatal(items, err)
	}
	bundle, err := svc.ExportUserData(context.Background(), user)
	if err != nil || bundle.Counts["parcels"] != 1 {
		t.Fatal("export", err, bundle.Counts)
	}
	for _, asset := range []string{"parcels-core.js", "parcels.js", "parcels.css"} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", "/static/"+asset, nil))
		if rr.Code != 200 {
			t.Fatal(asset, rr.Code)
		}
	}
}
