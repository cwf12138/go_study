package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/studyflow/internal/datalock"
)

func TestAPIStartupHelper(t *testing.T) {
	if os.Getenv("DAYNEST_TEST_API_STARTUP") == "1" {
		main()
	}
}

func TestStartupRefusesBusyAndIncompleteData(t *testing.T) {
	for _, mode := range []string{"busy", "incomplete"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			file := filepath.Join(dir, "snapshot.json")
			original := []byte{0, 0, 0}
			if err := os.WriteFile(file, original, 0o600); err != nil {
				t.Fatal(err)
			}
			want := ""
			if mode == "busy" {
				guard, err := datalock.Acquire(dir)
				if err != nil {
					t.Fatal(err)
				}
				defer guard.Close()
				want = "lock data directory; startup stopped"
			} else {
				if err := os.WriteFile(filepath.Join(dir, ".daynest-incomplete"), []byte("not ready"), 0o600); err != nil {
					t.Fatal(err)
				}
				want = "incomplete restore directory; startup stopped"
			}
			exe, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, exe, "-test.run=^TestAPIStartupHelper$")
			for _, e := range os.Environ() {
				if !strings.HasPrefix(e, "DATA_FILE=") && !strings.HasPrefix(e, "HTTP_ADDR=") && !strings.HasPrefix(e, "DAYNEST_TEST_API_STARTUP=") && !strings.HasPrefix(e, "JWT_SECRET=") {
					cmd.Env = append(cmd.Env, e)
				}
			}
			cmd.Env = append(cmd.Env, "DATA_FILE="+file, "HTTP_ADDR=127.0.0.1:0", "DAYNEST_TEST_API_STARTUP=1", "JWT_SECRET=isolated-api-startup-test-secret")
			out, err := cmd.CombinedOutput()
			if err == nil || !bytes.Contains(out, []byte(want)) {
				t.Fatalf("expected safe startup refusal (%s), err=%v", mode, err)
			}
			data, err := os.ReadFile(file)
			if err != nil || !bytes.Equal(data, original) {
				t.Fatal("rejected startup altered source")
			}
		})
	}
}
