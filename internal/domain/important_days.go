package domain

import "time"

type ImportantDay struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Title     string    `json:"title"`
	Date      string    `json:"date"`
	Category  string    `json:"category"`
	Note      string    `json:"note"`
	Annual    bool      `json:"annual"`
	Pinned    bool      `json:"pinned"`
	Deleted   bool      `json:"deleted"`
	Revision  int       `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
