package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"image"
	"image/png"
	"math"
	"path/filepath"
	"testing"
)

func TestKeepsakeLifecycle(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	lat, lon := 31.23, 121.47
	in := SaveKeepsakeInput{Kind: "place", Title: "河边", Story: "a story", Status: "wish", Latitude: &lat, Longitude: &lon, Date: "2027-01-01", Collection: "周末"}
	e, err := s.SaveKeepsake(ctx, "alice", "place-000000000001", in)
	if err != nil || e.Revision != 1 {
		t.Fatal(e, err)
	}
	same, err := s.SaveKeepsake(ctx, "alice", e.ID, in)
	if err != nil || same.Revision != 1 {
		t.Fatal("idempotent create", same, err)
	}
	if _, err = s.SaveKeepsake(ctx, "bob", e.ID, in); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	in.Revision = e.Revision
	in.Status = "visited"
	in.Favorite = true
	e, err = s.SaveKeepsake(ctx, "alice", e.ID, in)
	if err != nil || e.Revision != 2 {
		t.Fatal(e, err)
	}
	in.Story = "outdated edit"
	if _, err = s.SaveKeepsake(ctx, "alice", e.ID, in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale write", err)
	}
	in.Revision = 2
	in.Archived = true
	e, err = s.SaveKeepsake(ctx, "alice", e.ID, in)
	if err != nil || !e.Archived {
		t.Fatal(e, err)
	}
	in.Revision = e.Revision
	in.Archived = false
	e, err = s.SaveKeepsake(ctx, "alice", e.ID, in)
	if err != nil || e.Archived {
		t.Fatal(e, err)
	}
	*e.Latitude = 99
	items, _ := s.ListKeepsakes(ctx, "alice")
	if *items[0].Latitude != 31.23 {
		t.Fatal("coordinate alias")
	}
	others, _ := s.ListKeepsakes(ctx, "bob")
	if len(others) != 0 {
		t.Fatal("owner leak")
	}
	file := filepath.Join(t.TempDir(), "snapshot.json")
	if err = repo.SaveJSON(file); err != nil {
		t.Fatal(err)
	}
	restored := store.NewMemory()
	if err = restored.LoadJSON(file); err != nil {
		t.Fatal(err)
	}
	items, _ = restored.ListKeepsakes(ctx, "alice")
	if len(items) != 1 || items[0].Story != "outdated edit" || items[0].Revision != 4 {
		t.Fatal(items)
	}
	if err = repo.CreateUser(ctx, domain.User{ID: "alice", Email: "alice@example.com"}); err != nil {
		t.Fatal(err)
	}
	export, err := s.ExportUserData(ctx, "alice")
	if err != nil || export.Counts["keepsakes"] != 1 {
		t.Fatal(export.Counts, err)
	}
}
func TestKeepsakeValidationAndPhoto(t *testing.T) {
	ctx := context.Background()
	s := New(store.NewMemory(), nil, nil)
	in := SaveKeepsakeInput{Kind: "exhibit", Title: "Record", Category: "music"}
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	in.Photo = "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
	e, err := s.SaveKeepsake(ctx, "alice", "exhibit-00000000001", in)
	if err != nil || e.Photo != in.Photo {
		t.Fatal(e, err)
	}
	for _, photo := range []string{"javascript:alert(1)", "data:image/svg+xml;base64,aaaa", "data:image/png;base64,broken", "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(b.Bytes())} {
		in.Photo = photo
		if _, err = s.SaveKeepsake(ctx, "alice", "exhibit-invalid-0001", in); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal(photo, err)
		}
	}
	lat, lon := math.NaN(), 0.
	in = SaveKeepsakeInput{Kind: "place", Title: "Invalid", Status: "wish", Latitude: &lat, Longitude: &lon}
	if _, err = s.SaveKeepsake(ctx, "alice", "place-invalid-0001", in); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal(err)
	}
}
