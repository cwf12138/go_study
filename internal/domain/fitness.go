package domain

import "time"

type FitnessMove struct {
	Name        string `json:"name"`
	Mode        string `json:"mode"`
	Target      int    `json:"target"`
	Sets        int    `json:"sets"`
	RestSeconds int    `json:"rest_seconds"`
	Instruction string `json:"instruction"`
	Done        int    `json:"done"`
	Skipped     int    `json:"skipped"`
}

// FitnessEntry stores routines, dated plans, manual logs, session snapshots and
// user-defined goals. Session timing/state can only be changed via service actions.
type FitnessEntry struct {
	ID               string        `json:"id"`
	UserID           string        `json:"user_id"`
	Kind             string        `json:"kind"`
	Title            string        `json:"title"`
	Category         string        `json:"category"`
	Equipment        string        `json:"equipment"`
	Note             string        `json:"note"`
	Date             string        `json:"date"`
	State            string        `json:"state"`
	RoutineID        string        `json:"routine_id"`
	PlanID           string        `json:"plan_id"`
	Moves            []FitnessMove `json:"moves"`
	ElapsedSeconds   int           `json:"elapsed_seconds"`
	RemainingSeconds int           `json:"remaining_seconds"`
	RunningSince     time.Time     `json:"running_since"`
	CurrentMove      int           `json:"current_move"`
	Phase            string        `json:"phase"`
	Effort           int           `json:"effort"`
	WeeklyMinutes    int           `json:"weekly_minutes"`
	WeeklySessions   int           `json:"weekly_sessions"`
	LastCommandID    string        `json:"last_command_id,omitempty"`
	LastCommandHash  string        `json:"last_command_hash,omitempty"`
	Deleted          bool          `json:"deleted"`
	Revision         int           `json:"revision"`
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
}
