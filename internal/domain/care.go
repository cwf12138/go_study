package domain

import "time"

type CareCompletion struct {
	ID        string    `json:"id"`
	Date      string    `json:"date"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}
type CareUndo struct {
	AnchorDate   string          `json:"anchor_date"`
	Index        int             `json:"index"`
	SnoozedUntil string          `json:"snoozed_until"`
	LastDoneDate string          `json:"last_done_date"`
	Dropped      *CareCompletion `json:"dropped,omitempty"`
}
type CareItem struct {
	ID               string           `json:"id"`
	UserID           string           `json:"user_id"`
	Title            string           `json:"title"`
	Category         string           `json:"category"`
	Interval         int              `json:"interval"`
	Unit             string           `json:"unit"`
	Rhythm           string           `json:"rhythm"`
	AnchorDate       string           `json:"anchor_date"`
	Index            int              `json:"index"`
	NextDate         string           `json:"next_date"`
	SnoozedUntil     string           `json:"snoozed_until"`
	EstimateMinutes  int              `json:"estimate_minutes"`
	Importance       string           `json:"importance"`
	Note             string           `json:"note"`
	State            string           `json:"state"`
	Deleted          bool             `json:"deleted"`
	LastDoneDate     string           `json:"last_done_date"`
	TotalCompletions int              `json:"total_completions"`
	History          []CareCompletion `json:"history"`
	Undo             *CareUndo        `json:"undo,omitempty"`
	LastCommandID    string           `json:"last_command_id,omitempty"`
	LastCommandHash  string           `json:"last_command_hash,omitempty"`
	Revision         int              `json:"revision"`
	CreatedAt        time.Time        `json:"created_at"`
	UpdatedAt        time.Time        `json:"updated_at"`
}
type CareCalendarEntry struct {
	ItemID string `json:"item_id"`
	Date   string `json:"date"`
	Title  string `json:"title"`
	Kind   string `json:"kind"`
}
