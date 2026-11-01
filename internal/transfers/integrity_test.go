package transfers

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestIntegrityChecksContentAndPreservesFiles(t *testing.T) {
	ctx := context.Background()
	s := New(t.TempDir())
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	for _, id := range []string{"file-valid", "file-corrupt", "file-missing", "file-unreadable", "file-trash", "file-expired", "file-empty"} {
		body := "original"
		if id == "file-empty" {
			body = ""
		}
		ttl := 0
		if id == "file-expired" {
			ttl = 24
		}
		if _, err := s.Upload(ctx, "alice", id, id+".txt", ttl, strings.NewReader(body), int64(len(body))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Upload(ctx, "bob", "bob-private", "BOB_NAME.txt", 0, strings.NewReader("bob"), 3); err != nil {
		t.Fatal(err)
	}
	s.Action(ctx, "alice", "file-trash", "trash")
	now = now.Add(25 * time.Hour)
	meta, blob, _ := s.paths("alice", "file-corrupt")
	originalMeta, err := os.ReadFile(meta)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blob, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	} // Same size.
	_, missing, _ := s.paths("alice", "file-missing")
	if err := os.Remove(missing); err != nil {
		t.Fatal(err)
	}
	_, blocked, _ := s.paths("alice", "file-unreadable")
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(blocked, 0o700); err != nil {
		t.Fatal(err)
	}
	r, err := s.CheckIntegrity(ctx, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if r.Files != 7 || r.Verified != 4 || r.Missing != 1 || r.Mismatched != 1 || r.Unreadable != 1 || r.Changed != 0 || len(r.Issues) != 3 || r.BackupRestoreVerified || r.UnindexedFilesChecked {
		t.Fatalf("wrong check summary: %+v", r)
	}
	for _, issue := range r.Issues {
		if strings.Contains(issue.Name, "BOB") {
			t.Fatal("foreign file disclosed")
		}
	}
	after, err := os.ReadFile(meta)
	if err != nil || string(after) != string(originalMeta) {
		t.Fatal("metadata modified")
	}
	if data, _ := os.ReadFile(blob); string(data) != "tampered" {
		t.Fatal("checker repaired/deleted content")
	}
	if _, err := os.Stat(missing); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("checker recreated missing file")
	}
	if r, err := s.CheckIntegrity(ctx, "nobody"); err != nil || r.Files != 0 || len(r.Issues) != 0 {
		t.Fatal(r, err)
	}
}

func TestIntegrityBusyCancellationAndPending(t *testing.T) {
	ctx := context.Background()
	s := New(t.TempDir())
	s.checks <- struct{}{}
	if _, err := s.CheckIntegrity(ctx, "alice"); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	<-s.checks
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := s.CheckIntegrity(cancelled, "alice"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := s.Upload(ctx, "alice", "file-pending", "file.txt", 0, strings.NewReader("x"), 1); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.pending["alice:file-pending"] = true
	s.mu.Unlock()
	r, err := s.CheckIntegrity(ctx, "alice")
	if err != nil || r.Verified != 0 || r.Changed != 1 || r.PendingUploads != 1 {
		t.Fatal(r, err)
	}
	s.mu.Lock()
	delete(s.pending, "alice:file-pending")
	s.mu.Unlock()
	if r, err := s.CheckIntegrity(ctx, "alice"); err != nil || r.Verified != 1 {
		t.Fatal("slot not released", r, err)
	}
}

func TestIntegrityRejectsMetadataBeyondReadLimit(t *testing.T) {
	s := New(t.TempDir())
	ctx := context.Background()
	if _, err := s.Upload(ctx, "alice", "file-large-meta", "file.txt", 0, strings.NewReader("x"), 1); err != nil {
		t.Fatal(err)
	}
	meta, _, _ := s.paths("alice", "file-large-meta")
	data, err := os.ReadFile(meta)
	if err != nil {
		t.Fatal(err)
	}
	// A valid object followed by padding beyond LimitReader must not silently
	// hide an additional document outside the parser's visible bytes.
	data = append(data, []byte(strings.Repeat(" ", 8192)+"{}")...)
	if err := os.WriteFile(meta, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CheckIntegrity(ctx, "alice"); err == nil {
		t.Fatal("oversized metadata accepted")
	}
}
