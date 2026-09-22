package domain

import "time"

type ProjectCheck struct {
	Title string `json:"title"`
	Done  bool   `json:"done"`
}
type ProjectCard struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Status      string         `json:"status"`
	Priority    string         `json:"priority"`
	Due         string         `json:"due"`
	Checks      []ProjectCheck `json:"checks"`
	Archived    bool           `json:"archived"`
}
type Project struct {
	ID          string        `json:"id"`
	UserID      string        `json:"user_id"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Color       string        `json:"color"`
	Archived    bool          `json:"archived"`
	Cards       []ProjectCard `json:"cards"`
	Revision    int           `json:"revision"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}
