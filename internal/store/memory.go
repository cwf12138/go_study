package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/example/studyflow/internal/domain"
)

type Memory struct {
	mu                sync.RWMutex
	users             map[string]domain.User
	emails            map[string]string
	goals             map[string]domain.Goal
	moods             map[string]domain.MoodEntry
	tasks             map[string]domain.StudyTask
	todoLists         map[string]domain.TodoList
	todos             map[string]domain.TodoItem
	calendarEvents    map[string]domain.CalendarEvent
	wordBooks         map[string]domain.WordBook
	words             map[string]domain.VocabularyWord
	wordReviews       map[string]domain.VocabularyReview
	plannerPrefs      map[string]domain.PlannerPreferences
	planBlocks        map[string]domain.StudyPlanBlock
	plannerReports    map[string]domain.PlannerReport
	weeklyReflections map[string]domain.WeeklyReflection
	knowledgeNotes    map[string]domain.KnowledgeNote
	englishReadings   map[string]domain.EnglishReading
	ebookReadings     map[string]domain.EBookReading
	classicalStudies  map[string]domain.ClassicalStudy
	sessions          map[string]domain.FocusSession
}

func NewMemory() *Memory {
	return &Memory{
		users:             make(map[string]domain.User),
		emails:            make(map[string]string),
		goals:             make(map[string]domain.Goal),
		moods:             make(map[string]domain.MoodEntry),
		tasks:             make(map[string]domain.StudyTask),
		todoLists:         make(map[string]domain.TodoList),
		todos:             make(map[string]domain.TodoItem),
		calendarEvents:    make(map[string]domain.CalendarEvent),
		wordBooks:         make(map[string]domain.WordBook),
		words:             make(map[string]domain.VocabularyWord),
		wordReviews:       make(map[string]domain.VocabularyReview),
		plannerPrefs:      make(map[string]domain.PlannerPreferences),
		planBlocks:        make(map[string]domain.StudyPlanBlock),
		plannerReports:    make(map[string]domain.PlannerReport),
		weeklyReflections: make(map[string]domain.WeeklyReflection),
		knowledgeNotes:    make(map[string]domain.KnowledgeNote),
		englishReadings:   make(map[string]domain.EnglishReading),
		ebookReadings:     make(map[string]domain.EBookReading),
		classicalStudies:  make(map[string]domain.ClassicalStudy),
		sessions:          make(map[string]domain.FocusSession),
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

func (m *Memory) DeleteGoal(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.goals[id]; !ok {
		return domain.ErrNotFound
	}
	delete(m.goals, id)
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

func (m *Memory) UpsertMoodEntry(_ context.Context, entry domain.MoodEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.moods[moodKey(entry.UserID, entry.Date)] = cloneMoodEntry(entry)
	return nil
}

func (m *Memory) MoodEntryByDate(_ context.Context, userID, date string) (domain.MoodEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	entry, ok := m.moods[moodKey(userID, date)]
	if !ok {
		return domain.MoodEntry{}, domain.ErrNotFound
	}
	return cloneMoodEntry(entry), nil
}

func (m *Memory) ListMoodEntries(_ context.Context, userID, month string) ([]domain.MoodEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.MoodEntry, 0)
	for _, entry := range m.moods {
		if entry.UserID == userID && strings.HasPrefix(entry.Date, month+"-") {
			items = append(items, cloneMoodEntry(entry))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Date < items[j].Date })
	return items, nil
}

func (m *Memory) ListAllMoodEntries(_ context.Context, userID string) ([]domain.MoodEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.MoodEntry, 0)
	for _, entry := range m.moods {
		if entry.UserID == userID {
			items = append(items, cloneMoodEntry(entry))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Date > items[j].Date })
	return items, nil
}

func (m *Memory) DeleteMoodEntry(_ context.Context, userID, date string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := moodKey(userID, date)
	if _, ok := m.moods[key]; !ok {
		return domain.ErrNotFound
	}
	delete(m.moods, key)
	return nil
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

func (m *Memory) DeleteTask(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.tasks[id]; !ok {
		return domain.ErrNotFound
	}
	delete(m.tasks, id)
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

func (m *Memory) CreateTodoList(_ context.Context, list domain.TodoList) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if list.Kind == domain.TodoListInbox {
		for _, existing := range m.todoLists {
			if existing.UserID == list.UserID && existing.Kind == domain.TodoListInbox {
				return domain.ErrConflict
			}
		}
	}
	m.todoLists[list.ID] = list
	return nil
}

func (m *Memory) TodoListByID(_ context.Context, id string) (domain.TodoList, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list, ok := m.todoLists[id]
	if !ok {
		return domain.TodoList{}, domain.ErrNotFound
	}
	return list, nil
}

func (m *Memory) DeleteTodoList(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.todoLists[id]; !ok {
		return domain.ErrNotFound
	}
	delete(m.todoLists, id)
	return nil
}

func (m *Memory) ListTodoLists(_ context.Context, userID string) ([]domain.TodoList, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.TodoList, 0)
	for _, list := range m.todoLists {
		if list.UserID == userID {
			items = append(items, list)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Kind == domain.TodoListInbox {
			return true
		}
		if items[j].Kind == domain.TodoListInbox {
			return false
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
	return items, nil
}

func (m *Memory) CreateTodo(_ context.Context, todo domain.TodoItem) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.todos[todo.ID] = cloneTodo(todo)
	return nil
}

func (m *Memory) TodoByID(_ context.Context, id string) (domain.TodoItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	todo, ok := m.todos[id]
	if !ok {
		return domain.TodoItem{}, domain.ErrNotFound
	}
	return cloneTodo(todo), nil
}

func (m *Memory) UpdateTodo(_ context.Context, todo domain.TodoItem) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.todos[todo.ID]; !ok {
		return domain.ErrNotFound
	}
	m.todos[todo.ID] = cloneTodo(todo)
	return nil
}

func (m *Memory) DeleteTodo(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.todos[id]; !ok {
		return domain.ErrNotFound
	}
	delete(m.todos, id)
	return nil
}

func (m *Memory) ListTodos(_ context.Context, userID string, filter TodoFilter) ([]domain.TodoItem, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.TodoItem, 0)
	for _, todo := range m.todos {
		if todo.UserID != userID || (filter.ListID != "" && todo.ListID != filter.ListID) || (filter.Status != "" && todo.Status != filter.Status) {
			continue
		}
		items = append(items, cloneTodo(todo))
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items, nil
}

func (m *Memory) CreateCalendarEvent(_ context.Context, event domain.CalendarEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calendarEvents[event.ID] = event
	return nil
}

func (m *Memory) CalendarEventByID(_ context.Context, id string) (domain.CalendarEvent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	event, ok := m.calendarEvents[id]
	if !ok {
		return domain.CalendarEvent{}, domain.ErrNotFound
	}
	return event, nil
}

func (m *Memory) UpdateCalendarEvent(_ context.Context, event domain.CalendarEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.calendarEvents[event.ID]; !ok {
		return domain.ErrNotFound
	}
	m.calendarEvents[event.ID] = event
	return nil
}

func (m *Memory) DeleteCalendarEvent(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.calendarEvents[id]; !ok {
		return domain.ErrNotFound
	}
	delete(m.calendarEvents, id)
	return nil
}

func (m *Memory) ListCalendarEvents(_ context.Context, userID string) ([]domain.CalendarEvent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.CalendarEvent, 0)
	for _, event := range m.calendarEvents {
		if event.UserID == userID {
			items = append(items, event)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].StartAt.Before(items[j].StartAt) })
	return items, nil
}

