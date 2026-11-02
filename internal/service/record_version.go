package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
)

// nil is the legacy unconditional behavior; an empty value requires absence.
func validateRecordVersion(value *string) error {
	if value == nil || *value == "" {
		return nil
	}
	id, timestamp, ok := strings.Cut(*value, "@")
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if !ok || id == "" || len(id) > 160 || len(*value) > 256 || err != nil || parsed.IsZero() {
		return fmt.Errorf("%w: expected_version must be empty or the last record ID@updated_at", domain.ErrInvalidInput)
	}
	return nil
}

func advanceRecordTime(previous, candidate time.Time) time.Time {
	if !candidate.After(previous) {
		return previous.Add(time.Nanosecond)
	}
	return candidate
}

func (s *Service) nextRecordTime(previous time.Time) time.Time {
	return advanceRecordTime(previous, s.now().UTC())
}
