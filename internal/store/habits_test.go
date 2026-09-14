package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestHabitConcurrentChecksAndSnapshot(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	now := time.Now()
	if err := m.CreateHabit(ctx, domain.Habit{ID: "habit", UserID: "alice", Title: "Read", TimeZone: "UTC", StartDate: "2026-09-01", Checkins: []string{}, CreatedAt: now}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 1; i <= 20; i++ {
		wg.Add(1)
		go func(day int) {
			defer wg.Done()
			for n := 0; n < 2; n++ {
				if _, err := m.SetHabitCheck(ctx, "alice", "habit", fmt.Sprintf("2026-09-%02d", day), true, now); err != nil {
					t.Error(err)
				}
			}
		}(i)
	}
	wg.Wait()
	h, err := m.HabitByID(ctx, "habit")
	if err != nil || len(h.Checkins) != 20 {
		t.Fatalf("concurrency: %+v %v", h, err)
	}
	h.Checkins[0] = "corrupted"
	h, _ = m.HabitByID(ctx, "habit")
	if h.Checkins[0] != "2026-09-01" {
		t.Fatal("slice alias")
	}
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err = m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	restored := NewMemory()
	if err = restored.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	h, err = restored.HabitByID(ctx, "habit")
	if err != nil || len(h.Checkins) != 20 || h.Title != "Read" {
		t.Fatalf("restore: %+v %v", h, err)
	}
}
