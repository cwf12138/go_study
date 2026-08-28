package store

import (
	"context"
	"path/filepath"
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
}
