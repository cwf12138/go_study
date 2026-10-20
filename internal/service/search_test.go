package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestSearchPrivacyMatchingAndDates(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	now := time.Date(2026, 10, 20, 0, 0, 0, 0, calendarLocation)
	notes := []domain.MemoNote{
		{ID: "exact", UserID: "alice", Title: "Go 日常", Content: "普通正文", Tags: []string{"复习"}, UpdatedAt: now},
		{ID: "body", UserID: "alice", Title: "笔记", Content: "学习 go 语言的日常", UpdatedAt: now.Add(time.Hour)},
		{ID: "archived", UserID: "alice", Title: "Go 日常", Archived: true, UpdatedAt: now},
		{ID: "deleted", UserID: "alice", Title: "Go 日常", DeletedAt: &now, UpdatedAt: now},
		{ID: "bob", UserID: "bob", Title: "Go 日常", Content: "PRIVATE", UpdatedAt: now},
		{ID: "yesterday", UserID: "alice", Title: "Go 日常", UpdatedAt: now.Add(-time.Second)},
	}
	for _, n := range notes {
		if e := repo.CreateMemoNote(ctx, n); e != nil {
			t.Fatal(e)
		}
	}
	if e := repo.CreateExploration(ctx, domain.Exploration{ID: "sealed", UserID: "alice", Kind: "letter", Title: "unique-secret", Body: "unique-secret", UnlockAt: now.AddDate(1, 0, 0)}); e != nil {
		t.Fatal(e)
	}
	in := SearchInput{Query: "GO 日常", Sources: []string{"memos", "memos"}, From: "2026-10-20", To: "2026-10-20"}
	got, e := s.Search(ctx, "alice", in)
	if e != nil || got.Total != 2 || len(got.Items) != 2 || got.Items[0].ID != "exact" || got.Counts["memos"] != 2 {
		t.Fatal(got, e)
	}
	if got.Items[1].MatchField != "内容" {
		t.Fatal(got.Items)
	}
	in.IncludeArchived = true
	got, e = s.Search(ctx, "alice", in)
	if e != nil || got.Total != 3 {
		t.Fatal(got, e)
	}
	got, e = s.Search(ctx, "alice", SearchInput{Query: "GO 复习", Sources: []string{"memos"}})
	if e != nil || got.Total != 1 || got.Items[0].ID != "exact" {
		t.Fatal("AND across fields", got, e)
	}
	got, e = s.Search(ctx, "alice", SearchInput{Query: "unique-secret", IncludeArchived: true})
	if e != nil || got.Total != 0 || len(got.Items) != 0 {
		t.Fatal("sealed letter leaked", got, e)
	}
	before, _ := repo.ListMemoNotes(ctx, "alice")
	_, _ = s.Search(ctx, "alice", SearchInput{Query: "go"})
	after, _ := repo.ListMemoNotes(ctx, "alice")
	if len(before) != len(after) {
		t.Fatal("read-only search wrote data")
	}
}

func TestSearchTopKAndPagination(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	now := time.Now()
	for i := 0; i < 525; i++ {
		if e := repo.CreateMemoNote(ctx, domain.MemoNote{ID: fmt.Sprintf("note-%04d", i), UserID: "alice", Title: "needle", UpdatedAt: now.Add(time.Duration(i) * time.Second)}); e != nil {
			t.Fatal(e)
		}
	}
	got, e := s.Search(ctx, "alice", SearchInput{Query: "needle", Sources: []string{"memos"}, Sort: "newest", Page: 1000, PageSize: 30})
	if e != nil || got.Total != 525 || got.Available != 500 || !got.Truncated || got.Page != 17 || len(got.Items) != 20 || got.Items[19].ID != "note-0025" {
		t.Fatal(got, e)
	}
	got, e = s.Search(ctx, "alice", SearchInput{Query: "needle", Sources: []string{"memos"}, Sort: "newest", PageSize: 1})
	if e != nil || got.Items[0].ID != "note-0524" {
		t.Fatal(got, e)
	}
}

type brokenSearchRepo struct{ store.Repository }

func (r brokenSearchRepo) ListMemoNotes(context.Context, string) ([]domain.MemoNote, error) {
	return nil, errors.New("SENSITIVE_BACKEND_DETAIL")
}
func TestSearchFailuresValidationAndCancellation(t *testing.T) {
	s := New(brokenSearchRepo{store.NewMemory()}, nil, nil)
	ctx := context.Background()
	partial, e := s.Search(ctx, "alice", SearchInput{Query: "test", Sources: []string{"memos", "todos"}})
	if e != nil || len(partial.Warnings) != 1 || partial.Warnings[0] != "memos" || partial.Total != 0 {
		t.Fatal(partial, e)
	}
	_, e = s.Search(ctx, "alice", SearchInput{Query: "test", Sources: []string{"memos"}})
	if e == nil || strings.Contains(e.Error(), "SENSITIVE") {
		t.Fatal(e)
	}
	for _, in := range []SearchInput{{}, {Query: strings.Repeat("中", 81)}, {Query: "a b c d e f g h i"}, {Query: "a\x00"}, {Query: "x", Sources: []string{"letters"}}, {Query: "x", From: "2026-02-30"}, {Query: "x", From: "2026-10-21", To: "2026-10-20"}, {Query: "x", Sort: "invalid"}, {Query: "x", Page: -1}, {Query: "x", PageSize: 31}} {
		if _, e := s.Search(ctx, "alice", in); !errors.Is(e, domain.ErrInvalidInput) {
			t.Fatal(in, e)
		}
	}
	if _, e := s.Search(ctx, "", SearchInput{Query: "x"}); !errors.Is(e, domain.ErrInvalidInput) {
		t.Fatal(e)
	}
	c, cancel := context.WithCancel(ctx)
	cancel()
	if _, e := s.Search(c, "alice", SearchInput{Query: "x"}); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	excerpt := searchExcerpt(strings.Repeat("前", 220)+"TARGET"+strings.Repeat("后", 200), []string{"target"})
	if !strings.Contains(excerpt, "TARGET") || len([]rune(excerpt)) > 182 {
		t.Fatal(excerpt)
	}
}
