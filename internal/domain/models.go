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
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Deadline    *time.Time `json:"deadline,omitempty"`
	Status      GoalStatus `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type Mood string

const (
	MoodAwful   Mood = "awful"
	MoodLow     Mood = "low"
	MoodNeutral Mood = "neutral"
	MoodGood    Mood = "good"
	MoodGreat   Mood = "great"
)

// MoodEntry is a private daily check-in. Date always uses the YYYY-MM-DD form
// so a calendar day remains stable regardless of the server time zone.
type MoodEntry struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	Date       string    `json:"date"`
	Mood       Mood      `json:"mood"`
	Note       string    `json:"note"`
	Activities []string  `json:"activities"`
	Tags       []string  `json:"tags"`
	Stress     int       `json:"stress"`
	Energy     int       `json:"energy"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type MoodActivityCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type MoodInsights struct {
	Month            string              `json:"month"`
	LoggedDays       int                 `json:"logged_days"`
	AverageMood      float64             `json:"average_mood"`
	AverageStress    float64             `json:"average_stress"`
	AverageEnergy    float64             `json:"average_energy"`
	LongestStreak    int                 `json:"longest_streak"`
	DominantMood     Mood                `json:"dominant_mood,omitempty"`
	MoodDistribution map[string]int      `json:"mood_distribution"`
	TopActivities    []MoodActivityCount `json:"top_activities"`
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
	FocusPaused    FocusStatus = "paused"
	FocusCompleted FocusStatus = "completed"
	FocusAbandoned FocusStatus = "abandoned"
)

type FocusPhase string

const (
	FocusPhaseFocus       FocusPhase = "focus"
	FocusPhaseFocusFirst  FocusPhase = "focus_first"
	FocusPhaseBreak       FocusPhase = "break"
	FocusPhaseFocusSecond FocusPhase = "focus_second"
)

type FocusSession struct {
	ID                    string      `json:"id"`
	UserID                string      `json:"user_id"`
	TaskID                string      `json:"task_id,omitempty"`
	PlannedMinutes        int         `json:"planned_minutes"`
	ActualMinutes         int         `json:"actual_minutes"`
	FocusedSeconds        int         `json:"focused_seconds"`
	BreakEnabled          bool        `json:"break_enabled"`
	BreakMinutes          int         `json:"break_minutes"`
	Phase                 FocusPhase  `json:"phase"`
	PhaseStartedAt        time.Time   `json:"phase_started_at"`
	PhaseRemainingSeconds int         `json:"phase_remaining_seconds"`
	Status                FocusStatus `json:"status"`
	StartedAt             time.Time   `json:"started_at"`
	PausedAt              *time.Time  `json:"paused_at,omitempty"`
	EndedAt               *time.Time  `json:"ended_at,omitempty"`
}

type Dashboard struct {
	ActiveGoals         int            `json:"active_goals"`
	PendingTasks        int            `json:"pending_tasks"`
	CompletedTasks      int            `json:"completed_tasks"`
	CompletedTasksToday int            `json:"completed_tasks_today"`
	DueCards            int            `json:"due_cards"`
	FocusMinutesToday   int            `json:"focus_minutes_today"`
	FocusMinutesWeek    int            `json:"focus_minutes_week"`
	FocusSessionsToday  int            `json:"focus_sessions_today"`
	TasksByPriority     map[string]int `json:"tasks_by_priority"`
}
