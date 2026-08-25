package service

import (
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func TestScheduleNextReviewProgression(t *testing.T) {
	now := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	card := domain.Card{EaseFactor: 2.5}

	card = ScheduleNextReview(card, domain.RatingGood, now)
	if card.Repetitions != 1 || card.IntervalDays != 1 {
		t.Fatalf("first review = repetitions %d, interval %d", card.Repetitions, card.IntervalDays)
	}
	card = ScheduleNextReview(card, domain.RatingGood, now.AddDate(0, 0, 1))
	if card.Repetitions != 2 || card.IntervalDays != 6 {
		t.Fatalf("second review = repetitions %d, interval %d", card.Repetitions, card.IntervalDays)
	}
	card = ScheduleNextReview(card, domain.RatingEasy, now.AddDate(0, 0, 7))
	if card.Repetitions != 3 || card.IntervalDays <= 6 {
		t.Fatalf("third review did not expand interval: %+v", card)
	}
}

func TestScheduleNextReviewAgainResetsProgress(t *testing.T) {
	now := time.Now().UTC()
	card := domain.Card{EaseFactor: 2.5, Repetitions: 8, IntervalDays: 40}
	got := ScheduleNextReview(card, domain.RatingAgain, now)
	if got.Repetitions != 0 || got.IntervalDays != 1 || !got.DueAt.Equal(now.AddDate(0, 0, 1)) {
		t.Fatalf("unexpected reset: %+v", got)
	}
}

func TestTaskTransitions(t *testing.T) {
	tests := []struct {
		from, to domain.TaskStatus
		want     bool
	}{
		{domain.TaskTodo, domain.TaskInProgress, true},
		{domain.TaskInProgress, domain.TaskDone, true},
		{domain.TaskDone, domain.TaskInProgress, false},
		{domain.TaskCancelled, domain.TaskTodo, true},
	}
	for _, test := range tests {
		if got := allowedTaskTransition(test.from, test.to); got != test.want {
			t.Errorf("allowedTaskTransition(%q, %q) = %v, want %v", test.from, test.to, got, test.want)
		}
	}
}
