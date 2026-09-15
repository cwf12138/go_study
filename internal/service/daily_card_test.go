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

func TestDailyCardDateAndPersistence(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	now := time.Date(2026, 9, 15, 16, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, err := s.DailyCard(ctx, "alice", "")
	if err != nil || c.Date != "2026-09-16" {
		t.Fatal(c, err)
	}
	same, _ := s.DailyCard(ctx, "bob", c.Date)
	if same.Body != c.Body || same.ID == c.ID {
		t.Fatal("content stable but owner-specific IDs")
	}
	if c.Body != "" {
		t.Fatal("GET must not draw")
	}
	c, err = s.DrawDailyCard(ctx, "alice")
	if err != nil || c.Body == "" || c.SignNumber < 1 || c.SignNumber > 31 {
		t.Fatal(c, err)
	}
	repeated, err := s.DrawDailyCard(ctx, "alice")
	if err != nil || repeated.Body != c.Body {
		t.Fatal("redraw changed result", err)
	}
	before, _ := s.DailyCard(ctx, "alice", "2026-09-15")
	if before.Body != "" {
		t.Fatal("past undrawn date should be empty")
	}
	for _, date := range []string{"2026-09-17", "2025-12-31", "2026-02-30", "invalid"} {
		if _, err = s.DailyCard(ctx, "alice", date); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatalf("%s %v", date, err)
		}
	}
	reflection := "my private reflection"
	yes := true
	no := false
	if _, err = s.SaveDailyCard(ctx, "alice", c.Date, nil, &reflection); err != nil {
		t.Fatal(err)
	}
	c, err = s.SaveDailyCard(ctx, "alice", c.Date, &yes, nil)
	if err != nil || !c.Favorite || c.Reflection != reflection {
		t.Fatal(c, err)
	}
	c, err = s.SaveDailyCard(ctx, "alice", c.Date, &no, nil)
	if err != nil || c.Favorite || c.Reflection != reflection {
		t.Fatal(c, err)
	}
	other, _ := s.DailyCard(ctx, "bob", c.Date)
	if other.Reflection != "" {
		t.Fatal("account leak")
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
	again, err := s.DailyCard(ctx, "alice", c.Date)
	if err != nil || again.Reflection != reflection || again.Body != c.Body {
		t.Fatal(again, err)
	}
}

func TestConcurrentDailyDraw(t *testing.T) {
	s := New(store.NewMemory(), nil, nil)
	ctx := context.Background()
	var wg sync.WaitGroup
	results := make(chan domain.Exploration, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, err := s.DrawDailyCard(ctx, "alice")
			if err != nil {
				t.Error(err)
				return
			}
			results <- c
		}()
	}
	wg.Wait()
	close(results)
	first := ""
	for c := range results {
		if first == "" {
			first = c.Body
		}
		if c.Body != first {
			t.Fatal("concurrent draws differed")
		}
	}
	items, _ := s.repo.ListExplorations(ctx, "alice")
	if len(items) != 1 {
		t.Fatal("expected one saved draw", len(items))
	}
}
