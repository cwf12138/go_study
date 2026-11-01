package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/example/studyflow/internal/store"
)

func TestCLIRequiresExplicitPathsAndRestoreApply(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source", "snapshot.json")
	if err := store.NewMemory().SaveJSON(source); err != nil {
		t.Fatal(err)
	}
	pack, restored := filepath.Join(dir, "package"), filepath.Join(dir, "restored")
	runOK := func(args ...string) {
		t.Helper()
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 0 {
			t.Fatalf("CLI code=%d: %s", code, errOut.String())
		}
		if args[len(args)-1] == "--json" {
			var data map[string]any
			if err := json.Unmarshal(out.Bytes(), &data); err != nil || data["ok"] != true {
				t.Fatal("invalid CLI JSON")
			}
		}
	}
	for _, args := range [][]string{{"create"}, {"create", "--data-file", source}, {"restore", "--input", pack}, {"verify", "unexpected"}, {"verify", "--input", pack, "--apply"}} {
		var out, errOut bytes.Buffer
		if code := run(args, &out, &errOut); code != 2 {
			t.Fatal("invalid flags accepted", args, code)
		}
	}
	runOK("create", "--data-file", source, "--output", pack, "--service-stopped", "--json")
	runOK("verify", "--input", pack, "--json")
	runOK("restore", "--input", pack, "--output", restored, "--json")
	if _, err := os.Stat(restored); !os.IsNotExist(err) {
		t.Fatal("CLI preview wrote files")
	}
	runOK("restore", "--input", pack, "--output", restored, "--apply", "--json")
	var out, errOut bytes.Buffer
	if code := run([]string{"restore", "--input", pack, "--output", restored, "--apply", "--json"}, &out, &errOut); code != 1 {
		t.Fatal("existing destination accepted")
	}
	if bytes.Contains(out.Bytes(), []byte(dir)) {
		t.Fatal("failure JSON exposed path")
	}
}
