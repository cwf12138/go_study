package buildinfo

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildStampValidation(t *testing.T) {
	v, c, b := Version, Commit, BuiltAt
	t.Cleanup(func() { Version, Commit, BuiltAt = v, c, b })
	Version = "0.1.0-internal"
	Commit = strings.Repeat("a", 40)
	BuiltAt = "2026-10-30T10:00:00+08:00"
	info := Current()
	if info.Version != Version || info.Commit != Commit || info.BuiltAt != "2026-10-30T02:00:00Z" {
		t.Fatal(info)
	}
	Version = "token secret\nC:/private"
	Commit = "token-private"
	BuiltAt = "C:/private"
	data, _ := json.Marshal(Current())
	if strings.Contains(string(data), "private") || strings.Contains(string(data), "secret") {
		t.Fatal(string(data))
	}
}