func (m *Memory) CreateWordBook(_ context.Context, book domain.WordBook) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if book.SourceID != "" {
		for _, existing := range m.wordBooks {
			if existing.UserID == book.UserID && existing.SourceID == book.SourceID {
				return domain.ErrConflict
			}
		}
	}
	m.wordBooks[book.ID] = book
	return nil
}

func (m *Memory) WordBookByID(_ context.Context, id string) (domain.WordBook, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	book, ok := m.wordBooks[id]
	if !ok {
		return domain.WordBook{}, domain.ErrNotFound
	}
	return book, nil
}

func (m *Memory) ListWordBooks(_ context.Context, userID string) ([]domain.WordBook, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.WordBook, 0)
	for _, book := range m.wordBooks {
		if book.UserID == userID {
			items = append(items, book)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	return items, nil
}

func (m *Memory) CreateVocabularyWord(_ context.Context, word domain.VocabularyWord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, existing := range m.words {
		if existing.UserID == word.UserID && existing.BookID == word.BookID && strings.EqualFold(existing.Term, word.Term) {
			return domain.ErrConflict
		}
	}
	m.words[word.ID] = cloneVocabularyWord(word)
	return nil
}

func (m *Memory) CreateVocabularyWords(_ context.Context, words []domain.VocabularyWord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	seen := make(map[string]struct{}, len(words))
	terms := make(map[string]struct{}, len(m.words)+len(words))
	for _, existing := range m.words {
		terms[existing.UserID+"\x00"+existing.BookID+"\x00"+strings.ToLower(existing.Term)] = struct{}{}
	}
	for _, word := range words {
		if _, exists := m.words[word.ID]; exists {
			return domain.ErrConflict
		}
		if _, exists := seen[word.ID]; exists {
			return domain.ErrConflict
		}
		seen[word.ID] = struct{}{}
		termKey := word.UserID + "\x00" + word.BookID + "\x00" + strings.ToLower(word.Term)
		if _, exists := terms[termKey]; exists {
			return domain.ErrConflict
		}
		terms[termKey] = struct{}{}
	}
	for _, word := range words {
		m.words[word.ID] = cloneVocabularyWord(word)
	}
	return nil
}

func (m *Memory) VocabularyWordByID(_ context.Context, id string) (domain.VocabularyWord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	word, ok := m.words[id]
	if !ok {
		return domain.VocabularyWord{}, domain.ErrNotFound
	}
	return cloneVocabularyWord(word), nil
}

func (m *Memory) DeleteVocabularyWord(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.words[id]; !ok {
		return domain.ErrNotFound
	}
	delete(m.words, id)
	for reviewID, review := range m.wordReviews {
		if review.WordID == id {
			delete(m.wordReviews, reviewID)
		}
	}
	return nil
}

func (m *Memory) ListVocabularyWords(_ context.Context, userID, bookID string) ([]domain.VocabularyWord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.VocabularyWord, 0)
	for _, word := range m.words {
		if word.UserID == userID && (bookID == "" || word.BookID == bookID) {
			items = append(items, cloneVocabularyWord(word))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].DueAt.Equal(items[j].DueAt) {
			if items[i].SourceRank != items[j].SourceRank {
				if items[i].SourceRank == 0 {
					return false
				}
				if items[j].SourceRank == 0 {
					return true
				}
				return items[i].SourceRank < items[j].SourceRank
			}
			return strings.ToLower(items[i].Term) < strings.ToLower(items[j].Term)
		}
		return items[i].DueAt.Before(items[j].DueAt)
	})
	return items, nil
}

