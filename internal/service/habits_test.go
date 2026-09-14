package service

import (
	"context"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"testing"
	"time"
)

func TestHabitLifecycle(t *testing.T) {
	ctx := context.Background()
	s := New(store.NewMemory(), nil, nil)
	now := time.Date(2026, 9, 13, 17, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	h, err := s.CreateHabit(ctx, "alice", CreateHabitInput{Title: " 阅读 "})
	if err != nil || h.Today != "2026-09-14" || h.Title != "阅读" {
		t.Fatalf("create: %+v %v", h, err)
	}
	for _, date := range []string{"2026-09-13", "2026-09-15", "invalid"} {
		if _, err = s.CheckHabit(ctx, "alice", h.ID, date, true); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatalf("invalid date %s: %v", date, err)
		}
	}
	if _, err = s.CheckHabit(ctx, "bob", h.ID, h.Today, true); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		h, err = s.CheckHabit(ctx, "alice", h.ID, h.Today, true)
		if err != nil || h.Total != 1 {
			t.Fatalf("idempotence: %+v %v", h, err)
		}
	}
	now = now.AddDate(0, 0, 1)
	list, err := s.ListHabits(ctx, "alice")
	if err != nil || list[0].CurrentStreak != 1 {
		t.Fatalf("yesterday grace: %+v %v", list, err)
	}
	h, err = s.CheckHabit(ctx, "alice", h.ID, "2026-09-15", true)
	if err != nil || h.CurrentStreak != 2 || h.LongestStreak != 2 {
		t.Fatalf("streak %+v %v", h, err)
	}
	if _, err = s.ArchiveHabit(ctx, "alice", h.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CheckHabit(ctx, "alice", h.ID, h.Today, false); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatal(err)
	}
	if _, err = s.ArchiveHabit(ctx, "alice", h.ID, false); err != nil {
		t.Fatal(err)
	}
	h, err = s.CheckHabit(ctx, "alice", h.ID, h.Today, false)
	if err != nil || h.Total != 1 {
		t.Fatalf("undo: %+v %v", h, err)
	}
	list, err = s.ListHabits(ctx, "bob")
	if err != nil || len(list) != 0 {
		t.Fatalf("isolation %+v %v", list, err)
	}
	for _, in := range []CreateHabitInput{{Title: ""}, {Title: "x", Icon: "read|move"}, {Title: "x", TimeZone: "Local"}, {Title: "x", TimeZone: "invalid"}} {
		if _, err = s.CreateHabit(ctx, "alice", in); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatalf("validation %+v %v", in, err)
		}
	}
}

func TestHabitStreakAcrossDSTAndGaps(t *testing.T) {
	h := domain.Habit{TimeZone: "America/New_York", Checkins: []string{"2026-03-07", "2026-03-08", "2026-03-09", "2026-03-09", "invalid", "2026-03-12"}}
	v := habitView(h, time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC))
	if v.Total != 3 || v.CurrentStreak != 3 || v.LongestStreak != 3 {
		t.Fatalf("DST: %+v", v)
	}
	v = habitView(h, time.Date(2026, 3, 11, 12, 0, 0, 0, time.UTC))
	if v.CurrentStreak != 0 {
		t.Fatalf("gap: %+v", v)
	}
}
