package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func TestSnapshotRoundTripPreservesCredentialsAndData(t *testing.T) {
	ctx := context.Background()
	first := NewMemory()
	user := domain.User{ID: "u1", Email: "student@example.com", PasswordHash: "secret-hash", CreatedAt: time.Now()}
	if err := first.CreateUser(ctx, user); err != nil {
		t.Fatal(err)
	}
	if err := first.CreateTask(ctx, domain.StudyTask{ID: "t1", UserID: user.ID, Title: "Read Go blog", Tags: []string{"go"}}); err != nil {
		t.Fatal(err)
	}
	if err := first.UpsertMoodEntry(ctx, domain.MoodEntry{ID: "m1", UserID: user.ID, Date: "2026-08-29", Mood: domain.MoodGood, Note: "A steady day", Activities: []string{"study"}, Stress: 2, Energy: 4}); err != nil {
		t.Fatal(err)
	}
	if err := first.CreateCalendarEvent(ctx, domain.CalendarEvent{ID: "e1", UserID: user.ID, Title: "Review", StartAt: time.Now(), EndAt: time.Now().Add(time.Hour), RepeatRule: domain.CalendarRepeatWeekly}); err != nil {
		t.Fatal(err)
	}
	if err := first.CreateEBookReading(ctx, domain.EBookReading{ID: "reading-1", UserID: user.ID, Book: domain.EBookCatalogItem{ID: "pg-1342", Title: "Pride and Prejudice"}, Status: "reading", PageIndex: 7, Bookmarks: []domain.EBookBookmark{{ID: "bookmark-1", PageIndex: 7, Label: "Chapter III"}}}); err != nil {
		t.Fatal(err)
	}
	if err := first.UpsertClassicalStudy(ctx, domain.ClassicalStudy{ID: "classic-1", UserID: user.ID, WorkID: "tang-jing-ye-si", Favorite: true, Status: "mastered", Notes: "月光与乡愁。"}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err := first.SaveJSON(path); err != nil {
		t.Fatalf("SaveJSON() error = %v", err)
	}

	second := NewMemory()
	if err := second.LoadJSON(path); err != nil {
		t.Fatalf("LoadJSON() error = %v", err)
	}
	loaded, err := second.UserByEmail(ctx, user.Email)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.PasswordHash != user.PasswordHash {
		t.Fatalf("password hash = %q, want %q", loaded.PasswordHash, user.PasswordHash)
	}
	tasks, err := second.ListTasks(ctx, user.ID, TaskFilter{})
	if err != nil || len(tasks) != 1 || tasks[0].Title != "Read Go blog" {
		t.Fatalf("unexpected tasks: %+v, error: %v", tasks, err)
	}
	moods, err := second.ListMoodEntries(ctx, user.ID, "2026-08")
	if err != nil || len(moods) != 1 || moods[0].Note != "A steady day" {
		t.Fatalf("unexpected moods: %+v, error: %v", moods, err)
	}
	events, err := second.ListCalendarEvents(ctx, user.ID)
	if err != nil || len(events) != 1 || events[0].Title != "Review" || events[0].RepeatRule != domain.CalendarRepeatWeekly {
		t.Fatalf("unexpected calendar events: %+v, error: %v", events, err)
	}
	readings, err := second.ListEBookReadings(ctx, user.ID)
	if err != nil || len(readings) != 1 || readings[0].PageIndex != 7 || len(readings[0].Bookmarks) != 1 {
		t.Fatalf("unexpected ebook readings: %+v, error: %v", readings, err)
	}
	studies, err := second.ListClassicalStudies(ctx, user.ID)
	if err != nil || len(studies) != 1 || !studies[0].Favorite || studies[0].Status != "mastered" {
		t.Fatalf("unexpected classical studies: %+v, error: %v", studies, err)
	}
}

func TestSnapshotRecoversPreviousValidBackup(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "snapshot.json")
	first := NewMemory()
	user := domain.User{ID: "u1", Email: "reader@example.com", PasswordHash: "hash"}
	if err := first.CreateUser(ctx, user); err != nil {
		t.Fatal(err)
	}
	if err := first.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	if err := first.CreateTask(ctx, domain.StudyTask{ID: "later-task", UserID: user.ID, Title: "Later data"}); err != nil {
		t.Fatal(err)
	}
	if err := first.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, 256), 0o600); err != nil {
		t.Fatal(err)
	}

	recovered := NewMemory()
	err := recovered.LoadJSON(path)
	var recovery *SnapshotRecoveryError
	if !errors.As(err, &recovery) || !recovery.RecoveredFromBackup || recovery.QuarantinedPath == "" {
		t.Fatalf("LoadJSON() recovery = %#v, error = %v", recovery, err)
	}
	if _, err := os.Stat(recovery.QuarantinedPath); err != nil {
		t.Fatalf("quarantined snapshot: %v", err)
	}
	if _, err := recovered.UserByEmail(ctx, user.Email); err != nil {
		t.Fatalf("backup user was not recovered: %v", err)
	}
	tasks, err := recovered.ListTasks(ctx, user.ID, TaskFilter{})
	if err != nil || len(tasks) != 0 {
		t.Fatalf("backup should contain the previous generation, tasks=%+v error=%v", tasks, err)
	}
}

func TestSnapshotQuarantinesCorruptFileWithoutBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err := os.WriteFile(path, make([]byte, 64), 0o600); err != nil {
		t.Fatal(err)
	}
	memory := NewMemory()
	err := memory.LoadJSON(path)
	var recovery *SnapshotRecoveryError
	if !errors.As(err, &recovery) || recovery.RecoveredFromBackup || recovery.QuarantinedPath == "" {
		t.Fatalf("LoadJSON() recovery = %#v, error = %v", recovery, err)
	}
	if _, err := os.Stat(recovery.QuarantinedPath); err != nil {
		t.Fatalf("quarantined snapshot: %v", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("corrupt primary should have been moved, stat error=%v", err)
	}
}

func TestSnapshotDropsLegacyGenericReviewData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.json")
	legacy := `{
  "version": 1,
  "saved_at": "2026-09-03T00:00:00Z",
  "plan_blocks": [
    {"id":"legacy-review","user_id":"u1","kind":"review","title":"Review cards","start_at":"2026-09-03T09:00:00Z","end_at":"2026-09-03T09:30:00Z"},
    {"id":"kept-task","user_id":"u1","kind":"task","title":"Read Go","start_at":"2026-09-03T10:00:00Z","end_at":"2026-09-03T10:30:00Z"}
  ],
  "decks": [{"id":"deck-1","user_id":"u1","name":"Legacy"}],
  "cards": [{"id":"card-1","user_id":"u1","deck_id":"deck-1","prompt":"Question","answer":"Answer"}],
  "reviews": [{"id":"review-1","user_id":"u1","card_id":"card-1","rating":3}]
}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}

	memory := NewMemory()
	if err := memory.LoadJSON(path); err != nil {
		t.Fatalf("LoadJSON() error = %v", err)
	}
	if _, err := memory.PlanBlockByID(context.Background(), "legacy-review"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("legacy review block should be discarded, error = %v", err)
	}
	if _, err := memory.PlanBlockByID(context.Background(), "kept-task"); err != nil {
		t.Fatalf("non-review plan block should be retained: %v", err)
	}
	if err := memory.SaveJSON(path); err != nil {
		t.Fatalf("SaveJSON() error = %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, removed := range []string{`"decks"`, `"cards"`, `"reviews"`, "legacy-review"} {
		if strings.Contains(string(data), removed) {
			t.Fatalf("saved snapshot still contains removed review data %q", removed)
		}
	}
}
