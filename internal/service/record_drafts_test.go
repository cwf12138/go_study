package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestRecordCreateConditionsAndStaleUpdates(t *testing.T) {
	ctx := context.Background()
	svc := New(store.NewMemory(), nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 11, 2, 12, 0, 0, 123, time.UTC) }
	if _, err := svc.PlannerPreferences(ctx, "owner"); err != nil {
		t.Fatal(err)
	}
	empty := ""
	for _, kind := range []string{"mood", "weekly"} {
		t.Run(kind, func(t *testing.T) {
			start := make(chan struct{})
			results := make(chan error, 2)
			var wg sync.WaitGroup
			for i := 0; i < 2; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					var err error
					if kind == "mood" {
						_, err = svc.SaveMoodEntry(ctx, "owner", "2026-11-02", SaveMoodEntryInput{ExpectedVersion: &empty, Mood: domain.MoodGood, Stress: 3, Energy: 3, Note: "first"})
					} else {
						_, err = svc.SaveWeeklyReflection(ctx, "owner", SaveWeeklyReflectionInput{ExpectedVersion: &empty, WeekStart: "2026-11-02", Satisfaction: 4, Wins: "first"})
					}
					results <- err
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			wins, conflicts := 0, 0
			for err := range results {
				if err == nil {
					wins++
				} else if errors.Is(err, domain.ErrInvalidState) {
					conflicts++
				} else {
					t.Fatal(err)
				}
			}
			if wins != 1 || conflicts != 1 {
				t.Fatalf("wins=%d conflicts=%d", wins, conflicts)
			}
		})
	}
	entry, _ := svc.repo.MoodEntryByDate(ctx, "owner", "2026-11-02")
	version := entry.ID + "@" + entry.UpdatedAt.Format(time.RFC3339Nano)
	input := SaveMoodEntryInput{ExpectedVersion: &version, Mood: domain.MoodGreat, Stress: 2, Energy: 4, Note: "changed"}
	updated, err := svc.SaveMoodEntry(ctx, "owner", entry.Date, input)
	if err != nil || !updated.UpdatedAt.After(entry.UpdatedAt) {
		t.Fatalf("update=%#v err=%v", updated, err)
	}
	if _, err := svc.SaveMoodEntry(ctx, "owner", entry.Date, input); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("stale write: %v", err)
	}
	if err := svc.DeleteMoodEntryWithVersion(ctx, "owner", entry.Date, &version); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("stale delete: %v", err)
	}
	newVersion := updated.ID + "@" + updated.UpdatedAt.Format(time.RFC3339Nano)
	if err := svc.DeleteMoodEntryWithVersion(ctx, "owner", entry.Date, &newVersion); err != nil {
		t.Fatal(err)
	}
	input.ExpectedVersion = &empty
	recreated, err := svc.SaveMoodEntry(ctx, "owner", entry.Date, input)
	if err != nil || recreated.ID == entry.ID {
		t.Fatalf("recreate=%#v err=%v", recreated, err)
	}
	input.ExpectedVersion = &version
	if _, err := svc.SaveMoodEntry(ctx, "owner", entry.Date, input); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("pre-deletion editor accepted: %v", err)
	}
	// A separate owner has a separate daily slot, even when the date matches.
	input.ExpectedVersion = &empty
	if _, err := svc.SaveMoodEntry(ctx, "other", entry.Date, input); err != nil {
		t.Fatal(err)
	}
	reflection, _ := svc.repo.WeeklyReflection(ctx, "owner", "2026-11-02")
	wv := reflection.ID + "@" + reflection.UpdatedAt.Format(time.RFC3339Nano)
	wi := SaveWeeklyReflectionInput{ExpectedVersion: &wv, WeekStart: reflection.WeekStart, Satisfaction: 5, Wins: "changed"}
	if _, err := svc.SaveWeeklyReflection(ctx, "owner", wi); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveWeeklyReflection(ctx, "owner", wi); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("stale reflection: %v", err)
	}
}

type recordRepositoryWithoutVersions struct{ store.Repository }

func TestRecordVersionsFailClosedAndUnicodeLimits(t *testing.T) {
	ctx := context.Background()
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	svc.now = func() time.Time { return time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC) }
	empty := ""
	bad := "malformed"
	mi := SaveMoodEntryInput{ExpectedVersion: &empty, Mood: domain.MoodNeutral, Stress: 3, Energy: 3, Note: strings.Repeat("好", 6000), Tags: []string{strings.Repeat("好", 48)}}
	if _, err := svc.SaveMoodEntry(ctx, "owner", "2026-11-02", mi); err != nil {
		t.Fatal(err)
	}
	mi.Note += "好"
	mi.ExpectedVersion = nil
	if _, err := svc.SaveMoodEntry(ctx, "owner", "2026-11-03", mi); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("oversize: %v", err)
	}
	mi.Note = "valid"
	mi.ExpectedVersion = &bad
	if _, err := svc.SaveMoodEntry(ctx, "owner", "2026-11-03", mi); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("bad version: %v", err)
	}
	wi := SaveWeeklyReflectionInput{ExpectedVersion: &empty, WeekStart: "2026-11-02", Satisfaction: 4, Wins: strings.Repeat("好", 4000), Challenges: strings.Repeat("好", 4000), Lessons: strings.Repeat("好", 4000), NextWeekPriorities: []string{strings.Repeat("读", 200)}}
	if _, err := svc.SaveWeeklyReflection(ctx, "owner", wi); err != nil {
		t.Fatal(err)
	}
	wi.ExpectedVersion = nil
	wi.Wins += "好"
	if _, err := svc.SaveWeeklyReflection(ctx, "owner", wi); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("oversize reflection: %v", err)
	}
	noCAS := New(recordRepositoryWithoutVersions{repository}, nil, nil)
	noCAS.now = svc.now
	mi.Note = "do not write"
	mi.ExpectedVersion = &empty
	if _, err := noCAS.SaveMoodEntry(ctx, "owner", "2026-11-03", mi); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("non-atomic mood fallback: %v", err)
	}
	wi.WeekStart = "2026-10-26"
	wi.Wins = "do not write"
	wi.ExpectedVersion = &empty
	if _, err := noCAS.SaveWeeklyReflection(ctx, "owner", wi); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("non-atomic reflection fallback: %v", err)
	}
	if _, err := repository.MoodEntryByDate(ctx, "owner", "2026-11-03"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unexpected write: %v", err)
	}
	if _, err := repository.WeeklyReflection(ctx, "owner", "2026-10-26"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unexpected reflection: %v", err)
	}
}
