package domain

import "time"

// Bookmark stores a link, never a fetched copy of the remote page.
type Bookmark struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	URL       string    `json:"url"`
	Title     string    `json:"title"`
	Folder    string    `json:"folder"`
	Note      string    `json:"note"`
	Pinned    bool      `json:"pinned"`
	Read      bool      `json:"read"`
	Deleted   bool      `json:"deleted"`
	Revision  int       `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
