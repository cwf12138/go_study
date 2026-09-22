package domain

import "time"

// Habit is a daily practice. Dates belong to its immutable IANA time zone.
type Habit struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	Icon         string    `json:"icon"`
	TimeZone     string    `json:"time_zone"`
	WeeklyTarget int       `json:"weekly_target"`
	StartDate    string    `json:"start_date"`
	Archived     bool      `json:"archived"`
	Checkins     []string  `json:"checkins"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
