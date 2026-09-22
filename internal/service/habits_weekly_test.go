package service

import (
	"context"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"testing"
	"time"
)

func TestHabitWeeklyTargetAndRecentRecords(t *testing.T) {
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	h := domain.Habit{TimeZone: "Asia/Shanghai", StartDate: "2026-09-01", WeeklyTarget: 3, Checkins: []string{"2026-09-09", "2026-09-10", "2026-09-20", "2026-09-21", "2026-09-23", "2026-09-23"}}
	got := habitView(h, now)
	if got.WeekCompleted != 2 || got.RecentCompleted != 4 || got.RecentDays != 14 || got.WeeklyTarget != 3 {
		t.Fatal(got)
	}
	h.WeeklyTarget = 0
	h.StartDate = "2026-09-23"
	h.Checkins = []string{"2026-09-23"}
	got = habitView(h, now)
	if got.WeeklyTarget != 7 || got.RecentDays != 1 || got.RecentCompleted != 1 {
		t.Fatal(got)
	}
	s := New(store.NewMemory(), nil, nil)
	s.now = func() time.Time { return now }
	created, err := s.CreateHabit(context.Background(), "alice", CreateHabitInput{Title: "每周运动", WeeklyTarget: 3})
	if err != nil || created.WeeklyTarget != 3 {
		t.Fatal(created, err)
	}
	items, err := s.ListHabits(context.Background(), "alice")
	if err != nil || len(items) != 1 || items[0].WeeklyTarget != 3 {
		t.Fatal(items, err)
	}
	for _, n := range []int{-1, 8} {
		_, err = s.CreateHabit(context.Background(), "alice", CreateHabitInput{Title: "bad", WeeklyTarget: n})
		if !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal(n, err)
		}
	}
}
