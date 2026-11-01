package datalock

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestLockExcludesSameDirectoryAndReleasesOnClose(t *testing.T) {
	dir := t.TempDir()
	first, err := Acquire(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if next, err := Acquire(filepath.Join(dir, ".")); !errors.Is(err, ErrBusy) {
		if next != nil {
			next.Close()
		}
		t.Fatalf("second lock: %v", err)
	}
	other, err := Acquire(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	other.Close()
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := Acquire(dir)
	if err != nil {
		t.Fatal(err)
	}
	next.Close()
	if _, err := os.Stat(filepath.Join(dir, ".daynest.lock")); err != nil {
		t.Fatal("lock file must remain to avoid split locks", err)
	}
}

func TestLockHelper(t *testing.T) {
	dir := os.Getenv("DAYNEST_TEST_LOCK_DIRECTORY")
	if dir == "" {
		return
	}
	l, err := Acquire(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	fmt.Println("LOCK_READY")
	time.Sleep(30 * time.Second)
}

func TestLockReleasedWhenProcessIsKilled(t *testing.T) {
	dir := t.TempDir()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestLockHelper$")
	cmd.Env = append(os.Environ(), "DAYNEST_TEST_LOCK_DIRECTORY="+dir)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	ready := make(chan bool, 1)
	go func() { scanner := bufio.NewScanner(stdout); ready <- scanner.Scan() && scanner.Text() == "LOCK_READY" }()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("child did not acquire lock")
		}
	case <-time.After(8 * time.Second):
		t.Fatal("lock helper timed out")
	}
	if l, err := Acquire(dir); !errors.Is(err, ErrBusy) {
		if l != nil {
			l.Close()
		}
		t.Fatalf("cross-process lock: %v", err)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	cmd.Wait()
	l, err := Acquire(dir)
	if err != nil {
		t.Fatal("stale lock after process termination", err)
	}
	l.Close()
}