func (m *Memory) ApplyVocabularyReview(_ context.Context, word domain.VocabularyWord, review domain.VocabularyReview) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.words[word.ID]; !ok {
		return domain.ErrNotFound
	}
	m.words[word.ID] = cloneVocabularyWord(word)
	m.wordReviews[review.ID] = review
	return nil
}

func (m *Memory) ListVocabularyReviews(_ context.Context, userID string, since time.Time) ([]domain.VocabularyReview, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.VocabularyReview, 0)
	for _, review := range m.wordReviews {
		if review.UserID == userID && !review.ReviewedAt.Before(since) {
			items = append(items, review)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ReviewedAt.After(items[j].ReviewedAt) })
	return items, nil
}

func (m *Memory) UpsertPlannerPreferences(_ context.Context, preferences domain.PlannerPreferences) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.plannerPrefs[preferences.UserID] = clonePlannerPreferences(preferences)
	return nil
}

func (m *Memory) PlannerPreferences(_ context.Context, userID string) (domain.PlannerPreferences, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	preferences, ok := m.plannerPrefs[userID]
	if !ok {
		return domain.PlannerPreferences{}, domain.ErrNotFound
	}
	return clonePlannerPreferences(preferences), nil
}

func (m *Memory) CreatePlanBlock(_ context.Context, block domain.StudyPlanBlock) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.planBlocks[block.ID]; exists {
		return domain.ErrConflict
	}
	m.planBlocks[block.ID] = block
	return nil
}

func (m *Memory) PlanBlockByID(_ context.Context, id string) (domain.StudyPlanBlock, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	block, ok := m.planBlocks[id]
	if !ok {
		return domain.StudyPlanBlock{}, domain.ErrNotFound
	}
	return block, nil
}

func (m *Memory) UpdatePlanBlock(_ context.Context, block domain.StudyPlanBlock) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.planBlocks[block.ID]; !ok {
		return domain.ErrNotFound
	}
	m.planBlocks[block.ID] = block
	return nil
}

