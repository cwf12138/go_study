package httpapi

import (
	"net/http"
	"runtime"
	"time"

	"github.com/example/studyflow/internal/buildinfo"
)

type RuntimeOptions struct{ SnapshotInterval time.Duration }

func (s *Server) diagnostics(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	status, available := s.service.SnapshotStatus()
	if status.LastResult == "" {
		status.LastResult = "not_attempted"
	}
	state := "unobserved"
	if available {
		switch {
		case status.LastResult == "failure":
			state = "write_failed"
		case status.LastSuccessAt.IsZero():
			state = "awaiting_first_write"
		case now.Sub(status.LastSuccessAt) > max(3*s.snapshotInterval, time.Minute):
			state = "overdue"
		default:
			state = "recent_write"
		}
	}
	writeJSON(w, http.StatusOK, envelope{"data": envelope{
		"application": "daynest", "server_time": now, "build": buildinfo.Current(), "mobile_protocol": 1,
		"runtime":     envelope{"go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "uptime_seconds": int64(time.Since(s.started).Seconds())},
		"security":    envelope{"development_key": s.localOnlyTransfers, "ai_requires_loopback": true},
		"persistence": envelope{"mode": "periodic_json", "observed": available, "interval_seconds": s.snapshotInterval.Seconds(), "state": state, "observation": status, "response_means_immediate_disk_write": false},
		"backup":      envelope{"json_includes_transfer_files": false, "json_includes_transfer_metadata": false, "complete_backup_requires_stopped_service": true, "restore_verified": false},
	}})
}
