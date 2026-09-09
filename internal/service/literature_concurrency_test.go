package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestLiteratureConcurrentWritesPreserveAllFields(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	ctx := context.Background()
	reading, err := svc.AddEBook(ctx, "reader", curatedEBooks()[0])
	if err != nil {
		t.Fatal(err)
	}
	const count = 40
	var group sync.WaitGroup
	for i := 0; i < count; i++ {
		group.Add(3)
		go func(page int) {
			defer group.Done()
			if _, err := svc.AddEBookNote(ctx, "reader", reading.ID, page, fmt.Sprintf("Note %d", page)); err != nil {
				t.Error(err)
			}
		}(i)
		go func(page int) {
			defer group.Done()
			if _, err := svc.AddEBookBookmark(ctx, "reader", reading.ID, page, "Chapter", "Excerpt"); err != nil {
				t.Error(err)
			}
		}(i)
		go func() {
			defer group.Done()
			if _, err := svc.UpdateEBookProgress(ctx, "reader", reading.ID, UpdateEBookProgressInput{TotalPages: 100, PageIndex: 2, ReadingSecondsDelta: 1}); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	updated, err := svc.EBookReading(ctx, "reader", reading.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Notes) != count || len(updated.Bookmarks) != count || updated.ReadingSeconds != count {
		t.Fatalf("lost concurrent update: notes=%d bookmarks=%d seconds=%d", len(updated.Notes), len(updated.Bookmarks), updated.ReadingSeconds)
	}
}

func TestLiteratureConcurrentAddAndBookmarkDeduplication(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	ctx := context.Background()
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := svc.AddEBook(ctx, "reader", curatedEBooks()[0]); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	items, err := svc.ListEBookReadings(ctx, "reader")
	if err != nil || len(items) != 1 {
		t.Fatalf("duplicate shelf entries: %d %v", len(items), err)
	}
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := svc.AddEBookBookmark(ctx, "reader", items[0].ID, 0, "Opening", ""); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	reading, err := svc.EBookReading(ctx, "reader", items[0].ID)
	if err != nil || len(reading.Bookmarks) != 1 {
		t.Fatalf("duplicate bookmarks: %d %v", len(reading.Bookmarks), err)
	}
}

func TestUpdateEBookNotePreservesIdentityAndOwnership(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	ctx := context.Background()
	reading, err := svc.AddEBook(ctx, "reader", curatedEBooks()[0])
	if err != nil {
		t.Fatal(err)
	}
	reading, err = svc.AddEBookNote(ctx, "reader", reading.ID, 3, "original")
	if err != nil {
		t.Fatal(err)
	}
	note := reading.Notes[0]
	updated, err := svc.UpdateEBookNote(ctx, "reader", reading.ID, note.ID, "corrected")
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Notes) != 1 || updated.Notes[0].Content != "corrected" || updated.Notes[0].PageIndex != 3 || !updated.Notes[0].CreatedAt.Equal(note.CreatedAt) {
		t.Fatal("note identity changed")
	}
	if _, err := svc.UpdateEBookNote(ctx, "other", reading.ID, note.ID, "bad"); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("ownership: %v", err)
	}
	if _, err := svc.UpdateEBookNote(ctx, "reader", reading.ID, note.ID, " "); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("empty note: %v", err)
	}
	if _, err := svc.UpdateEBookNote(ctx, "reader", reading.ID, "missing", "bad"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("missing note: %v", err)
	}
}
