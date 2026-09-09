package service

import (
	"context"
	"errors"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"testing"
	"time"
)

func TestTimelinePaginationOwnershipAndMonthBoundary(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	// UTC Aug 31 is September 1 in UTC+8.
	at := time.Date(2026, 8, 31, 17, 0, 0, 0, time.UTC)
	for i := 0; i < 23; i++ {
		if err := repo.CreateTask(ctx, domain.StudyTask{ID: fmt.Sprintf("task-%02d", i), UserID: "one", Title: "Completed", Status: domain.TaskDone, CompletedAt: &at}); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.CreateTask(ctx, domain.StudyTask{ID: "private", UserID: "two", Title: "Private", Status: domain.TaskDone, CompletedAt: &at}); err != nil {
		t.Fatal(err)
	}
	first, err := svc.Timeline(ctx, "one", "2026-09", "", 480, 1)
	if err != nil || first.Total != 23 || len(first.Items) != 20 || first.Pages != 2 || first.ActiveDays != 1 {
		t.Fatalf("first page: %+v %v", first, err)
	}
	second, err := svc.Timeline(ctx, "one", "2026-09", "", 480, 2)
	if err != nil || len(second.Items) != 3 || second.Items[0].ID <= first.Items[19].ID {
		t.Fatalf("pagination ordering: %+v %v", second, err)
	}
	utc, err := svc.Timeline(ctx, "one", "2026-09", "", 0, 1)
	if err != nil || utc.Total != 0 {
		t.Fatalf("month boundary: %+v %v", utc, err)
	}
	filtered, err := svc.Timeline(ctx, "one", "2026-09", "focus", 480, 1)
	if err != nil || filtered.Total != 0 {
		t.Fatalf("type filter: %+v %v", filtered, err)
	}
	for _, input := range []struct {
		month, kind  string
		offset, page int
	}{{"bad", "", 0, 1}, {"2026-09", "invalid", 0, 1}, {"2026-09", "", 841, 1}, {"2026-09", "", 0, 0}} {
		if _, err := svc.Timeline(ctx, "one", input.month, input.kind, input.offset, input.page); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatalf("invalid input: %v", err)
		}
	}
}
