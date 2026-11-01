package lab

import (
	"context"
	"path/filepath"
	"testing"
)

func TestCreateAndReopen(t *testing.T) {
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "lab")
	l, err := Create(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	r, err := l.Inspect(ctx)
	if err != nil {
		l.Close()
		t.Fatal(err)
	}
	if r.JournalMode != "wal" || r.ForeignKeys != 1 || r.Synchronous != 2 || r.BusyTimeoutMS != 1500 || !r.OwnerIndexUsed {
		t.Fatal("unexpected settings", r)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	l, err = Open(ctx, dir, true)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	if _, err := l.Inspect(ctx); err != nil {
		t.Fatal(err)
	}
}
