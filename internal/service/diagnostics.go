package service

import "github.com/example/studyflow/internal/store"

// An optional observer keeps persistence diagnostics out of business contracts.
func (s *Service) SnapshotStatus() (store.SnapshotStatus, bool) {
	reporter, ok := s.repo.(interface{ SnapshotStatus() store.SnapshotStatus })
	if !ok {
		return store.SnapshotStatus{}, false
	}
	return reporter.SnapshotStatus(), true
}