func (m *Memory) DeletePlanBlock(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.planBlocks[id]; !ok {
		return domain.ErrNotFound
	}
	delete(m.planBlocks, id)
	return nil
}

func (m *Memory) ListPlanBlocks(_ context.Context, userID string, start, end time.Time) ([]domain.StudyPlanBlock, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.StudyPlanBlock, 0)
	for _, block := range m.planBlocks {
		if block.UserID == userID && block.StartAt.Before(end) && block.EndAt.After(start) {
			items = append(items, block)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].StartAt.Equal(items[j].StartAt) {
			return items[i].CreatedAt.Before(items[j].CreatedAt)
		}
		return items[i].StartAt.Before(items[j].StartAt)
	})
	return items, nil
}

func (m *Memory) ReplaceGeneratedPlanBlocks(_ context.Context, userID string, start, end time.Time, blocks []domain.StudyPlanBlock) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, block := range m.planBlocks {
		if block.UserID == userID && block.AutoGenerated && !block.Locked && block.StartAt.Before(end) && block.EndAt.After(start) && block.Status != domain.PlanBlockCompleted {
			delete(m.planBlocks, id)
		}
	}
	for _, block := range blocks {
		if _, exists := m.planBlocks[block.ID]; exists {
			return domain.ErrConflict
		}
		m.planBlocks[block.ID] = block
	}
	return nil
}

func (m *Memory) UpsertPlannerReport(_ context.Context, report domain.PlannerReport) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.plannerReports[plannerReportKey(report.UserID, report.WeekStart)] = clonePlannerReport(report)
	return nil
}

func (m *Memory) PlannerReport(_ context.Context, userID, weekStart string) (domain.PlannerReport, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	report, ok := m.plannerReports[plannerReportKey(userID, weekStart)]
	if !ok {
		return domain.PlannerReport{}, domain.ErrNotFound
	}
	return clonePlannerReport(report), nil
}

func (m *Memory) ListPlannerReports(_ context.Context, userID string) ([]domain.PlannerReport, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.PlannerReport, 0)
	for _, report := range m.plannerReports {
		if report.UserID == userID {
			items = append(items, clonePlannerReport(report))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].WeekStart > items[j].WeekStart })
	return items, nil
}

func (m *Memory) UpsertWeeklyReflection(_ context.Context, reflection domain.WeeklyReflection) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.weeklyReflections[weeklyReflectionKey(reflection.UserID, reflection.WeekStart)] = cloneWeeklyReflection(reflection)
	return nil
}

func (m *Memory) WeeklyReflection(_ context.Context, userID, weekStart string) (domain.WeeklyReflection, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	reflection, ok := m.weeklyReflections[weeklyReflectionKey(userID, weekStart)]
	if !ok {
		return domain.WeeklyReflection{}, domain.ErrNotFound
	}
	return cloneWeeklyReflection(reflection), nil
}

func (m *Memory) ListWeeklyReflections(_ context.Context, userID string) ([]domain.WeeklyReflection, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.WeeklyReflection, 0)
	for _, reflection := range m.weeklyReflections {
		if reflection.UserID == userID {
			items = append(items, cloneWeeklyReflection(reflection))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].WeekStart > items[j].WeekStart })
	return items, nil
}

func (m *Memory) CreateKnowledgeNote(_ context.Context, note domain.KnowledgeNote) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.knowledgeNotes[note.ID]; exists {
		return domain.ErrConflict
	}
	m.knowledgeNotes[note.ID] = cloneKnowledgeNote(note)
	return nil
}

func (m *Memory) KnowledgeNoteByID(_ context.Context, id string) (domain.KnowledgeNote, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	note, exists := m.knowledgeNotes[id]
	if !exists {
		return domain.KnowledgeNote{}, domain.ErrNotFound
	}
	return cloneKnowledgeNote(note), nil
}

func (m *Memory) UpdateKnowledgeNote(_ context.Context, note domain.KnowledgeNote) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.knowledgeNotes[note.ID]; !exists {
		return domain.ErrNotFound
	}
	m.knowledgeNotes[note.ID] = cloneKnowledgeNote(note)
	return nil
}

func (m *Memory) DeleteKnowledgeNote(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.knowledgeNotes[id]; !exists {
		return domain.ErrNotFound
	}
	delete(m.knowledgeNotes, id)
	return nil
}

