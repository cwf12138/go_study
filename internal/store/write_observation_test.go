package store

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/example/studyflow/internal/domain"
)

func observedFixture(t *testing.T) (*Memory, string) {
	t.Helper()
	m := NewMemory()
	for _, id := range []string{"alice", "bob"} {
		if err := m.CreateUser(context.Background(), domain.User{ID: id, Email: id + "@example.test"}); err != nil {
			t.Fatal(err)
		}
	}
	epoch, err := m.BeginWriteObservation("alice")
	if err != nil {
		t.Fatal(err)
	}
	return m, epoch
}
func issueObserved(t *testing.T, m *Memory, user, epoch string) string {
	t.Helper()
	value, err := m.ObserveWrite(user, epoch)
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func observedState(m *Memory, user, receipt string) string {
	return m.WriteReceiptStatuses(user, []string{receipt})[0].State
}

func TestWriteReceiptCaptureBoundaryAndFailure(t *testing.T) {
	m, epoch := observedFixture(t)
	a := issueObserved(t, m, "alice", epoch)
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if state := observedState(m, "alice", a); state != "waiting_snapshot" {
		t.Fatal(state)
	}
	captured, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- m.saveJSONWithWriter(path, func(p string, data []byte) error {
			if p == path {
				close(captured)
				<-release
			}
			return writeSnapshotFile(p, data)
		})
	}()
	<-captured
	b := issueObserved(t, m, "alice", epoch)
	if observedState(m, "alice", a) != "waiting_snapshot" {
		t.Fatal("in-flight snapshot acknowledged early")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if observedState(m, "alice", a) != "snapshot_written" || observedState(m, "alice", b) != "waiting_snapshot" {
		t.Fatal("a late completion covered a write captured too late", m.WriteReceiptStatuses("alice", []string{a, b}))
	}
	blocked := filepath.Join(t.TempDir(), "not-a-directory")
	os.WriteFile(blocked, []byte("blocked"), 0600)
	if err := m.SaveJSON(filepath.Join(blocked, "snapshot.json")); err == nil {
		t.Fatal("expected disk failure")
	}
	if observedState(m, "alice", a) != "snapshot_written" || observedState(m, "alice", b) != "snapshot_failed" {
		t.Fatal("failed write advanced confirmation or erased past evidence")
	}
	if err := m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	if observedState(m, "alice", b) != "snapshot_written" {
		t.Fatal("successful retry did not confirm")
	}
	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), a) || strings.Contains(string(data), epoch) {
		t.Fatal("observation secrets entered snapshot")
	}
}

func TestWriteReceiptAccountProcessAndModelBoundaries(t *testing.T) {
	m, epoch := observedFixture(t)
	a := issueObserved(t, m, "alice", epoch)
	if observedState(m, "bob", a) != "unverifiable" {
		t.Fatal("cross-account receipt disclosed confirmation")
	}
	parts := strings.Split(a, ".")
	parts[2] = "999"
	if observedState(m, "alice", strings.Join(parts, ".")) != "unverifiable" {
		t.Fatal("forged sequence")
	}
	path := filepath.Join(t.TempDir(), "snapshot.json")
	if err := m.SaveJSON(path); err != nil {
		t.Fatal(err)
	}
	other := NewMemory()
	if err := other.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	if observedState(other, "alice", a) != "unverifiable" {
		t.Fatal("load was mistaken for proof")
	}
	if err := m.LoadJSON(path); err != nil {
		t.Fatal(err)
	}
	if observedState(m, "alice", a) != "unverifiable" {
		t.Fatal("replacement model kept old proof")
	}
	if _, err := m.ObserveWrite("alice", epoch); err == nil {
		t.Fatal("old in-flight handler joined new model")
	}
	newEpoch, err := m.BeginWriteObservation("alice")
	if err != nil || newEpoch == epoch {
		t.Fatal("model session did not change", err)
	}
	newReceipt := issueObserved(t, m, "alice", newEpoch)
	if observedState(m, "alice", newReceipt) != "waiting_snapshot" {
		t.Fatal("reloaded success confirmed new write")
	}
}
