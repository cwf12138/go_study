package store

import "time"

// SnapshotStatus contains process observations only. Never add paths, errors or
// record counts here: authenticated diagnostics may be read by any account.
type SnapshotStatus struct {
	LastAttemptAt       time.Time `json:"last_attempt_at"`
	LastSuccessAt       time.Time `json:"last_success_at"`
	LastFailureAt       time.Time `json:"last_failure_at"`
	LoadedAt            time.Time `json:"loaded_at"`
	LoadedSnapshotAt    time.Time `json:"loaded_snapshot_at"`
	RecoveredFromBackup bool      `json:"recovered_from_backup"`
	InProgress          bool      `json:"in_progress"`
	LastResult          string    `json:"last_result"`
	LastDurationMS      int64     `json:"last_duration_ms"`
	ConsecutiveFailures int       `json:"consecutive_failures"`
}

func (m *Memory) SnapshotStatus() SnapshotStatus {
	m.statusMu.RLock()
	defer m.statusMu.RUnlock()
	status := m.snapshotStatus
	if status.LastResult == "" {
		status.LastResult = "not_attempted"
	}
	return status
}
func (m *Memory) snapshotStarted(start time.Time) {
	m.statusMu.Lock()
	defer m.statusMu.Unlock()
	m.snapshotStatus.LastAttemptAt = start.UTC()
	m.snapshotStatus.InProgress = true
}
func (m *Memory) snapshotFinished(start time.Time, err error) {
	m.statusMu.Lock()
	defer m.statusMu.Unlock()
	s := &m.snapshotStatus
	s.InProgress = false
	s.LastDurationMS = time.Since(start).Milliseconds()
	if err != nil {
		s.LastResult = "failure"
		s.LastFailureAt = time.Now().UTC()
		s.ConsecutiveFailures++
	} else {
		s.LastResult = "success"
		s.LastSuccessAt = time.Now().UTC()
		s.ConsecutiveFailures = 0
	}
}
func (m *Memory) snapshotLoaded(saved time.Time, recovered bool) {
	m.statusMu.Lock()
	defer m.statusMu.Unlock()
	m.snapshotStatus.LoadedAt = time.Now().UTC()
	m.snapshotStatus.LoadedSnapshotAt = saved
	m.snapshotStatus.RecoveredFromBackup = recovered
}
