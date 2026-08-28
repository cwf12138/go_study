package service

import (
	"context"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/store"
)

func TestMoodEntriesAreUpsertedAndInsightsAreCalculated(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, security.NewTokenManager("mood-test-secret-long-enough", "test", time.Hour), nil)
	svc.now = func() time.Time { return time.Date(2026, 8, 20, 9, 0, 0, 0, time.UTC) }

	first, err := svc.SaveMoodEntry(ctx, "user-1", "2026-08-03", SaveMoodEntryInput{
		Mood: domain.MoodGreat, Note: "完成了第一版", Activities: []string{"学习", "运动"}, Tags: []string{"go"}, Stress: 2, Energy: 5,
	})
	if err != nil {
		t.Fatalf("SaveMoodEntry() error = %v", err)
	}
	updated, err := svc.SaveMoodEntry(ctx, "user-1", "2026-08-03", SaveMoodEntryInput{
		Mood: domain.MoodGood, Note: "调整后的记录", Activities: []string{"学习"}, Stress: 3, Energy: 4,
	})
	if err != nil {
		t.Fatalf("update SaveMoodEntry() error = %v", err)
	}
	if updated.ID != first.ID || updated.CreatedAt != first.CreatedAt || updated.Mood != domain.MoodGood {
		t.Fatalf("upsert did not retain the entry identity: %#v", updated)
	}
	if _, err := svc.SaveMoodEntry(ctx, "user-1", "2026-08-04", SaveMoodEntryInput{Mood: domain.MoodAwful, Activities: []string{"熬夜"}, Stress: 5, Energy: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveMoodEntry(ctx, "user-1", "2026-08-05", SaveMoodEntryInput{Mood: domain.MoodNeutral, Activities: []string{"学习"}, Stress: 3, Energy: 3}); err != nil {
		t.Fatal(err)
	}

	entries, err := svc.ListMoodEntries(ctx, "user-1", "2026-08")
	if err != nil || len(entries) != 3 {
		t.Fatalf("ListMoodEntries() = %#v, error = %v", entries, err)
	}
	insights, err := svc.MoodInsights(ctx, "user-1", "2026-08")
	if err != nil {
		t.Fatalf("MoodInsights() error = %v", err)
	}
	if insights.LoggedDays != 3 || insights.AverageMood != 2.67 || insights.LongestStreak != 3 || insights.DominantMood != domain.MoodGood {
		t.Fatalf("unexpected insights: %#v", insights)
	}
	if len(insights.TopActivities) == 0 || insights.TopActivities[0].Name != "学习" || insights.TopActivities[0].Count != 2 {
		t.Fatalf("unexpected activity insights: %#v", insights.TopActivities)
	}
	if err := svc.DeleteMoodEntry(ctx, "user-1", "2026-08-04"); err != nil {
		t.Fatalf("DeleteMoodEntry() error = %v", err)
	}
	entries, err = svc.ListMoodEntries(ctx, "user-1", "2026-08")
	if err != nil || len(entries) != 2 {
		t.Fatalf("entries after delete = %#v, error = %v", entries, err)
	}
}
