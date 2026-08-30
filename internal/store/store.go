package store

import (
	"context"
	"time"

	"github.com/example/studyflow/internal/domain"
)

type TaskFilter struct {
	Status   domain.TaskStatus
	GoalID   string
	DueUntil *time.Time
}

type TodoFilter struct {
	ListID string
	Status domain.TodoStatus
}

// Repository is deliberately domain-oriented. A PostgreSQL, SQLite or remote
// implementation can replace Memory without changing the service layer.
type Repository interface {
	CreateUser(context.Context, domain.User) error
	UserByID(context.Context, string) (domain.User, error)
	UserByEmail(context.Context, string) (domain.User, error)

	CreateGoal(context.Context, domain.Goal) error
	GoalByID(context.Context, string) (domain.Goal, error)
	UpdateGoal(context.Context, domain.Goal) error
	DeleteGoal(context.Context, string) error
	ListGoals(context.Context, string) ([]domain.Goal, error)

	UpsertMoodEntry(context.Context, domain.MoodEntry) error
	MoodEntryByDate(context.Context, string, string) (domain.MoodEntry, error)
	ListMoodEntries(context.Context, string, string) ([]domain.MoodEntry, error)
	ListAllMoodEntries(context.Context, string) ([]domain.MoodEntry, error)
	DeleteMoodEntry(context.Context, string, string) error

	CreateTask(context.Context, domain.StudyTask) error
	TaskByID(context.Context, string) (domain.StudyTask, error)
	UpdateTask(context.Context, domain.StudyTask) error
	DeleteTask(context.Context, string) error
	ListTasks(context.Context, string, TaskFilter) ([]domain.StudyTask, error)

	CreateTodoList(context.Context, domain.TodoList) error
	TodoListByID(context.Context, string) (domain.TodoList, error)
	DeleteTodoList(context.Context, string) error
	ListTodoLists(context.Context, string) ([]domain.TodoList, error)
	CreateTodo(context.Context, domain.TodoItem) error
	TodoByID(context.Context, string) (domain.TodoItem, error)
	UpdateTodo(context.Context, domain.TodoItem) error
	DeleteTodo(context.Context, string) error
	ListTodos(context.Context, string, TodoFilter) ([]domain.TodoItem, error)

	CreateWordBook(context.Context, domain.WordBook) error
	WordBookByID(context.Context, string) (domain.WordBook, error)
	ListWordBooks(context.Context, string) ([]domain.WordBook, error)
	CreateVocabularyWord(context.Context, domain.VocabularyWord) error
	CreateVocabularyWords(context.Context, []domain.VocabularyWord) error
	VocabularyWordByID(context.Context, string) (domain.VocabularyWord, error)
	DeleteVocabularyWord(context.Context, string) error
	ListVocabularyWords(context.Context, string, string) ([]domain.VocabularyWord, error)
	ApplyVocabularyReview(context.Context, domain.VocabularyWord, domain.VocabularyReview) error
	ListVocabularyReviews(context.Context, string, time.Time) ([]domain.VocabularyReview, error)

	UpsertPlannerPreferences(context.Context, domain.PlannerPreferences) error
	PlannerPreferences(context.Context, string) (domain.PlannerPreferences, error)
	CreatePlanBlock(context.Context, domain.StudyPlanBlock) error
	PlanBlockByID(context.Context, string) (domain.StudyPlanBlock, error)
	UpdatePlanBlock(context.Context, domain.StudyPlanBlock) error
	DeletePlanBlock(context.Context, string) error
	ListPlanBlocks(context.Context, string, time.Time, time.Time) ([]domain.StudyPlanBlock, error)
	ReplaceGeneratedPlanBlocks(context.Context, string, time.Time, time.Time, []domain.StudyPlanBlock) error
	UpsertPlannerReport(context.Context, domain.PlannerReport) error
	PlannerReport(context.Context, string, string) (domain.PlannerReport, error)
	ListPlannerReports(context.Context, string) ([]domain.PlannerReport, error)
	UpsertWeeklyReflection(context.Context, domain.WeeklyReflection) error
	WeeklyReflection(context.Context, string, string) (domain.WeeklyReflection, error)
	ListWeeklyReflections(context.Context, string) ([]domain.WeeklyReflection, error)

	CreateKnowledgeNote(context.Context, domain.KnowledgeNote) error
	KnowledgeNoteByID(context.Context, string) (domain.KnowledgeNote, error)
	UpdateKnowledgeNote(context.Context, domain.KnowledgeNote) error
	DeleteKnowledgeNote(context.Context, string) error
	ListKnowledgeNotes(context.Context, string) ([]domain.KnowledgeNote, error)

	CreateDeck(context.Context, domain.Deck) error
	DeckByID(context.Context, string) (domain.Deck, error)
	ListDecks(context.Context, string) ([]domain.Deck, error)
	CreateCard(context.Context, domain.Card) error
	CardByID(context.Context, string) (domain.Card, error)
	UpdateCard(context.Context, domain.Card) error
	ListDueCards(context.Context, string, time.Time, int) ([]domain.Card, error)
	ListCards(context.Context, string) ([]domain.Card, error)
	ApplyReview(context.Context, domain.Card, domain.Review) error
	ListReviews(context.Context, string, time.Time) ([]domain.Review, error)

	CreateFocusSession(context.Context, domain.FocusSession) error
	FocusSessionByID(context.Context, string) (domain.FocusSession, error)
	ActiveFocusSession(context.Context, string) (domain.FocusSession, error)
	UpdateFocusSession(context.Context, domain.FocusSession) error
	ListFocusSessions(context.Context, string, time.Time) ([]domain.FocusSession, error)
}
