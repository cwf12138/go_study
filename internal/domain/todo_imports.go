package domain

import "time"

// TodoImportReceipt survives target deletion. Its fingerprint describes the
// original command, rather than the todo's current editable fields.
type TodoImportReceipt struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	RequestID     string    `json:"request_id"`
	TodoID        string    `json:"todo_id"`
	SchemaVersion int       `json:"schema_version"`
	Fingerprint   string    `json:"fingerprint"`
	CreatedAt     time.Time `json:"created_at"`
}
