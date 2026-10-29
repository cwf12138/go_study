package domain

import "time"

// TextClip is private to an account. Expiry hides it from the active inbox;
// it does not silently delete persisted user content.
type TextClip struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Title     string    `json:"title"`
	Text      string    `json:"text"`
	TTLHours  int       `json:"ttl_hours"`
	Pinned    bool      `json:"pinned"`
	Deleted   bool      `json:"deleted"`
	Revision  int       `json:"revision"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
