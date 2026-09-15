package domain

import "time"

type Exploration struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	Mood        string     `json:"mood"`
	UnlockAt    time.Time  `json:"unlock_at"`
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Reflection  string     `json:"reflection"`
	Minutes     int        `json:"minutes"`
	Budget      int        `json:"budget"`
	Place       string     `json:"place"`
	Locked      bool       `json:"locked"`
	Date        string     `json:"date,omitempty"`
	Action      string     `json:"action,omitempty"`
	Prompt      string     `json:"prompt,omitempty"`
	Favorite    bool       `json:"favorite"`
	SignNumber  int        `json:"sign_number,omitempty"`
}
