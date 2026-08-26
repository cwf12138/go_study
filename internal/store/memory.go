package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/example/studyflow/internal/domain"
)

type Memory struct {
	mu       sync.RWMutex
	users    map[string]domain.User
	emails   map[string]string
	goals    map[string]domain.Goal
	tasks    map[string]domain.StudyTask
	decks    map[string]domain.Deck
	cards    map[string]domain.Card
	reviews  map[string]domain.Review
	sessions map[string]domain.FocusSession
}

func NewMemory() *Memory {
	return &Memory{
		users:    make(map[string]domain.User),
		emails:   make(map[string]string),
		goals:    make(map[string]domain.Goal),
		tasks:    make(map[string]domain.StudyTask),
		decks:    make(map[string]domain.Deck),
		cards:    make(map[string]domain.Card),
		reviews:  make(map[string]domain.Review),
		sessions: make(map[string]domain.FocusSession),
	}
}

func (m *Memory) CreateUser(_ context.Context, user domain.User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := strings.ToLower(user.Email)
	if _, exists := m.emails[key]; exists {
		return domain.ErrConflict
	}
	m.users[user.ID] = user
	m.emails[key] = user.ID
	return nil
}

func (m *Memory) UserByID(_ context.Context, id string) (domain.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	user, ok := m.users[id]
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	return user, nil
}

func (m *Memory) UserByEmail(_ context.Context, email string) (domain.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.emails[strings.ToLower(email)]
	if !ok {
		return domain.User{}, domain.ErrNotFound
	}
	return m.users[id], nil
}

func (m *Memory) CreateGoal(_ context.Context, goal domain.Goal) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.goals[goal.ID] = goal
	return nil
}

func (m *Memory) GoalByID(_ context.Context, id string) (domain.Goal, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	goal, ok := m.goals[id]
	if !ok {
		return domain.Goal{}, domain.ErrNotFound
	}
	return goal, nil
}

func (m *Memory) UpdateGoal(_ context.Context, goal domain.Goal) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.goals[goal.ID]; !ok {
		return domain.ErrNotFound
	}
	m.goals[goal.ID] = goal
	return nil
}

func (m *Memory) ListGoals(_ context.Context, userID string) ([]domain.Goal, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.Goal, 0)
	for _, goal := range m.goals {
		if goal.UserID == userID {
			items = append(items, goal)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items, nil
}

func (m *Memory) CreateTask(_ context.Context, task domain.StudyTask) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tasks[task.ID] = cloneTask(task)
	return nil
}

func (m *Memory) TaskByID(_ context.Context, id string) (domain.StudyTask, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task, ok := m.tasks[id]
	if !ok {
		return domain.StudyTask{}, domain.ErrNotFound
	}
	return cloneTask(task), nil
}

func (m *Memory) UpdateTask(_ context.Context, task domain.StudyTask) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.tasks[task.ID]; !ok {
		return domain.ErrNotFound
	}
	m.tasks[task.ID] = cloneTask(task)
	return nil
}

func (m *Memory) ListTasks(_ context.Context, userID string, filter TaskFilter) ([]domain.StudyTask, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.StudyTask, 0)
	for _, task := range m.tasks {
		if task.UserID != userID || (filter.Status != "" && task.Status != filter.Status) || (filter.GoalID != "" && task.GoalID != filter.GoalID) {
			continue
		}
		if filter.DueUntil != nil && (task.DueAt == nil || task.DueAt.After(*filter.DueUntil)) {
			continue
		}
		items = append(items, cloneTask(task))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].DueAt == nil {
			return false
		}
		if items[j].DueAt == nil {
			return true
		}
		return items[i].DueAt.Before(*items[j].DueAt)
	})
	return items, nil
}

func (m *Memory) CreateDeck(_ context.Context, deck domain.Deck) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.decks[deck.ID] = deck
	return nil
}

func (m *Memory) DeckByID(_ context.Context, id string) (domain.Deck, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	deck, ok := m.decks[id]
	if !ok {
		return domain.Deck{}, domain.ErrNotFound
	}
	return deck, nil
}

func (m *Memory) ListDecks(_ context.Context, userID string) ([]domain.Deck, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.Deck, 0)
	for _, deck := range m.decks {
		if deck.UserID == userID {
			items = append(items, deck)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items, nil
}

func (m *Memory) CreateCard(_ context.Context, card domain.Card) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cards[card.ID] = card
	return nil
}

func (m *Memory) CardByID(_ context.Context, id string) (domain.Card, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	card, ok := m.cards[id]
	if !ok {
		return domain.Card{}, domain.ErrNotFound
	}
	return card, nil
}

func (m *Memory) UpdateCard(_ context.Context, card domain.Card) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.cards[card.ID]; !ok {
		return domain.ErrNotFound
	}
	m.cards[card.ID] = card
	return nil
}

func (m *Memory) ListDueCards(_ context.Context, userID string, due time.Time, limit int) ([]domain.Card, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.Card, 0)
	for _, card := range m.cards {
		if card.UserID == userID && !card.DueAt.After(due) {
			items = append(items, card)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].DueAt.Before(items[j].DueAt) })
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (m *Memory) ApplyReview(_ context.Context, card domain.Card, review domain.Review) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.cards[card.ID]; !ok {
		return domain.ErrNotFound
	}
	m.cards[card.ID] = card
	m.reviews[review.ID] = review
	return nil
}

