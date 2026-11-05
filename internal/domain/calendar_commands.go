package domain

import "time"

// The receipt retains only submission identity, not a second copy of the text.
// It survives event deletion so an old create command cannot resurrect a series.
type CalendarCommandReceipt struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	RequestID     string    `json:"request_id"`
	EventID       string    `json:"event_id"`
	SchemaVersion int       `json:"schema_version"`
	Fingerprint   string    `json:"fingerprint"`
	CreatedAt     time.Time `json:"created_at"`
}
