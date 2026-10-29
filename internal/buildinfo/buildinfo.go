package buildinfo

import (
	"regexp"
	"runtime/debug"
	"strings"
	"time"
)

// These may be stamped using -ldflags; defaults make source runs explicit.
var Version = "dev"
var Commit = "unknown"
var BuiltAt = ""

type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	BuiltAt string `json:"built_at,omitempty"`
	Dirty   *bool  `json:"dirty"`
}

var commitPattern = regexp.MustCompile(`^[a-fA-F0-9]{7,64}$`)
var versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$`)

func Current() Info {
	info := Info{Version: "dev", Commit: "unknown"}
	if versionPattern.MatchString(Version) {
		info.Version = Version
	}
	if commitPattern.MatchString(Commit) {
		info.Commit = strings.ToLower(Commit)
	}
	if parsed, err := time.Parse(time.RFC3339, BuiltAt); err == nil {
		info.BuiltAt = parsed.UTC().Format(time.RFC3339)
	}
	if build, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range build.Settings {
			if setting.Key == "vcs.revision" && info.Commit == "unknown" && commitPattern.MatchString(setting.Value) {
				info.Commit = setting.Value
			}
			if setting.Key == "vcs.modified" {
				dirty := setting.Value == "true"
				info.Dirty = &dirty
			}
		}
	}
	return info
}
