package domain

import "time"

type UserRole string

const (
	RoleStudent UserRole = "student"
	RoleAdmin   UserRole = "admin"
)

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	PasswordHash string    `json:"-"`
	Role         UserRole  `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
}

type GoalStatus string

const (
	GoalActive    GoalStatus = "active"
	GoalCompleted GoalStatus = "completed"
	GoalArchived  GoalStatus = "archived"
)

type Goal struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	Title         string     `json:"title"`
	Description   string     `json:"description"`
	TargetMinutes int        `json:"target_minutes"`
	Deadline      *time.Time `json:"deadline,omitempty"`
	Status        GoalStatus `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type TaskStatus string

const (
	TaskTodo       TaskStatus = "todo"
	TaskInProgress TaskStatus = "in_progress"
	TaskDone       TaskStatus = "done"
	TaskCancelled  TaskStatus = "cancelled"
)

type TaskPriority string

const (
	PriorityLow    TaskPriority = "low"
	PriorityMedium TaskPriority = "medium"
	PriorityHigh   TaskPriority = "high"
)

type StudyTask struct {
	ID               string       `json:"id"`
	UserID           string       `json:"user_id"`
	GoalID           string       `json:"goal_id,omitempty"`
	Title            string       `json:"title"`
	Description      string       `json:"description"`
	EstimatedMinutes int          `json:"estimated_minutes"`
	Priority         TaskPriority `json:"priority"`
	Status           TaskStatus   `json:"status"`
	DueAt            *time.Time   `json:"due_at,omitempty"`
	Tags             []string     `json:"tags"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
	CompletedAt      *time.Time   `json:"completed_at,omitempty"`
}

type Deck struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type Card struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	DeckID       string    `json:"deck_id"`
	Prompt       string    `json:"prompt"`
	Answer       string    `json:"answer"`
	EaseFactor   float64   `json:"ease_factor"`
	IntervalDays int       `json:"interval_days"`
	Repetitions  int       `json:"repetitions"`
	DueAt        time.Time `json:"due_at"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ReviewRating follows a compact SM-2-style scale.
type ReviewRating int

const (
	RatingAgain ReviewRating = 1
	RatingHard  ReviewRating = 2
	RatingGood  ReviewRating = 3
	RatingEasy  ReviewRating = 4
)

type Review struct {
	ID         string       `json:"id"`
	UserID     string       `json:"user_id"`
	CardID     string       `json:"card_id"`
	Rating     ReviewRating `json:"rating"`
	ReviewedAt time.Time    `json:"reviewed_at"`
	NextDueAt  time.Time    `json:"next_due_at"`
}

type FocusStatus string

const (
	FocusRunning   FocusStatus = "running"
	FocusCompleted FocusStatus = "completed"
	FocusAbandoned FocusStatus = "abandoned"
)

type FocusSession struct {
	ID             string      `json:"id"`
	UserID         string      `json:"user_id"`
	TaskID         string      `json:"task_id,omitempty"`
	PlannedMinutes int         `json:"planned_minutes"`
	ActualMinutes  int         `json:"actual_minutes"`
	Status         FocusStatus `json:"status"`
	StartedAt      time.Time   `json:"started_at"`
	EndedAt        *time.Time  `json:"ended_at,omitempty"`
}

type Dashboard struct {
	ActiveGoals       int            `json:"active_goals"`
	PendingTasks      int            `json:"pending_tasks"`
	CompletedTasks    int            `json:"completed_tasks"`
	DueCards          int            `json:"due_cards"`
	FocusMinutesToday int            `json:"focus_minutes_today"`
	FocusMinutesWeek  int            `json:"focus_minutes_week"`
	TasksByPriority   map[string]int `json:"tasks_by_priority"`
}
