package backup

import (
	"bytes"
	"path/filepath"
	"testing"
)

func TestReadVerifiedSnapshotPreservesExactBytes(t *testing.T) {
	f := seed(t)
	mustCreate(t, f)
	data, report, err := ReadVerifiedSnapshot(f.pack)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, f.snapshot) || !report.ContentVerified || report.ProductionChanged {
		t.Fatal("snapshot read changed content or status")
	}
	write(t, filepath.Join(f.pack, filepath.FromSlash(primary)), []byte("changed"))
	if _, _, err := ReadVerifiedSnapshot(f.pack); err == nil {
		t.Fatal("unverified changed snapshot returned")
	}
}
