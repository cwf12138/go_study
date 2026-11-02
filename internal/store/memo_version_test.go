package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
)

func TestMemoConditionalWriteIsAtomic(t *testing.T) {
	ctx, repository := context.Background(), NewMemory()
	base := domain.MemoNote{ID: "memo", UserID: "owner", Content: "original", UpdatedAt: time.Unix(100, 123).UTC()}
	if err := repository.CreateMemoNote(ctx, base); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, content := range []string{"first", "second"} {
		workers.Add(1)
		go func(content string) {
			defer workers.Done()
			<-start
			note := base
			note.Content = content
			note.UpdatedAt = base.UpdatedAt.Add(time.Nanosecond)
			results <- repository.UpdateMemoNoteIfUnchanged(ctx, note, base.UpdatedAt)
		}(content)
	}
	close(start)
	workers.Wait()
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
	current, _ := repository.MemoNoteByID(ctx, base.ID)
	foreign := current
	foreign.UserID = "other"
	if err := repository.UpdateMemoNoteIfUnchanged(ctx, foreign, current.UpdatedAt); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("foreign write: %v", err)
	}
	deleted := time.Now()
	current.DeletedAt = &deleted
	if err := repository.UpdateMemoNote(ctx, current); err != nil {
		t.Fatal(err)
	}
	if err := repository.UpdateMemoNoteIfUnchanged(ctx, base, current.UpdatedAt); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("trashed write: %v", err)
	}
}
