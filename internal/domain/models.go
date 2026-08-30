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

// TodoList separates everyday planning from goal-oriented study tasks. Each
// user gets one inbox list automatically; any other list is user-managed.
type TodoListKind string

const (
	TodoListInbox  TodoListKind = "inbox"
	TodoListCustom TodoListKind = "custom"
)

type TodoList struct {
	ID        string       `json:"id"`
	UserID    string       `json:"user_id"`
	Name      string       `json:"name"`
	Color     string       `json:"color,omitempty"`
	Kind      TodoListKind `json:"kind"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
}

type TodoStatus string

const (
	TodoOpen      TodoStatus = "open"
	TodoCompleted TodoStatus = "completed"
)

type TodoRepeatRule string

const (
	TodoRepeatNone    TodoRepeatRule = "none"
	TodoRepeatDaily   TodoRepeatRule = "daily"
	TodoRepeatWeekly  TodoRepeatRule = "weekly"
	TodoRepeatMonthly TodoRepeatRule = "monthly"
)

type TodoStep struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Completed bool      `json:"completed"`
	CreatedAt time.Time `json:"created_at"`
}

type TodoItem struct {
	ID          string         `json:"id"`
	UserID      string         `json:"user_id"`
	ListID      string         `json:"list_id"`
	Title       string         `json:"title"`
	Notes       string         `json:"notes"`
	Priority    TaskPriority   `json:"priority"`
	Status      TodoStatus     `json:"status"`
	DueAt       *time.Time     `json:"due_at,omitempty"`
	MyDayDate   string         `json:"my_day_date,omitempty"`
	RepeatRule  TodoRepeatRule `json:"repeat_rule"`
	Tags        []string       `json:"tags"`
	Steps       []TodoStep     `json:"steps"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`
}

type VocabularyStage string

const (
	VocabularyNew       VocabularyStage = "new"
	VocabularyLearning  VocabularyStage = "learning"
	VocabularyReviewing VocabularyStage = "reviewing"
	VocabularyMastered  VocabularyStage = "mastered"
)

type WordBook struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	Language      string    `json:"language"`
	DailyNewLimit int       `json:"daily_new_limit"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type VocabularyWord struct {
	ID                 string          `json:"id"`
	UserID             string          `json:"user_id"`
	BookID             string          `json:"book_id"`
	Term               string          `json:"term"`
	Phonetic           string          `json:"phonetic"`
	Definition         string          `json:"definition"`
	Example            string          `json:"example"`
	ExampleTranslation string          `json:"example_translation"`
	Notes              string          `json:"notes"`
	Tags               []string        `json:"tags"`
	Stage              VocabularyStage `json:"stage"`
	EaseFactor         float64         `json:"ease_factor"`
	IntervalDays       int             `json:"interval_days"`
	Repetitions        int             `json:"repetitions"`
	Lapses             int             `json:"lapses"`
	DueAt              time.Time       `json:"due_at"`
	LastReviewedAt     *time.Time      `json:"last_reviewed_at,omitempty"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
}

type VocabularyReview struct {
	ID         string       `json:"id"`
	UserID     string       `json:"user_id"`
	WordID     string       `json:"word_id"`
	Rating     ReviewRating `json:"rating"`
	Mode       string       `json:"mode"`
	WasNew     bool         `json:"was_new"`
	ReviewedAt time.Time    `json:"reviewed_at"`
	NextDueAt  time.Time    `json:"next_due_at"`
}

type VocabularyOverview struct {
	Total         int     `json:"total"`
	New           int     `json:"new"`
	Learning      int     `json:"learning"`
	Reviewing     int     `json:"reviewing"`
	Mastered      int     `json:"mastered"`
	DueToday      int     `json:"due_today"`
	ReviewedToday int     `json:"reviewed_today"`
	AccuracyToday float64 `json:"accuracy_today"`
	StudyStreak   int     `json:"study_streak"`
}

// PlanBlockKind identifies the domain object represented by a calendar block.
// Scheduling is deliberately kept separate from task status: a task may be
// split into several blocks without pretending that it is already complete.
type PlanBlockKind string

const (
	PlanBlockTask       PlanBlockKind = "task"
	PlanBlockTodo       PlanBlockKind = "todo"
	PlanBlockReview     PlanBlockKind = "review"
	PlanBlockVocabulary PlanBlockKind = "vocabulary"
	PlanBlockCustom     PlanBlockKind = "custom"
)

type PlanBlockStatus string

const (
	PlanBlockPlanned   PlanBlockStatus = "planned"
	PlanBlockDoing     PlanBlockStatus = "in_progress"
	PlanBlockCompleted PlanBlockStatus = "completed"
	PlanBlockSkipped   PlanBlockStatus = "skipped"
)

type StudyPlanBlock struct {
	ID             string          `json:"id"`
	UserID         string          `json:"user_id"`
	Kind           PlanBlockKind   `json:"kind"`
	SourceID       string          `json:"source_id,omitempty"`
	Title          string          `json:"title"`
	Notes          string          `json:"notes"`
	StartAt        time.Time       `json:"start_at"`
	EndAt          time.Time       `json:"end_at"`
	PlannedMinutes int             `json:"planned_minutes"`
	Priority       TaskPriority    `json:"priority"`
	Status         PlanBlockStatus `json:"status"`
	Locked         bool            `json:"locked"`
	AutoGenerated  bool            `json:"auto_generated"`
	Rationale      string          `json:"rationale,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	CompletedAt    *time.Time      `json:"completed_at,omitempty"`
}

// AvailabilityWindow uses ISO weekdays (Monday=1, Sunday=7) and local
// HH:MM clock values in the preference time zone.
type AvailabilityWindow struct {
	Weekday   int    `json:"weekday"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type PlannerPreferences struct {
	UserID          string               `json:"user_id"`
	TimeZone        string               `json:"time_zone"`
	SessionMinutes  int                  `json:"session_minutes"`
	BreakMinutes    int                  `json:"break_minutes"`
	DailyMaxMinutes int                  `json:"daily_max_minutes"`
	Windows         []AvailabilityWindow `json:"windows"`
	UpdatedAt       time.Time            `json:"updated_at"`
}

type UnscheduledPlanItem struct {
	Kind             PlanBlockKind `json:"kind"`
	SourceID         string        `json:"source_id,omitempty"`
	Title            string        `json:"title"`
	RemainingMinutes int           `json:"remaining_minutes"`
	Reason           string        `json:"reason"`
}

type PlanWeekSummary struct {
	TotalBlocks        int     `json:"total_blocks"`
	CompletedBlocks    int     `json:"completed_blocks"`
	PlannedMinutes     int     `json:"planned_minutes"`
	CompletedMinutes   int     `json:"completed_minutes"`
	CapacityMinutes    int     `json:"capacity_minutes"`
	Utilization        float64 `json:"utilization"`
	OverdueSources     int     `json:"overdue_sources"`
	UnscheduledItems   int     `json:"unscheduled_items"`
	UnscheduledMinutes int     `json:"unscheduled_minutes"`
}

type PlanWeek struct {
	WeekStart   string                `json:"week_start"`
	WeekEnd     string                `json:"week_end"`
	GeneratedAt *time.Time            `json:"generated_at,omitempty"`
	Preferences PlannerPreferences    `json:"preferences"`
	Blocks      []StudyPlanBlock      `json:"blocks"`
	Unscheduled []UnscheduledPlanItem `json:"unscheduled"`
	Summary     PlanWeekSummary       `json:"summary"`
}

type PlannerReport struct {
	UserID         string                `json:"user_id"`
	WeekStart      string                `json:"week_start"`
	Unscheduled    []UnscheduledPlanItem `json:"unscheduled"`
	OverdueSources int                   `json:"overdue_sources"`
	GeneratedAt    time.Time             `json:"generated_at"`
}

type DailyLearningMetric struct {
	Date                 string  `json:"date"`
	FocusMinutes         int     `json:"focus_minutes"`
	FocusSessions        int     `json:"focus_sessions"`
	PlannedMinutes       int     `json:"planned_minutes"`
	CompletedPlanMinutes int     `json:"completed_plan_minutes"`
	PlanAdherence        float64 `json:"plan_adherence"`
	TasksCompleted       int     `json:"tasks_completed"`
	TodosCompleted       int     `json:"todos_completed"`
	CardReviews          int     `json:"card_reviews"`
	CardAccuracy         float64 `json:"card_accuracy"`
	VocabularyReviews    int     `json:"vocabulary_reviews"`
	VocabularyAccuracy   float64 `json:"vocabulary_accuracy"`
	MoodScore            int     `json:"mood_score,omitempty"`
	Stress               int     `json:"stress,omitempty"`
	Energy               int     `json:"energy,omitempty"`
}

type FocusHeatmapCell struct {
	Weekday int `json:"weekday"`
	Hour    int `json:"hour"`
	Minutes int `json:"minutes"`
}

type GoalLearningInsight struct {
	GoalID         string  `json:"goal_id"`
	Title          string  `json:"title"`
	TotalTasks     int     `json:"total_tasks"`
	CompletedTasks int     `json:"completed_tasks"`
	FocusMinutes   int     `json:"focus_minutes"`
	CompletionRate float64 `json:"completion_rate"`
}

type LearningRecommendation struct {
	Code        string `json:"code"`
	Level       string `json:"level"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Evidence    string `json:"evidence"`
}

type LearningInsightSummary struct {
	TotalFocusMinutes      int     `json:"total_focus_minutes"`
	AverageFocusMinutes    float64 `json:"average_focus_minutes"`
	ActiveDays             int     `json:"active_days"`
	LearningStreak         int     `json:"learning_streak"`
	PlanAdherence          float64 `json:"plan_adherence"`
	TasksCompleted         int     `json:"tasks_completed"`
	TodosCompleted         int     `json:"todos_completed"`
	CardReviews            int     `json:"card_reviews"`
	CardAccuracy           float64 `json:"card_accuracy"`
	VocabularyReviews      int     `json:"vocabulary_reviews"`
	VocabularyAccuracy     float64 `json:"vocabulary_accuracy"`
	ConsistencyScore       int     `json:"consistency_score"`
	PeakFocusWeekday       int     `json:"peak_focus_weekday,omitempty"`
	PeakFocusHour          int     `json:"peak_focus_hour,omitempty"`
	MoodFocusCorrelation   float64 `json:"mood_focus_correlation"`
	StressFocusCorrelation float64 `json:"stress_focus_correlation"`
	DueCards               int     `json:"due_cards"`
	DueVocabulary          int     `json:"due_vocabulary"`
}

type LearningInsights struct {
	StartDate       string                   `json:"start_date"`
	EndDate         string                   `json:"end_date"`
	TimeZone        string                   `json:"time_zone"`
	Summary         LearningInsightSummary   `json:"summary"`
	Daily           []DailyLearningMetric    `json:"daily"`
	FocusHeatmap    []FocusHeatmapCell       `json:"focus_heatmap"`
	Goals           []GoalLearningInsight    `json:"goals"`
	Recommendations []LearningRecommendation `json:"recommendations"`
}

type WeeklyReflection struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id"`
	WeekStart          string    `json:"week_start"`
	Satisfaction       int       `json:"satisfaction"`
	Wins               string    `json:"wins"`
	Challenges         string    `json:"challenges"`
	Lessons            string    `json:"lessons"`
	NextWeekPriorities []string  `json:"next_week_priorities"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type WeeklyReviewSummary struct {
	FocusMinutes      int     `json:"focus_minutes"`
	ActiveDays        int     `json:"active_days"`
	PlanAdherence     float64 `json:"plan_adherence"`
	TasksCompleted    int     `json:"tasks_completed"`
	TodosCompleted    int     `json:"todos_completed"`
	MemoryReviews     int     `json:"memory_reviews"`
	MemoryAccuracy    float64 `json:"memory_accuracy"`
	AverageMood       float64 `json:"average_mood"`
	AverageStress     float64 `json:"average_stress"`
	ConsistencyScore  int     `json:"consistency_score"`
	CompletedPlanMins int     `json:"completed_plan_minutes"`
	TotalPlannedMins  int     `json:"total_planned_minutes"`
}

type WeeklyReviewComparison struct {
	FocusMinutesDelta   int     `json:"focus_minutes_delta"`
	ActiveDaysDelta     int     `json:"active_days_delta"`
	PlanAdherenceDelta  float64 `json:"plan_adherence_delta"`
	CompletedItemsDelta int     `json:"completed_items_delta"`
	MemoryReviewsDelta  int     `json:"memory_reviews_delta"`
}

type WeeklyHighlight struct {
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Evidence    string `json:"evidence"`
}

type WeeklyReview struct {
	WeekStart       string                 `json:"week_start"`
	WeekEnd         string                 `json:"week_end"`
	ComparedFrom    string                 `json:"compared_from"`
	ComparedTo      string                 `json:"compared_to"`
	Summary         WeeklyReviewSummary    `json:"summary"`
	Previous        WeeklyReviewSummary    `json:"previous"`
	Comparison      WeeklyReviewComparison `json:"comparison"`
	Highlights      []WeeklyHighlight      `json:"highlights"`
	Reflection      WeeklyReflection       `json:"reflection"`
	ReflectionSaved bool                   `json:"reflection_saved"`
}

type KnowledgeNote struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Tags      []string  `json:"tags"`
	Pinned    bool      `json:"pinned"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type KnowledgeNoteSummary struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Snippet       string    `json:"snippet"`
	Tags          []string  `json:"tags"`
	Pinned        bool      `json:"pinned"`
	BacklinkCount int       `json:"backlink_count"`
	OutgoingCount int       `json:"outgoing_count"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type KnowledgeLink struct {
	SourceID    string `json:"source_id"`
	SourceTitle string `json:"source_title"`
	TargetID    string `json:"target_id,omitempty"`
	TargetTitle string `json:"target_title"`
	Resolved    bool   `json:"resolved"`
}

type KnowledgeNoteDetail struct {
	Note            KnowledgeNote    `json:"note"`
	Backlinks       []KnowledgeLink  `json:"backlinks"`
	OutgoingLinks   []KnowledgeLink  `json:"outgoing_links"`
	UnresolvedLinks []KnowledgeLink  `json:"unresolved_links"`
}

type KnowledgeGraphNode struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	Tags          []string `json:"tags"`
	Pinned        bool     `json:"pinned"`
	BacklinkCount int      `json:"backlink_count"`
	OutgoingCount int      `json:"outgoing_count"`
	Orphan        bool     `json:"orphan"`
}

type KnowledgeGraph struct {
	Nodes           []KnowledgeGraphNode `json:"nodes"`
	Edges           []KnowledgeLink      `json:"edges"`
	UnresolvedCount int                  `json:"unresolved_count"`
	OrphanCount     int                  `json:"orphan_count"`
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
	PlanBlockID           string      `json:"plan_block_id,omitempty"`
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
