package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestSnapshotObservationAndFailureRecovery(t *testing.T) {
	m := NewMemory()
	if m.SnapshotStatus().LastResult != "not_attempted" {
		t.Fatal(m.SnapshotStatus())
	}
	path := filepath.Join(t.TempDir(), "personal-secret-path.json")
	if err := m.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	if status := m.SnapshotStatus(); status.LoadedAt.IsZero() || !status.LoadedSnapshotAt.IsZero() || !status.LastSuccessAt.IsZero() {
		t.Fatal(status)
	}
	if err := m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	first := m.SnapshotStatus()
	if first.LastResult != "success" || first.LastSuccessAt.IsZero() || first.LastAttemptAt.IsZero() || first.InProgress {
		t.Fatal(first)
	}
	blocked := filepath.Join(t.TempDir(), "private-path-token-secret")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := m.SaveJSON(filepath.Join(blocked, "snapshot.json")); err == nil {
		t.Fatal("expected failure")
	}
	failed := m.SnapshotStatus()
	if failed.LastResult != "failure" || failed.ConsecutiveFailures != 1 || failed.LastSuccessAt != first.LastSuccessAt || failed.LastFailureAt.IsZero() || failed.InProgress {
		t.Fatal(failed)
	}
	encoded, _ := json.Marshal(failed)
	if strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), blocked) {
		t.Fatal("diagnostic leaked error or path", string(encoded))
	}
	if err := m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	if status := m.SnapshotStatus(); status.ConsecutiveFailures != 0 || status.LastResult != "success" {
		t.Fatal(status)
	}
	loaded := NewMemory()
	if err := loaded.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	if status := loaded.SnapshotStatus(); status.LoadedSnapshotAt.IsZero() || !status.LastSuccessAt.IsZero() || status.LastResult != "not_attempted" {
		t.Fatal("loading is not a save acknowledgement", status)
	}
}

func TestSnapshotObservationConcurrentReads(t *testing.T) {
	m := NewMemory()
	path := filepath.Join(t.TempDir(), "test.json")
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 50; n++ {
				m.SnapshotStatus()
			}
		}()
	}
	for i := 0; i < 5; i++ {
		if err := m.SaveJSON(path); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
}

func TestSnapshotRecoveryObservation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.json")
	m := NewMemory()
	if err := m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	if err := m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	restored := NewMemory()
	err := restored.LoadJSON(path)
	if recovery, ok := err.(*SnapshotRecoveryError); !ok || !recovery.RecoveredFromBackup {
		t.Fatal(err)
	}
	status := restored.SnapshotStatus()
	if !status.RecoveredFromBackup || status.LoadedSnapshotAt.IsZero() || !status.LastSuccessAt.IsZero() || status.LastResult != "not_attempted" {
		t.Fatal(status)
	}
}
