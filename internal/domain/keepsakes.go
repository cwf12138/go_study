package domain

import "time"

// Keepsake stores a private place or exhibit. Photos are bounded, embedded images.
type Keepsake struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	Kind       string    `json:"kind"`
	Title      string    `json:"title"`
	Story      string    `json:"story"`
	Category   string    `json:"category"`
	Collection string    `json:"collection"`
	Status     string    `json:"status"`
	Date       string    `json:"date"`
	Latitude   *float64  `json:"latitude"`
	Longitude  *float64  `json:"longitude"`
	Photo      string    `json:"photo"`
	Favorite   bool      `json:"favorite"`
	Archived   bool      `json:"archived"`
	Revision   int       `json:"revision"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
