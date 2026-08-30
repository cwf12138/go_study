package service

import (
	"context"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestScheduleVocabularyReviewAgainReturnsWordToLearning(t *testing.T) {
	now := time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)
	word := domain.VocabularyWord{
		Stage:        domain.VocabularyReviewing,
		EaseFactor:   2.5,
		IntervalDays: 12,
		Repetitions:  4,
	}

	got := ScheduleVocabularyReview(word, domain.RatingAgain, now)
	if got.Stage != domain.VocabularyLearning || got.Repetitions != 0 || got.IntervalDays != 0 || got.Lapses != 1 {
		t.Fatalf("unexpected again schedule: %+v", got)
	}
	if !got.DueAt.Equal(now.Add(10 * time.Minute)) {
		t.Fatalf("next due = %s, want %s", got.DueAt, now.Add(10*time.Minute))
	}
}

func TestScheduleVocabularyReviewCanReachMastered(t *testing.T) {
	now := time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)
	word := domain.VocabularyWord{
		Stage:        domain.VocabularyReviewing,
		EaseFactor:   2.5,
		IntervalDays: 10,
		Repetitions:  3,
	}

	got := ScheduleVocabularyReview(word, domain.RatingEasy, now)
	if got.Stage != domain.VocabularyMastered || got.IntervalDays < 21 {
		t.Fatalf("easy review should promote a mature word: %+v", got)
	}
	if got.LastReviewedAt == nil || !got.LastReviewedAt.Equal(now) {
		t.Fatalf("last reviewed time not recorded: %+v", got.LastReviewedAt)
	}
}

func TestVocabularyQueueEnforcesDailyNewWordLimitAcrossRefreshes(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)
	svc := New(store.NewMemory(), nil, nil)
	svc.now = func() time.Time { return now }
	book, err := svc.CreateWordBook(ctx, "learner-1", CreateWordBookInput{Name: "Go English", DailyNewLimit: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, term := range []string{"concurrency", "goroutine"} {
		if _, err := svc.CreateVocabularyWord(ctx, "learner-1", book.ID, CreateVocabularyWordInput{Term: term, Definition: term + " definition"}); err != nil {
			t.Fatal(err)
		}
	}

	queue, err := svc.VocabularyQueue(ctx, "learner-1", book.ID, 100)
	if err != nil || len(queue) != 1 {
		t.Fatalf("initial queue = %d words, err = %v; want one new word", len(queue), err)
	}
	if _, _, err := svc.ReviewVocabularyWord(ctx, "learner-1", queue[0].ID, domain.RatingGood, "flashcard"); err != nil {
		t.Fatal(err)
	}
	queue, err = svc.VocabularyQueue(ctx, "learner-1", book.ID, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(queue) != 0 {
		t.Fatalf("queue exposed %d extra new words after daily limit was reached", len(queue))
	}
}