func (m *Memory) ListKnowledgeNotes(_ context.Context, userID string) ([]domain.KnowledgeNote, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.KnowledgeNote, 0)
	for _, note := range m.knowledgeNotes {
		if note.UserID == userID {
			items = append(items, cloneKnowledgeNote(note))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Pinned != items[j].Pinned {
			return items[i].Pinned
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	return items, nil
}

func (m *Memory) CreateEnglishReading(_ context.Context, reading domain.EnglishReading) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.englishReadings[reading.ID]; exists {
		return domain.ErrConflict
	}
	m.englishReadings[reading.ID] = cloneEnglishReading(reading)
	return nil
}

func (m *Memory) EnglishReadingByID(_ context.Context, id string) (domain.EnglishReading, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	reading, exists := m.englishReadings[id]
	if !exists {
		return domain.EnglishReading{}, domain.ErrNotFound
	}
	return cloneEnglishReading(reading), nil
}

func (m *Memory) UpdateEnglishReading(_ context.Context, reading domain.EnglishReading) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.englishReadings[reading.ID]; !exists {
		return domain.ErrNotFound
	}
	m.englishReadings[reading.ID] = cloneEnglishReading(reading)
	return nil
}

func (m *Memory) DeleteEnglishReading(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.englishReadings[id]; !exists {
		return domain.ErrNotFound
	}
	delete(m.englishReadings, id)
	return nil
}

func (m *Memory) ListEnglishReadings(_ context.Context, userID string) ([]domain.EnglishReading, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.EnglishReading, 0)
	for _, reading := range m.englishReadings {
		if reading.UserID == userID {
			items = append(items, cloneEnglishReading(reading))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	return items, nil
}

func (m *Memory) CreateEBookReading(_ context.Context, reading domain.EBookReading) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.ebookReadings[reading.ID]; exists {
		return domain.ErrConflict
	}
	m.ebookReadings[reading.ID] = cloneEBookReading(reading)
	return nil
}

func (m *Memory) EBookReadingByID(_ context.Context, id string) (domain.EBookReading, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	reading, exists := m.ebookReadings[id]
	if !exists {
		return domain.EBookReading{}, domain.ErrNotFound
	}
	return cloneEBookReading(reading), nil
}

func (m *Memory) UpdateEBookReading(_ context.Context, reading domain.EBookReading) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.ebookReadings[reading.ID]; !exists {
		return domain.ErrNotFound
	}
	m.ebookReadings[reading.ID] = cloneEBookReading(reading)
	return nil
}

func (m *Memory) DeleteEBookReading(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.ebookReadings[id]; !exists {
		return domain.ErrNotFound
	}
	delete(m.ebookReadings, id)
	return nil
}

func (m *Memory) ListEBookReadings(_ context.Context, userID string) ([]domain.EBookReading, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.EBookReading, 0)
	for _, reading := range m.ebookReadings {
		if reading.UserID == userID {
			items = append(items, cloneEBookReading(reading))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	return items, nil
}

func (m *Memory) UpsertClassicalStudy(_ context.Context, study domain.ClassicalStudy) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.classicalStudies[classicalStudyKey(study.UserID, study.WorkID)] = study
	return nil
}

func (m *Memory) ClassicalStudyByWork(_ context.Context, userID, workID string) (domain.ClassicalStudy, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	study, exists := m.classicalStudies[classicalStudyKey(userID, workID)]
	if !exists {
		return domain.ClassicalStudy{}, domain.ErrNotFound
	}
	return study, nil
}

