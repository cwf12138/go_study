package service

import (
	"context"
	"errors"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestBookmarkLifecycle(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	svc := New(repo, nil, nil)
	in := SaveBookmarkInput{URL: " Example.com ", Note: "useful"}
	first, err := svc.SaveBookmark(ctx, "alice", "bookmark-01", in)
	if err != nil || first.URL != "https://example.com/" || first.Title != "example.com" || first.Folder != "未分类" || first.Revision != 1 {
		t.Fatal(first, err)
	}
	retry, err := svc.SaveBookmark(ctx, "alice", first.ID, in)
	if err != nil || retry != first {
		t.Fatal("idempotency", retry, err)
	}
	if _, err = svc.SaveBookmark(ctx, "alice", "bookmark-02", in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("duplicate", err)
	}
	if _, err = svc.SaveBookmark(ctx, "bob", first.ID, in); err != nil {
		t.Fatal("owner", err)
	}
	rows, _ := svc.ListBookmarks(ctx, "charlie")
	if len(rows) != 0 {
		t.Fatal("leaked data")
	}
	in.Revision = 1
	in.Read = true
	in.Pinned = true
	in.Folder = "工具"
	in.Title = "Example"
	updated, err := svc.SaveBookmark(ctx, "alice", first.ID, in)
	if err != nil || !updated.Read || !updated.Pinned || updated.CreatedAt != first.CreatedAt {
		t.Fatal(updated, err)
	}
	in.Title = "stale"
	if _, err = svc.SaveBookmark(ctx, "alice", first.ID, in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("conflict", err)
	}
	in.Revision = 2
	in.Deleted = true
	removed, err := svc.SaveBookmark(ctx, "alice", first.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "bookmarks.json")
	if err = repo.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	loaded := store.NewMemory()
	if err = loaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	rows, _ = loaded.ListBookmarks(ctx, "alice")
	if len(rows) != 1 || rows[0] != removed {
		t.Fatal("snapshot", rows)
	}
	in.Revision = 3
	in.Deleted = false
	if row, err := New(loaded, nil, nil).SaveBookmark(ctx, "alice", first.ID, in); err != nil || row.Deleted {
		t.Fatal("restore", row, err)
	}
}

func TestBookmarkValidation(t *testing.T) {
	s := New(store.NewMemory(), nil, nil)
	for _, raw := range []string{"", "javascript:alert(1)", "data:text/html,test", "file:///tmp/a", "https://u:secret@example.com", "https://", "https://exam ple.com", "https://a.com\n/a"} {
		if _, err := s.SaveBookmark(context.Background(), "u", "bookmark-01", SaveBookmarkInput{URL: raw}); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatalf("accepted %q: %v", raw, err)
		}
	}
	for _, in := range []SaveBookmarkInput{{URL: "https://example.com", Title: strings.Repeat("字", 161)}, {URL: "https://example.com", Folder: "a\nb"}, {URL: "https://example.com", Note: strings.Repeat("a", 2001)}, {URL: "https://example.com", Revision: -1}} {
		if _, err := s.SaveBookmark(context.Background(), "u", "bookmark-01", in); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal(err)
		}
	}
}

func TestBookmarkConcurrentDuplicate(t *testing.T) {
	s := New(store.NewMemory(), nil, nil)
	var wg sync.WaitGroup
	var succeeded atomic.Int32
	for _, id := range []string{"bookmark-01", "bookmark-02"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			_, err := s.SaveBookmark(context.Background(), "u", id, SaveBookmarkInput{URL: "https://example.com"})
			if err == nil {
				succeeded.Add(1)
			} else if !errors.Is(err, domain.ErrConflict) {
				t.Error(err)
			}
		}(id)
	}
	wg.Wait()
	if succeeded.Load() != 1 {
		t.Fatal(succeeded.Load())
	}
}
