package service

import (
	"context"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestTimePostOffice(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	now := time.Date(2026, 9, 16, 10, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	if err := repo.CreateUser(ctx, domain.User{ID: "alice", Email: "alice@example.com"}); err != nil {
		t.Fatal(err)
	}
	in := ExploreInput{ID: "test-letter-00000001", Title: "future", Body: "secret-letter-body", UnlockAt: now.Add(time.Hour)}
	e, err := s.CreateExploration(ctx, "alice", "letter", in)
	if err != nil || !e.Locked || e.Body != "" {
		t.Fatalf("sealed %+v %v", e, err)
	}
	if _, err = s.CreateExploration(ctx, "alice", "letter", in); err != nil {
		t.Fatal(err)
	}
	items, _ := s.ListExplorations(ctx, "alice")
	if len(items) != 1 || items[0].Body != "" {
		t.Fatal(items)
	}
	other, _ := s.ListExplorations(ctx, "bob")
	if len(other) != 0 {
		t.Fatal(other)
	}
	if _, err = s.CompleteExploration(ctx, "bob", in.ID, ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err = s.CompleteExploration(ctx, "alice", in.ID, ""); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatal(err)
	}
	bundle, err := s.ExportUserData(ctx, "alice")
	if err != nil || len(bundle.Explorations) != 1 || bundle.Explorations[0].Body != "" {
		t.Fatalf("export %+v %v", bundle.Explorations, err)
	}
	file := filepath.Join(t.TempDir(), "snapshot.json")
	if err = repo.SaveJSON(file); err != nil {
		t.Fatal(err)
	}
	restored := store.NewMemory()
	if err = restored.LoadJSON(file); err != nil {
		t.Fatal(err)
	}
	s = New(restored, nil, nil)
	s.now = func() time.Time { return now }
	items, _ = s.ListExplorations(ctx, "alice")
	if !items[0].Locked {
		t.Fatal("restore unlocked early")
	}
	now = now.Add(time.Hour)
	items, _ = s.ListExplorations(ctx, "alice")
	if items[0].Locked || items[0].Body != in.Body {
		t.Fatal("unlock boundary", items)
	}
	in.ID = "invalid-date-000001"
	in.UnlockAt = now
	if _, err = s.CreateExploration(ctx, "alice", "letter", in); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal(err)
	}
}
func TestLifeBoxConstraintsAndIdempotency(t *testing.T) {
	s := New(store.NewMemory(), nil, nil)
	ctx := context.Background()
	in := ExploreInput{ID: "challenge-unique-0001", Minutes: 5, Budget: 0, Place: "indoor"}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e, err := s.CreateExploration(ctx, "alice", "challenge", in)
			if err != nil || e.Minutes > 5 || e.Budget != 0 || e.Place != "indoor" {
				t.Errorf("draw %+v %v", e, err)
			}
		}()
	}
	wg.Wait()
	items, _ := s.ListExplorations(ctx, "alice")
	if len(items) != 1 {
		t.Fatal(items)
	}
	e, err := s.CompleteExploration(ctx, "alice", in.ID, "a nice day")
	if err != nil || e.CompletedAt == nil {
		t.Fatal(err)
	}
	first := *e.CompletedAt
	e, err = s.CompleteExploration(ctx, "alice", in.ID, "new reflection")
	if err != nil || !e.CompletedAt.Equal(first) {
		t.Fatal("duplicate completion changed time")
	}
	in.ID = "challenge-unique-0002"
	e, err = s.CreateExploration(ctx, "alice", "challenge", in)
	if err != nil || e.Title == items[0].Title {
		t.Fatal("fresh challenge expected", e, err)
	}
}
