package service

import (
	"context"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestLearningInsightsAggregatesCrossModuleActivity(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	now := time.Date(2026, 9, 10, 20, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	goal := domain.Goal{ID: "goal-1", UserID: "learner", Title: "Master Go", Status: domain.GoalActive, CreatedAt: now.AddDate(0, 0, -20), UpdatedAt: now}
	if err := repository.CreateGoal(ctx, goal); err != nil {
		t.Fatal(err)
	}
	completedAt := time.Date(2026, 9, 8, 18, 0, 0, 0, time.UTC)
	task := domain.StudyTask{ID: "task-1", UserID: "learner", GoalID: goal.ID, Title: "Worker pool", Status: domain.TaskDone, Priority: domain.PriorityHigh, CompletedAt: &completedAt, CreatedAt: now.AddDate(0, 0, -10), UpdatedAt: completedAt}
	if err := repository.CreateTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	for index, minutes := range []int{60, 30, 45} {
		ended := time.Date(2026, 9, 8+index, 19, 0, 0, 0, time.UTC)
		session := domain.FocusSession{ID: "session-" + string(rune('a'+index)), UserID: "learner", TaskID: task.ID, PlannedMinutes: minutes, ActualMinutes: minutes, FocusedSeconds: minutes * 60, Status: domain.FocusCompleted, StartedAt: ended.Add(-time.Duration(minutes) * time.Minute), EndedAt: &ended}
		if err := repository.CreateFocusSession(ctx, session); err != nil {
			t.Fatal(err)
		}
		blockStatus := domain.PlanBlockCompleted
		var blockCompletedAt *time.Time
		if index == 2 {
			blockStatus = domain.PlanBlockPlanned
		} else {
			blockCompletedAt = &ended
		}
		if err := repository.CreatePlanBlock(ctx, domain.StudyPlanBlock{ID: "block-" + string(rune('a'+index)), UserID: "learner", Kind: domain.PlanBlockTask, SourceID: task.ID, Title: task.Title, StartAt: ended.Add(-50 * time.Minute), EndAt: ended, PlannedMinutes: 50, Status: blockStatus, CompletedAt: blockCompletedAt, CreatedAt: ended, UpdatedAt: ended}); err != nil {
			t.Fatal(err)
		}
	}
	for index, mood := range []domain.Mood{domain.MoodGreat, domain.MoodNeutral, domain.MoodLow} {
		date := time.Date(2026, 9, 8+index, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
		if err := repository.UpsertMoodEntry(ctx, domain.MoodEntry{ID: "mood-" + date, UserID: "learner", Date: date, Mood: mood, Stress: index + 1, Energy: 5 - index, CreatedAt: now, UpdatedAt: now}); err != nil {
			t.Fatal(err)
		}
	}
	card := domain.Card{ID: "card-1", UserID: "learner", DeckID: "deck-1", DueAt: now.Add(-time.Hour)}
	if err := repository.CreateCard(ctx, card); err != nil {
		t.Fatal(err)
	}
	for index, rating := range []domain.ReviewRating{domain.RatingGood, domain.RatingAgain} {
		reviewed := time.Date(2026, 9, 9+index, 12, 0, 0, 0, time.UTC)
		if err := repository.ApplyReview(ctx, card, domain.Review{ID: "review-" + string(rune('a'+index)), UserID: "learner", CardID: card.ID, Rating: rating, ReviewedAt: reviewed, NextDueAt: now.AddDate(0, 0, 1)}); err != nil {
			t.Fatal(err)
		}
	}
	word := domain.VocabularyWord{ID: "word-1", UserID: "learner", BookID: "book-1", Term: "goroutine", Stage: domain.VocabularyLearning, DueAt: now.Add(-time.Hour)}
	if err := repository.CreateVocabularyWord(ctx, word); err != nil {
		t.Fatal(err)
	}
	for index, rating := range []domain.ReviewRating{domain.RatingGood, domain.RatingEasy} {
		reviewed := time.Date(2026, 9, 9+index, 13, 0, 0, 0, time.UTC)
		if err := repository.ApplyVocabularyReview(ctx, word, domain.VocabularyReview{ID: "word-review-" + string(rune('a'+index)), UserID: "learner", WordID: word.ID, Rating: rating, ReviewedAt: reviewed, NextDueAt: now.AddDate(0, 0, 1)}); err != nil {
			t.Fatal(err)
		}
	}

	insights, err := svc.LearningInsights(ctx, "learner", 7, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if insights.Summary.TotalFocusMinutes != 135 || insights.Summary.ActiveDays != 3 || insights.Summary.LearningStreak != 3 {
		t.Fatalf("unexpected focus summary: %+v", insights.Summary)
	}
	if insights.Summary.PlanAdherence != 66.7 || insights.Summary.TasksCompleted != 1 {
		t.Fatalf("unexpected execution summary: %+v", insights.Summary)
	}
	if insights.Summary.CardReviews != 2 || insights.Summary.CardAccuracy != 50 || insights.Summary.VocabularyReviews != 2 || insights.Summary.VocabularyAccuracy != 100 {
		t.Fatalf("unexpected review summary: %+v", insights.Summary)
	}
	if len(insights.Goals) != 1 || insights.Goals[0].FocusMinutes != 135 || insights.Goals[0].CompletionRate != 100 {
		t.Fatalf("unexpected goal insights: %+v", insights.Goals)
	}
	if insights.Summary.DueCards != 1 || insights.Summary.DueVocabulary != 1 || len(insights.Recommendations) == 0 {
		t.Fatalf("backlog or recommendations missing: %+v", insights)
	}
}

func TestPearsonCorrelationHandlesPositiveNegativeAndSparseData(t *testing.T) {
	if got := pearsonCorrelation([]float64{1, 2, 3}, []float64{2, 4, 6}); got != 1 {
		t.Fatalf("positive correlation = %v, want 1", got)
	}
	if got := pearsonCorrelation([]float64{1, 2, 3}, []float64{6, 4, 2}); got != -1 {
		t.Fatalf("negative correlation = %v, want -1", got)
	}
	if got := pearsonCorrelation([]float64{1, 2}, []float64{1, 2}); got != 0 {
		t.Fatalf("sparse correlation = %v, want 0", got)
	}
}