func (m *Memory) CreateFocusSession(_ context.Context, session domain.FocusSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, existing := range m.sessions {
		if existing.UserID == session.UserID && (existing.Status == domain.FocusRunning || existing.Status == domain.FocusPaused) {
			return domain.ErrConflict
		}
	}
	m.sessions[session.ID] = session
	return nil
}

func (m *Memory) FocusSessionByID(_ context.Context, id string) (domain.FocusSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	session, ok := m.sessions[id]
	if !ok {
		return domain.FocusSession{}, domain.ErrNotFound
	}
	return normalizeFocusSession(session), nil
}

func (m *Memory) ActiveFocusSession(_ context.Context, userID string) (domain.FocusSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var active domain.FocusSession
	found := false
	for _, session := range m.sessions {
		if session.UserID != userID || (session.Status != domain.FocusRunning && session.Status != domain.FocusPaused) {
			continue
		}
		if !found || session.StartedAt.After(active.StartedAt) {
			active = session
			found = true
		}
	}
	if !found {
		return domain.FocusSession{}, domain.ErrNotFound
	}
	return normalizeFocusSession(active), nil
}

func (m *Memory) UpdateFocusSession(_ context.Context, session domain.FocusSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[session.ID]; !ok {
		return domain.ErrNotFound
	}
	m.sessions[session.ID] = session
	return nil
}

func (m *Memory) ListFocusSessions(_ context.Context, userID string, since time.Time) ([]domain.FocusSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.FocusSession, 0)
	for _, session := range m.sessions {
		if session.UserID == userID && !session.StartedAt.Before(since) {
			items = append(items, session)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].StartedAt.After(items[j].StartedAt) })
	return items, nil
}

type persistedUser struct {
	domain.User
	PasswordHash string `json:"password_hash"`
}

type snapshot struct {
	Version  int                   `json:"version"`
	SavedAt  time.Time             `json:"saved_at"`
	Users    []persistedUser       `json:"users"`
	Goals    []domain.Goal         `json:"goals"`
	Tasks    []domain.StudyTask    `json:"tasks"`
	Decks    []domain.Deck         `json:"decks"`
	Cards    []domain.Card         `json:"cards"`
	Reviews  []domain.Review       `json:"reviews"`
	Sessions []domain.FocusSession `json:"focus_sessions"`
}

func (m *Memory) SaveJSON(path string) error {
	m.mu.RLock()
	s := snapshot{Version: 1, SavedAt: time.Now().UTC()}
	for _, item := range m.users {
		s.Users = append(s.Users, persistedUser{User: item, PasswordHash: item.PasswordHash})
	}
	for _, item := range m.goals {
		s.Goals = append(s.Goals, item)
	}
	for _, item := range m.tasks {
		s.Tasks = append(s.Tasks, cloneTask(item))
	}
	for _, item := range m.decks {
		s.Decks = append(s.Decks, item)
	}
	for _, item := range m.cards {
		s.Cards = append(s.Cards, item)
	}
	for _, item := range m.reviews {
		s.Reviews = append(s.Reviews, item)
	}
	for _, item := range m.sessions {
		s.Sessions = append(s.Sessions, item)
	}
	m.mu.RUnlock()

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return removeErr
		}
		return os.Rename(tmp, path)
	}
	return nil
}

func (m *Memory) LoadJSON(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var s snapshot
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	if s.Version != 1 {
		return errors.New("unsupported snapshot version")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.users = make(map[string]domain.User, len(s.Users))
	m.emails = make(map[string]string, len(s.Users))
	m.goals = make(map[string]domain.Goal, len(s.Goals))
	m.tasks = make(map[string]domain.StudyTask, len(s.Tasks))
	m.decks = make(map[string]domain.Deck, len(s.Decks))
	m.cards = make(map[string]domain.Card, len(s.Cards))
	m.reviews = make(map[string]domain.Review, len(s.Reviews))
	m.sessions = make(map[string]domain.FocusSession, len(s.Sessions))
	for _, record := range s.Users {
		record.User.PasswordHash = record.PasswordHash
		m.users[record.ID] = record.User
		m.emails[strings.ToLower(record.Email)] = record.ID
	}
	for _, item := range s.Goals {
		m.goals[item.ID] = item
	}
	for _, item := range s.Tasks {
		m.tasks[item.ID] = cloneTask(item)
	}
	for _, item := range s.Decks {
		m.decks[item.ID] = item
	}
	for _, item := range s.Cards {
		m.cards[item.ID] = item
	}
	for _, item := range s.Reviews {
		m.reviews[item.ID] = item
	}
	for _, item := range s.Sessions {
		m.sessions[item.ID] = normalizeFocusSession(item)
	}
	return nil
}

func cloneTask(task domain.StudyTask) domain.StudyTask {
	task.Tags = append([]string(nil), task.Tags...)
	return task
}

func normalizeFocusSession(session domain.FocusSession) domain.FocusSession {
	if session.Phase == "" {
		session.Phase = domain.FocusPhaseFocus
		session.PhaseStartedAt = session.StartedAt
		if session.Status == domain.FocusRunning || session.Status == domain.FocusPaused {
			session.PhaseRemainingSeconds = session.PlannedMinutes * 60
		}
	}
	return session
}
