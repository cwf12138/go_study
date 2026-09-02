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

// CalendarRepeatRule deliberately keeps recurrence compact. It covers the
// patterns most people use while remaining easy to migrate to RFC 5545 later.
type CalendarRepeatRule string

const (
	CalendarRepeatNone    CalendarRepeatRule = "none"
	CalendarRepeatDaily   CalendarRepeatRule = "daily"
	CalendarRepeatWeekly  CalendarRepeatRule = "weekly"
	CalendarRepeatMonthly CalendarRepeatRule = "monthly"
	CalendarRepeatYearly  CalendarRepeatRule = "yearly"
)

type CalendarEvent struct {
	ID              string             `json:"id"`
	UserID          string             `json:"user_id"`
	Title           string             `json:"title"`
	Description     string             `json:"description"`
	Location        string             `json:"location"`
	Category        string             `json:"category"`
	Color           string             `json:"color"`
	StartAt         time.Time          `json:"start_at"`
	EndAt           time.Time          `json:"end_at"`
	AllDay          bool               `json:"all_day"`
	RepeatRule      CalendarRepeatRule `json:"repeat_rule"`
	RepeatUntil     *time.Time         `json:"repeat_until,omitempty"`
	ReminderMinutes int                `json:"reminder_minutes"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
}

type CalendarOccurrence struct {
	CalendarEvent
	OccurrenceID    string    `json:"occurrence_id"`
	OccurrenceStart time.Time `json:"occurrence_start"`
	OccurrenceEnd   time.Time `json:"occurrence_end"`
}

type CalendarDaySummary struct {
	Date        string   `json:"date"`
	Lunar       string   `json:"lunar"`
	SolarTerm   string   `json:"solar_term,omitempty"`
	Festivals   []string `json:"festivals"`
	HolidayName string   `json:"holiday_name,omitempty"`
	HolidayType string   `json:"holiday_type,omitempty"`
}

type HistoricalEvent struct {
	Year int    `json:"year"`
	Text string `json:"text"`
	URL  string `json:"url,omitempty"`
}

type CalendarDayDetail struct {
	CalendarDaySummary
	Weekday       string            `json:"weekday"`
	LunarFull     string            `json:"lunar_full"`
	GanZhi        string            `json:"gan_zhi"`
	Zodiac        string            `json:"zodiac"`
	Constellation string            `json:"constellation"`
	Yi            []string          `json:"yi"`
	Ji            []string          `json:"ji"`
	Chong         string            `json:"chong"`
	Sha           string            `json:"sha"`
	LuckyGod      string            `json:"lucky_god"`
	WealthGod     string            `json:"wealth_god"`
	Quote         string            `json:"quote"`
	QuoteAuthor   string            `json:"quote_author"`
	History       []HistoricalEvent `json:"history"`
	HistorySource string            `json:"history_source"`
}

type CalendarOverview struct {
	Start       string               `json:"start"`
	End         string               `json:"end"`
	Days        []CalendarDaySummary `json:"days"`
	Events      []CalendarOccurrence `json:"events"`
	PlanBlocks  []StudyPlanBlock     `json:"plan_blocks"`
	Tasks       []StudyTask          `json:"tasks"`
	Todos       []TodoItem           `json:"todos"`
	MoodEntries []MoodEntry          `json:"mood_entries"`
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
	SourceID      string    `json:"source_id,omitempty"`
	SourceName    string    `json:"source_name,omitempty"`
	SourceURL     string    `json:"source_url,omitempty"`
	License       string    `json:"license,omitempty"`
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
	SourceRank         int             `json:"source_rank,omitempty"`
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
	Note            KnowledgeNote   `json:"note"`
	Backlinks       []KnowledgeLink `json:"backlinks"`
	OutgoingLinks   []KnowledgeLink `json:"outgoing_links"`
	UnresolvedLinks []KnowledgeLink `json:"unresolved_links"`
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

type EnglishArticle struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	Summary        string    `json:"summary"`
	URL            string    `json:"url"`
	Source         string    `json:"source"`
	SourceURL      string    `json:"source_url"`
	Category       string    `json:"category"`
	Difficulty     string    `json:"difficulty"`
	PublishedAt    time.Time `json:"published_at"`
	ReadingMinutes int       `json:"reading_minutes"`
	WordCount      int       `json:"word_count"`
	Offline        bool      `json:"offline,omitempty"`
}

type EnglishSourceStatus struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Available bool   `json:"available"`
	Count     int    `json:"count"`
}

type EnglishFeed struct {
	Articles  []EnglishArticle      `json:"articles"`
	Sources   []EnglishSourceStatus `json:"sources"`
	FetchedAt time.Time             `json:"fetched_at"`
	Degraded  bool                  `json:"degraded"`
}

type EnglishReading struct {
	ID          string         `json:"id"`
	UserID      string         `json:"user_id"`
	Article     EnglishArticle `json:"article"`
	Status      string         `json:"status"`
	Notes       string         `json:"notes"`
	NewWords    []string       `json:"new_words"`
	SavedAt     time.Time      `json:"saved_at"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type EnglishOverview struct {
	Saved             int `json:"saved"`
	Completed         int `json:"completed"`
	CompletedThisWeek int `json:"completed_this_week"`
	ReadingMinutes    int `json:"reading_minutes"`
	NewWords          int `json:"new_words"`
	StreakDays        int `json:"streak_days"`
}

type EBookCatalogItem struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	ChineseTitle  string   `json:"chinese_title,omitempty"`
	Authors       []string `json:"authors"`
	Summary       string   `json:"summary"`
	Language      string   `json:"language"`
	Subjects      []string `json:"subjects"`
	CoverURL      string   `json:"cover_url,omitempty"`
	ContentURL    string   `json:"content_url,omitempty"`
	SourceURL     string   `json:"source_url"`
	DownloadCount int      `json:"download_count"`
	Copyright     bool     `json:"copyright"`
	Featured      bool     `json:"featured,omitempty"`
}