func (m *Memory) ListClassicalStudies(_ context.Context, userID string) ([]domain.ClassicalStudy, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := make([]domain.ClassicalStudy, 0)
	for _, study := range m.classicalStudies {
		if study.UserID == userID {
			items = append(items, study)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	return items, nil
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
	Version           int                         `json:"version"`
	SavedAt           time.Time                   `json:"saved_at"`
	Users             []persistedUser             `json:"users"`
	Goals             []domain.Goal               `json:"goals"`
	Moods             []domain.MoodEntry          `json:"moods"`
	Tasks             []domain.StudyTask          `json:"tasks"`
	TodoLists         []domain.TodoList           `json:"todo_lists"`
	Todos             []domain.TodoItem           `json:"todos"`
	CalendarEvents    []domain.CalendarEvent      `json:"calendar_events"`
	WordBooks         []domain.WordBook           `json:"word_books"`
	Words             []domain.VocabularyWord     `json:"vocabulary_words"`
	WordReviews       []domain.VocabularyReview   `json:"vocabulary_reviews"`
	PlannerPrefs      []domain.PlannerPreferences `json:"planner_preferences"`
	PlanBlocks        []domain.StudyPlanBlock     `json:"plan_blocks"`
	PlannerReports    []domain.PlannerReport      `json:"planner_reports"`
	WeeklyReflections []domain.WeeklyReflection   `json:"weekly_reflections"`
	KnowledgeNotes    []domain.KnowledgeNote      `json:"knowledge_notes"`
	EnglishReadings   []domain.EnglishReading     `json:"english_readings"`
	EBookReadings     []domain.EBookReading       `json:"ebook_readings"`
	ClassicalStudies  []domain.ClassicalStudy     `json:"classical_studies"`
	Sessions          []domain.FocusSession       `json:"focus_sessions"`
}

// SnapshotRecoveryError reports a recoverable snapshot failure. The caller may
// continue serving because LoadJSON has either restored the previous valid
// backup or quarantined the corrupt primary file and kept an empty store.
type SnapshotRecoveryError struct {
	Cause               error
	QuarantinedPath     string
	BackupPath          string
	RecoveredFromBackup bool
}

func (e *SnapshotRecoveryError) Error() string {
	if e.RecoveredFromBackup {
		return fmt.Sprintf("invalid data snapshot moved to %q; recovered from %q: %v", e.QuarantinedPath, e.BackupPath, e.Cause)
	}
	return fmt.Sprintf("invalid data snapshot moved to %q; no valid backup was available, starting with an empty store: %v", e.QuarantinedPath, e.Cause)
}

func (e *SnapshotRecoveryError) Unwrap() error { return e.Cause }

func (m *Memory) SaveJSON(path string) error {
	m.mu.RLock()
	s := snapshot{Version: 1, SavedAt: time.Now().UTC()}
	for _, item := range m.users {
		s.Users = append(s.Users, persistedUser{User: item, PasswordHash: item.PasswordHash})
	}
	for _, item := range m.goals {
		s.Goals = append(s.Goals, item)
	}
	for _, item := range m.moods {
		s.Moods = append(s.Moods, cloneMoodEntry(item))
	}
	for _, item := range m.tasks {
		s.Tasks = append(s.Tasks, cloneTask(item))
	}
	for _, item := range m.todoLists {
		s.TodoLists = append(s.TodoLists, item)
	}
	for _, item := range m.todos {
		s.Todos = append(s.Todos, cloneTodo(item))
	}
	for _, item := range m.calendarEvents {
		s.CalendarEvents = append(s.CalendarEvents, item)
	}
	for _, item := range m.wordBooks {
		s.WordBooks = append(s.WordBooks, item)
	}
	for _, item := range m.words {
		s.Words = append(s.Words, cloneVocabularyWord(item))
	}
	for _, item := range m.wordReviews {
		s.WordReviews = append(s.WordReviews, item)
	}
	for _, item := range m.plannerPrefs {
		s.PlannerPrefs = append(s.PlannerPrefs, clonePlannerPreferences(item))
	}
	for _, item := range m.planBlocks {
		s.PlanBlocks = append(s.PlanBlocks, item)
	}
	for _, item := range m.plannerReports {
		s.PlannerReports = append(s.PlannerReports, clonePlannerReport(item))
	}
	for _, item := range m.weeklyReflections {
		s.WeeklyReflections = append(s.WeeklyReflections, cloneWeeklyReflection(item))
	}
	for _, item := range m.knowledgeNotes {
		s.KnowledgeNotes = append(s.KnowledgeNotes, cloneKnowledgeNote(item))
	}
	for _, item := range m.englishReadings {
		s.EnglishReadings = append(s.EnglishReadings, cloneEnglishReading(item))
	}
	for _, item := range m.ebookReadings {
		s.EBookReadings = append(s.EBookReadings, cloneEBookReading(item))
	}
	for _, item := range m.classicalStudies {
		s.ClassicalStudies = append(s.ClassicalStudies, item)
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
	if previous, err := os.ReadFile(path); err == nil {
		if _, validateErr := decodeSnapshot(previous); validateErr == nil {
			if err := writeSnapshotFile(path+".bak", previous); err != nil {
				return fmt.Errorf("save previous snapshot backup: %w", err)
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return writeSnapshotFile(path, data)
}

func (m *Memory) LoadJSON(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	s, primaryErr := decodeSnapshot(data)
	var recoveryErr *SnapshotRecoveryError
	if primaryErr != nil {
		backupPath := path + ".bak"
		backupData, backupReadErr := os.ReadFile(backupPath)
		if backupReadErr != nil && !errors.Is(backupReadErr, os.ErrNotExist) {
			return fmt.Errorf("read snapshot backup: %w", backupReadErr)
		}
		if backupReadErr == nil {
			if backup, backupErr := decodeSnapshot(backupData); backupErr == nil {
				s = backup
				recoveryErr = &SnapshotRecoveryError{Cause: primaryErr, BackupPath: backupPath, RecoveredFromBackup: true}
			}
		}
		quarantinedPath, quarantineErr := quarantineSnapshot(path)
		if quarantineErr != nil {
			return fmt.Errorf("quarantine invalid data snapshot: %w", quarantineErr)
		}
		if recoveryErr == nil {
			return &SnapshotRecoveryError{Cause: primaryErr, QuarantinedPath: quarantinedPath}
		}
		recoveryErr.QuarantinedPath = quarantinedPath
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.users = make(map[string]domain.User, len(s.Users))
	m.emails = make(map[string]string, len(s.Users))
	m.goals = make(map[string]domain.Goal, len(s.Goals))
	m.moods = make(map[string]domain.MoodEntry, len(s.Moods))
	m.tasks = make(map[string]domain.StudyTask, len(s.Tasks))
	m.todoLists = make(map[string]domain.TodoList, len(s.TodoLists))
	m.todos = make(map[string]domain.TodoItem, len(s.Todos))
	m.calendarEvents = make(map[string]domain.CalendarEvent, len(s.CalendarEvents))
	m.wordBooks = make(map[string]domain.WordBook, len(s.WordBooks))
	m.words = make(map[string]domain.VocabularyWord, len(s.Words))
	m.wordReviews = make(map[string]domain.VocabularyReview, len(s.WordReviews))
	m.plannerPrefs = make(map[string]domain.PlannerPreferences, len(s.PlannerPrefs))
	m.planBlocks = make(map[string]domain.StudyPlanBlock, len(s.PlanBlocks))
	m.plannerReports = make(map[string]domain.PlannerReport, len(s.PlannerReports))
	m.weeklyReflections = make(map[string]domain.WeeklyReflection, len(s.WeeklyReflections))
	m.knowledgeNotes = make(map[string]domain.KnowledgeNote, len(s.KnowledgeNotes))
	m.englishReadings = make(map[string]domain.EnglishReading, len(s.EnglishReadings))
	m.ebookReadings = make(map[string]domain.EBookReading, len(s.EBookReadings))
	m.classicalStudies = make(map[string]domain.ClassicalStudy, len(s.ClassicalStudies))
	m.sessions = make(map[string]domain.FocusSession, len(s.Sessions))
	for _, record := range s.Users {
		record.User.PasswordHash = record.PasswordHash
		m.users[record.ID] = record.User
		m.emails[strings.ToLower(record.Email)] = record.ID
	}
	for _, item := range s.Goals {
		m.goals[item.ID] = item
	}
	for _, item := range s.Moods {
		m.moods[moodKey(item.UserID, item.Date)] = cloneMoodEntry(item)
	}
	for _, item := range s.Tasks {
		m.tasks[item.ID] = cloneTask(item)
	}
	for _, item := range s.TodoLists {
		m.todoLists[item.ID] = item
	}
	for _, item := range s.Todos {
		m.todos[item.ID] = cloneTodo(item)
	}
	for _, item := range s.CalendarEvents {
		m.calendarEvents[item.ID] = item
	}
	for _, item := range s.WordBooks {
		m.wordBooks[item.ID] = item
	}
	for _, item := range s.Words {
		m.words[item.ID] = cloneVocabularyWord(item)
	}
	for _, item := range s.WordReviews {
		m.wordReviews[item.ID] = item
	}
	for _, item := range s.PlannerPrefs {
		m.plannerPrefs[item.UserID] = clonePlannerPreferences(item)
	}
	for _, item := range s.PlanBlocks {
		if item.Kind == domain.PlanBlockKind("review") {
			continue
		}
		m.planBlocks[item.ID] = item
	}
	for _, item := range s.PlannerReports {
		m.plannerReports[plannerReportKey(item.UserID, item.WeekStart)] = clonePlannerReport(item)
	}
	for _, item := range s.WeeklyReflections {
		m.weeklyReflections[weeklyReflectionKey(item.UserID, item.WeekStart)] = cloneWeeklyReflection(item)
	}
	for _, item := range s.KnowledgeNotes {
		m.knowledgeNotes[item.ID] = cloneKnowledgeNote(item)
	}
	for _, item := range s.EnglishReadings {
		m.englishReadings[item.ID] = cloneEnglishReading(item)
	}
	for _, item := range s.EBookReadings {
		m.ebookReadings[item.ID] = cloneEBookReading(item)
	}
	for _, item := range s.ClassicalStudies {
		m.classicalStudies[classicalStudyKey(item.UserID, item.WorkID)] = item
	}
	for _, item := range s.Sessions {
		m.sessions[item.ID] = normalizeFocusSession(item)
	}
	if recoveryErr != nil {
		return recoveryErr
	}
	return nil
}

func decodeSnapshot(data []byte) (snapshot, error) {
	var value snapshot
	if err := json.Unmarshal(data, &value); err != nil {
		return snapshot{}, err
	}
	if value.Version != 1 {
		return snapshot{}, errors.New("unsupported snapshot version")
	}
	return value, nil
}

func quarantineSnapshot(path string) (string, error) {
	quarantinedPath := path + ".corrupt-" + time.Now().UTC().Format("20060102T150405.000000000Z")
	if err := os.Rename(path, quarantinedPath); err != nil {
		return "", err
	}
	return quarantinedPath, nil
}

func writeSnapshotFile(path string, data []byte) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, "."+filepath.Base(path)+"-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if _, err := decodeSnapshot(data); err != nil {
		return fmt.Errorf("refuse to write invalid snapshot: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err == nil {
		return nil
	}
	displacedPath := path + ".replace-" + time.Now().UTC().Format("20060102T150405.000000000Z")
	if err := os.Rename(path, displacedPath); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Rename(displacedPath, path)
		return err
	}
	_ = os.Remove(displacedPath)
	return nil
}

func cloneTask(task domain.StudyTask) domain.StudyTask {
	task.Tags = append([]string(nil), task.Tags...)
	return task
}

func cloneTodo(todo domain.TodoItem) domain.TodoItem {
	todo.Tags = append([]string(nil), todo.Tags...)
	todo.Steps = append([]domain.TodoStep(nil), todo.Steps...)
	return todo
}

func cloneVocabularyWord(word domain.VocabularyWord) domain.VocabularyWord {
	word.Tags = append([]string(nil), word.Tags...)
	return word
}

func clonePlannerPreferences(preferences domain.PlannerPreferences) domain.PlannerPreferences {
	preferences.Windows = append([]domain.AvailabilityWindow(nil), preferences.Windows...)
	return preferences
}

func clonePlannerReport(report domain.PlannerReport) domain.PlannerReport {
	report.Unscheduled = append([]domain.UnscheduledPlanItem(nil), report.Unscheduled...)
	return report
}

func cloneWeeklyReflection(reflection domain.WeeklyReflection) domain.WeeklyReflection {
	reflection.NextWeekPriorities = append([]string(nil), reflection.NextWeekPriorities...)
	return reflection
}

func cloneKnowledgeNote(note domain.KnowledgeNote) domain.KnowledgeNote {
	note.Tags = append([]string(nil), note.Tags...)
	return note
}

func cloneEnglishReading(reading domain.EnglishReading) domain.EnglishReading {
	reading.NewWords = append([]string(nil), reading.NewWords...)
	return reading
}

func cloneEBookReading(reading domain.EBookReading) domain.EBookReading {
	reading.Book.Authors = append([]string(nil), reading.Book.Authors...)
	reading.Book.Subjects = append([]string(nil), reading.Book.Subjects...)
	reading.Bookmarks = append([]domain.EBookBookmark(nil), reading.Bookmarks...)
	reading.Notes = append([]domain.EBookNote(nil), reading.Notes...)
	return reading
}

func classicalStudyKey(userID, workID string) string { return userID + "\x00" + workID }

func weeklyReflectionKey(userID, weekStart string) string {
	return userID + "\x00" + weekStart
}

func plannerReportKey(userID, weekStart string) string {
	return userID + "\x00" + weekStart
}

func moodKey(userID, date string) string {
	return userID + "\x00" + date
}

func cloneMoodEntry(entry domain.MoodEntry) domain.MoodEntry {
	entry.Activities = append([]string(nil), entry.Activities...)
	entry.Tags = append([]string(nil), entry.Tags...)
	return entry
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
