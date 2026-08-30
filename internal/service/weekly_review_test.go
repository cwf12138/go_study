package service

import (
	"context"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestWeeklyReviewComparesSameElapsedWeekdaysAndPersistsReflection(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	now := time.Date(2026, 8, 26, 18, 0, 0, 0, time.UTC) // Wednesday
	svc.now = func() time.Time { return now }

	for index, minutes := range []int{50, 40, 30} {
		ended := time.Date(2026, 8, 24+index, 12, 0, 0, 0, time.UTC)
		if err := repository.CreateFocusSession(ctx, domain.FocusSession{ID: "current-focus-" + string(rune('a'+index)), UserID: "learner", Status: domain.FocusCompleted, ActualMinutes: minutes, StartedAt: ended.Add(-time.Duration(minutes) * time.Minute), EndedAt: &ended}); err != nil {
			t.Fatal(err)
		}
		if err := repository.CreatePlanBlock(ctx, domain.StudyPlanBlock{ID: "current-plan-" + string(rune('a'+index)), UserID: "learner", Kind: domain.PlanBlockCustom, Title: "Learning", StartAt: ended.Add(-50 * time.Minute), EndAt: ended, PlannedMinutes: 50, Status: domain.PlanBlockCompleted, CreatedAt: ended, UpdatedAt: ended}); err != nil {
			t.Fatal(err)
		}
	}
	for index, minutes := range []int{20, 20} {
		ended := time.Date(2026, 8, 17+index, 12, 0, 0, 0, time.UTC)
		if err := repository.CreateFocusSession(ctx, domain.FocusSession{ID: "previous-focus-" + string(rune('a'+index)), UserID: "learner", Status: domain.FocusCompleted, ActualMinutes: minutes, StartedAt: ended.Add(-time.Duration(minutes) * time.Minute), EndedAt: &ended}); err != nil {
			t.Fatal(err)
		}
	}

	review, err := svc.WeeklyReview(ctx, "learner", "2026-08-24", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if review.WeekEnd != "2026-08-26" || review.ComparedFrom != "2026-08-17" || review.ComparedTo != "2026-08-19" {
		t.Fatalf("unexpected comparison range: %+v", review)
	}
	if review.Summary.FocusMinutes != 120 || review.Previous.FocusMinutes != 40 || review.Comparison.FocusMinutesDelta != 80 || review.Summary.ActiveDays != 3 {
		t.Fatalf("unexpected weekly summaries: current=%+v previous=%+v comparison=%+v", review.Summary, review.Previous, review.Comparison)
	}
	if len(review.Highlights) == 0 || review.ReflectionSaved {
		t.Fatalf("expected generated highlights and no reflection: %+v", review)
	}

	saved, err := svc.SaveWeeklyReflection(ctx, "learner", SaveWeeklyReflectionInput{WeekStart: "2026-08-24", Satisfaction: 4, Wins: "Finished the concurrency chapter", Lessons: "Short sessions worked", NextWeekPriorities: []string{"Build a worker pool", "Build a worker pool", "Write tests"}})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || len(saved.NextWeekPriorities) != 2 {
		t.Fatalf("unexpected saved reflection: %+v", saved)
	}
	reloaded, err := svc.WeeklyReview(ctx, "learner", "2026-08-24", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.ReflectionSaved || reloaded.Reflection.Satisfaction != 4 || reloaded.Reflection.Wins == "" {
		t.Fatalf("reflection was not attached: %+v", reloaded.Reflection)
	}
}

func TestSaveWeeklyReflectionValidatesMondayAndPriorityLimit(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC) }
	if _, err := svc.SaveWeeklyReflection(context.Background(), "learner", SaveWeeklyReflectionInput{WeekStart: "2026-08-25", Satisfaction: 4}); err == nil {
		t.Fatal("expected non-Monday week_start to fail")
	}
	if _, err := svc.SaveWeeklyReflection(context.Background(), "learner", SaveWeeklyReflectionInput{WeekStart: "2026-08-24", Satisfaction: 4, NextWeekPriorities: []string{"1", "2", "3", "4", "5", "6"}}); err == nil {
		t.Fatal("expected too many priorities to fail")
	}
}