type EBookCatalog struct {
	Items    []EBookCatalogItem `json:"items"`
	Query    string             `json:"query"`
	Provider string             `json:"provider"`
	Degraded bool               `json:"degraded"`
}

type EBookPage struct {
	Index   int    `json:"index"`
	Chapter string `json:"chapter"`
	Content string `json:"content"`
}

type EBookContent struct {
	Book          EBookCatalogItem `json:"book"`
	Pages         []EBookPage      `json:"pages"`
	TotalWords    int              `json:"total_words"`
	LicenseNotice string           `json:"license_notice"`
	FetchedAt     time.Time        `json:"fetched_at"`
}

type EBookBookmark struct {
	ID        string    `json:"id"`
	PageIndex int       `json:"page_index"`
	Label     string    `json:"label"`
	Excerpt   string    `json:"excerpt"`
	CreatedAt time.Time `json:"created_at"`
}

type EBookNote struct {
	ID        string    `json:"id"`
	PageIndex int       `json:"page_index"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type EBookReading struct {
	ID             string           `json:"id"`
	UserID         string           `json:"user_id"`
	Book           EBookCatalogItem `json:"book"`
	Status         string           `json:"status"`
	PageIndex      int              `json:"page_index"`
	TotalPages     int              `json:"total_pages"`
	Progress       float64          `json:"progress"`
	ReadingSeconds int              `json:"reading_seconds"`
	Bookmarks      []EBookBookmark  `json:"bookmarks"`
	Notes          []EBookNote      `json:"notes"`
	AddedAt        time.Time        `json:"added_at"`
	LastReadAt     time.Time        `json:"last_read_at"`
	CompletedAt    *time.Time       `json:"completed_at,omitempty"`
	UpdatedAt      time.Time        `json:"updated_at"`
}

type ClassicalAnnotation struct {
	Term    string `json:"term"`
	Meaning string `json:"meaning"`
}

type ClassicalWork struct {
	ID           string                `json:"id"`
	Title        string                `json:"title"`
	Author       string                `json:"author"`
	Dynasty      string                `json:"dynasty"`
	Genre        string                `json:"genre"`
	Difficulty   string                `json:"difficulty"`
	Text         []string              `json:"text"`
	Translation  []string              `json:"translation"`
	Annotations  []ClassicalAnnotation `json:"annotations"`
	Background   string                `json:"background"`
	Appreciation string                `json:"appreciation"`
	Tags         []string              `json:"tags"`
	Featured     bool                  `json:"featured,omitempty"`
}

type ClassicalStudy struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	WorkID          string    `json:"work_id"`
	Favorite        bool      `json:"favorite"`
	Status          string    `json:"status"`
	Notes           string    `json:"notes"`
	RecitationCount int       `json:"recitation_count"`
	LastStudiedAt   time.Time `json:"last_studied_at"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type LiteratureOverview struct {
	BooksInShelf      int `json:"books_in_shelf"`
	BooksCompleted    int `json:"books_completed"`
	ReadingMinutes    int `json:"reading_minutes"`
	Bookmarks         int `json:"bookmarks"`
	ClassicsStudied   int `json:"classics_studied"`
	ClassicsMastered  int `json:"classics_mastered"`
	ClassicsFavorites int `json:"classics_favorites"`
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
