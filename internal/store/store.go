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

// Repository is deliberately domain-oriented. A PostgreSQL, SQLite or remote
// implementation can replace Memory without changing the service layer.
type Repository interface {
	CreateUser(context.Context, domain.User) error
	UserByID(context.Context, string) (domain.User, error)
	UserByEmail(context.Context, string) (domain.User, error)

	CreateGoal(context.Context, domain.Goal) error
	GoalByID(context.Context, string) (domain.Goal, error)
	UpdateGoal(context.Context, domain.Goal) error
	ListGoals(context.Context, string) ([]domain.Goal, error)

	CreateTask(context.Context, domain.StudyTask) error
	TaskByID(context.Context, string) (domain.StudyTask, error)
	UpdateTask(context.Context, domain.StudyTask) error
	ListTasks(context.Context, string, TaskFilter) ([]domain.StudyTask, error)

	CreateDeck(context.Context, domain.Deck) error
	DeckByID(context.Context, string) (domain.Deck, error)
	ListDecks(context.Context, string) ([]domain.Deck, error)
	CreateCard(context.Context, domain.Card) error
	CardByID(context.Context, string) (domain.Card, error)
	UpdateCard(context.Context, domain.Card) error
	ListDueCards(context.Context, string, time.Time, int) ([]domain.Card, error)
	ApplyReview(context.Context, domain.Card, domain.Review) error

	CreateFocusSession(context.Context, domain.FocusSession) error
	FocusSessionByID(context.Context, string) (domain.FocusSession, error)
	UpdateFocusSession(context.Context, domain.FocusSession) error
	ListFocusSessions(context.Context, string, time.Time) ([]domain.FocusSession, error)
}
