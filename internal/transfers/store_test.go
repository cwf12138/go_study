package transfers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStoreRoundTripAndBoundaries(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s := New(root)
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	body := "hello 文件"
	put := func(data string) (File, error) {
		return s.Upload(ctx, "alice", "upload-sample", "照片 + 文档.txt", 24, strings.NewReader(data), int64(len(data)))
	}
	row, e := put(body)
	if e != nil || row.Size != int64(len(body)) || row.Missing || row.Expired {
		t.Fatal(row, e)
	}
	again, e := put(body)
	if e != nil || again.ID != row.ID || !again.CreatedAt.Equal(row.CreatedAt) {
		t.Fatal("retry", again, e)
	}
	if _, e := put("different"); !errors.Is(e, ErrConflict) {
		t.Fatal("immutable ID", e)
	}
	f, _, e := s.Open(ctx, "alice", row.ID)
	if e != nil {
		t.Fatal(e)
	}
	out, _ := io.ReadAll(f)
	f.Close()
	if string(out) != body {
		t.Fatal("content changed")
	}
	if _, _, e := s.Open(ctx, "bob", row.ID); !errors.Is(e, ErrNotFound) {
		t.Fatal("owner leak", e)
	}
	if e := s.Purge(ctx, "alice", row.ID); !errors.Is(e, ErrInvalid) {
		t.Fatal("active purge", e)
	}
	if _, e := s.Action(ctx, "alice", row.ID, "trash"); e != nil {
		t.Fatal(e)
	}
	if _, _, e := s.Open(ctx, "alice", row.ID); !errors.Is(e, ErrExpired) {
		t.Fatal(e)
	}
	if _, e := s.Action(ctx, "alice", row.ID, "restore"); e != nil {
		t.Fatal(e)
	}
	now = now.Add(25 * time.Hour)
	if _, _, e := s.Open(ctx, "alice", row.ID); !errors.Is(e, ErrExpired) {
		t.Fatal("expiry", e)
	}
	before, _ := s.List(ctx, "alice")
	if before.UsedBytes != row.Size || !before.Items[0].Expired {
		t.Fatal(before)
	}
	if _, e := s.Action(ctx, "alice", row.ID, "extend"); e != nil {
		t.Fatal(e)
	}
	copy := New(root)
	copy.now = s.now
	listing, e := copy.List(ctx, "alice")
	if e != nil || len(listing.Items) != 1 || listing.Items[0].Expired {
		t.Fatal("restart", listing, e)
	}
	if _, e := s.Action(ctx, "alice", row.ID, "trash"); e != nil {
		t.Fatal(e)
	}
	if e := s.Purge(ctx, "alice", row.ID); e != nil {
		t.Fatal(e)
	}
	listing, _ = s.List(ctx, "alice")
	if listing.UsedBytes != 0 || len(listing.Items) != 0 {
		t.Fatal(listing)
	}
}
func TestStoreRejectsUnsafeNamesAndCancelledBodies(t *testing.T) {
	s := New(t.TempDir())
	ctx := context.Background()
	for _, name := range []string{"../data", "C:\\secret", "line\nfile", "a\x00b", ".", "..", "", strings.Repeat("字", 181)} {
		if _, e := s.Upload(ctx, "alice", "safe-upload", name, 24, strings.NewReader("x"), 1); !errors.Is(e, ErrInvalid) {
			t.Fatal(name, e)
		}
	}
	for _, id := range []string{"../secret", "small", "a/bbbbbbb"} {
		if _, e := s.Upload(ctx, "alice", id, "valid.txt", 24, strings.NewReader("x"), 1); !errors.Is(e, ErrInvalid) {
			t.Fatal(id, e)
		}
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e := s.Upload(cancelled, "alice", "cancelled-one", "file", 0, strings.NewReader("some data"), 9); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if _, e := s.Upload(ctx, "alice", "wrong-size", "file", 0, strings.NewReader("data"), 8); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	row, e := s.Upload(ctx, "alice", "empty-file", "empty.txt", 0, bytes.NewReader(nil), 0)
	if e != nil || row.Size != 0 {
		t.Fatal(row, e)
	}
	dir, _ := s.dir("alice")
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".upload-") {
			t.Fatal("partial file left", entry.Name())
		}
	}
	if len(s.slots) != 0 || len(s.pending) != 0 || s.reserved["alice"] != 0 {
		t.Fatal("reservation leaked")
	}
}

type blockingReader struct {
	started chan struct{}
	release chan struct{}
}

func (r *blockingReader) Read(b []byte) (int, error) {
	select {
	case r.started <- struct{}{}:
	default:
	}
	<-r.release
	return 0, io.EOF
}
func TestStoreUploadConcurrencyAndQuota(t *testing.T) {
	s := New(t.TempDir())
	ctx := context.Background()
	done := make(chan error, 4)
	readers := []*blockingReader{}
	for i := 0; i < 4; i++ {
		r := &blockingReader{make(chan struct{}, 1), make(chan struct{})}
		readers = append(readers, r)
		go func(index int, r *blockingReader) {
			_, e := s.Upload(ctx, "alice", fmt.Sprintf("parallel-%02d", index), "file", 0, r, 0)
			done <- e
		}(i, r)
		<-r.started
	}
	if _, e := s.Upload(ctx, "bob", "upload-fifth", "file", 0, bytes.NewReader(nil), 0); !errors.Is(e, ErrBusy) {
		t.Fatal("not bounded", e)
	}
	if _, e := s.Action(ctx, "alice", "parallel-00", "trash"); !errors.Is(e, ErrBusy) {
		t.Fatal("in-flight operation", e)
	}
	for _, r := range readers {
		close(r.release)
	}
	for range readers {
		if e := <-done; e != nil {
			t.Fatal(e)
		}
	}
	quota := New(t.TempDir())
	dir, _ := quota.dir("alice")
	if e := os.MkdirAll(dir, 0700); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 8; i++ {
		size := MaxFileBytes
		if i == 7 {
			size -= 2
		}
		row := Record{ID: fmt.Sprintf("quota-file-%02d", i), UserID: "alice", Name: "reserved", Size: size, SHA256: strings.Repeat("0", 64), CreatedAt: time.Now()}
		if e := quota.write(row); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := quota.Upload(ctx, "alice", "last-2-bytes", "small", 0, strings.NewReader("ok"), 2); e != nil {
		t.Fatal("small file in remaining quota", e)
	}
	if _, e := quota.Upload(ctx, "alice", "over-quota", "small", 0, strings.NewReader("x"), 1); !errors.Is(e, ErrQuota) {
		t.Fatal(e)
	}
	// Opaque names never depend on the original filename or a user-supplied path.
	if _, e := os.Stat(filepath.Join(dir, "small")); !errors.Is(e, os.ErrNotExist) {
		t.Fatal(e)
	}
}
