package domain

import "time"

type SearchHit struct {
	Source     string    `json:"source"`
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Snippet    string    `json:"snippet"`
	Tags       []string  `json:"tags"`
	State      string    `json:"state"`
	Date       string    `json:"date"`
	Archived   bool      `json:"archived"`
	UpdatedAt  time.Time `json:"updated_at"`
	MatchField string    `json:"match_field"`
	Score      int       `json:"score"`
}
type SearchResult struct {
	Query     string         `json:"query"`
	Items     []SearchHit    `json:"items"`
	Total     int            `json:"total"`
	Available int            `json:"available"`
	Page      int            `json:"page"`
	PageSize  int            `json:"page_size"`
	Counts    map[string]int `json:"counts"`
	Warnings  []string       `json:"warnings"`
	Truncated bool           `json:"truncated"`
}
