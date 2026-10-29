package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestTextClipExpiryRetryAndConflicts(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := New(repo, nil, nil)
	now := time.Date(2026, 10, 29, 8, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	in := SaveTextClipInput{Text: "地址\r\n第二行\t保留空白  ", TTLHours: 1}
	first, err := s.SaveTextClip(ctx, "alice", "clip-expiry", in)
	if err != nil {
		t.Fatal(err)
	}
	if first.Text != "地址\n第二行\t保留空白  " || !first.ExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatal(first)
	}
	now = now.Add(10 * time.Minute)
	again, err := s.SaveTextClip(ctx, "alice", "clip-expiry", in)
	if err != nil || again != first {
		t.Fatal("creation retry changed original", again, err)
	}
	in.Text = first.Text
	in.Revision = 1
	in.Pinned = true
	pinned, err := s.SaveTextClip(ctx, "alice", "clip-expiry", in)
	if err != nil || pinned.ExpiresAt != first.ExpiresAt {
		t.Fatal("pin silently renewed", pinned, err)
	}
	in.Text = "different"
	if _, err = s.SaveTextClip(ctx, "alice", "clip-expiry", in); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale update", err)
	}
	if err = s.PurgeTextClip(ctx, "alice", first.ID, 2); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("active purge", err)
	}
	in.Text = first.Text
	in.Revision = 2
	in.TTLHours = 24
	in.Renew = true
	now = now.Add(2 * time.Hour)
	renewed, err := s.SaveTextClip(ctx, "alice", first.ID, in)
	if err != nil || !renewed.ExpiresAt.Equal(now.Add(24*time.Hour)) {
		t.Fatal(renewed, err)
	}
	now = now.Add(3 * time.Minute)
	retry, err := s.SaveTextClip(ctx, "alice", first.ID, in)
	if err != nil || retry != renewed {
		t.Fatal("renew retry moved expiry", retry, err)
	}
	if err = s.PurgeTextClip(ctx, "bob", first.ID, 3); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("cross-account purge", err)
	}
	if _, err = s.SaveTextClip(ctx, "bob", first.ID, in); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("cross-account update", err)
	}
	now = now.Add(25 * time.Hour)
	if err = s.PurgeTextClip(ctx, "alice", first.ID, 2); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale purge", err)
	}
	if err = s.PurgeTextClip(ctx, "alice", first.ID, 3); err != nil {
		t.Fatal("expired purge", err)
	}
}

func TestTextClipValidationQuotaAndConcurrentWrites(t *testing.T) {
	ctx := context.Background()
	s := New(store.NewMemory(), nil, nil)
	for _, in := range []SaveTextClipInput{{Text: " "}, {Text: "a\x00b"}, {Title: "a\nb", Text: "ok"}, {Text: strings.Repeat("字", 12001)}, {Text: "ok", TTLHours: 2}, {Text: "ok", Revision: -1}} {
		if _, err := s.SaveTextClip(ctx, "user", "clip-invalid", in); !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatal("accepted", in.TTLHours, err)
		}
	}
	for i := 0; i < 100; i++ {
		if _, err := s.SaveTextClip(ctx, "user", fmt.Sprintf("clip-%08d", i), SaveTextClipInput{Text: "hello 🌱", TTLHours: 0}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.SaveTextClip(ctx, "user", "clip-over-quota", SaveTextClipInput{Text: "full"}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatal("quota", err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, text := range []string{"one", "two"} {
		wg.Add(1)
		go func(text string) {
			defer wg.Done()
			_, err := s.SaveTextClip(ctx, "user", "clip-00000000", SaveTextClipInput{Text: text, Revision: 1})
			results <- err
		}(text)
	}
	wg.Wait()
	close(results)
	wins, conflicts := 0, 0
	for err := range results {
		if err == nil {
			wins++
		} else if errors.Is(err, domain.ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatal(wins, conflicts)
	}
	row, err := s.SaveTextClip(ctx, "user", "clip-00000000", SaveTextClipInput{Text: "deleted", Revision: 2, Deleted: true})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.PurgeTextClip(ctx, "user", row.ID, row.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveTextClip(ctx, "user", "clip-new-space", SaveTextClipInput{Text: strings.Repeat("字", 12000)}); err != nil {
		t.Fatal("quota not released", err)
	}
}
