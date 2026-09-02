package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

const exportSchemaVersion = 1

type UserDataExport struct {
	SchemaVersion      int                       `json:"schema_version"`
	ExportedAt         time.Time                 `json:"exported_at"`
	Application        string                    `json:"application"`
	User               domain.User               `json:"user"`
	Counts             map[string]int            `json:"counts"`
	Goals              []domain.Goal             `json:"goals"`
	Moods              []domain.MoodEntry        `json:"moods"`
	Tasks              []domain.StudyTask        `json:"tasks"`
	TodoLists          []domain.TodoList         `json:"todo_lists"`
	Todos              []domain.TodoItem         `json:"todos"`
	CalendarEvents     []domain.CalendarEvent    `json:"calendar_events"`
	WordBooks          []domain.WordBook         `json:"word_books"`
	VocabularyWords    []domain.VocabularyWord   `json:"vocabulary_words"`
	VocabularyReviews  []domain.VocabularyReview `json:"vocabulary_reviews"`
	PlannerPreferences domain.PlannerPreferences `json:"planner_preferences"`
	PlanBlocks         []domain.StudyPlanBlock   `json:"plan_blocks"`
	PlannerReports     []domain.PlannerReport    `json:"planner_reports"`
	WeeklyReflections  []domain.WeeklyReflection `json:"weekly_reflections"`
	EnglishReadings    []domain.EnglishReading   `json:"english_readings"`
	EBookReadings      []domain.EBookReading     `json:"ebook_readings"`
	ClassicalStudies   []domain.ClassicalStudy   `json:"classical_studies"`
	Decks              []domain.Deck             `json:"decks"`
	Cards              []domain.Card             `json:"cards"`
	Reviews            []domain.Review           `json:"reviews"`
	FocusSessions      []domain.FocusSession     `json:"focus_sessions"`
}

func (s *Service) ExportUserData(ctx context.Context, userID string) (UserDataExport, error) {
	bundle := UserDataExport{SchemaVersion: exportSchemaVersion, ExportedAt: s.now().UTC(), Application: "StudyFlow", Counts: map[string]int{}}
	var err error
	if bundle.User, err = s.repo.UserByID(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.Goals, err = s.repo.ListGoals(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.Moods, err = s.repo.ListAllMoodEntries(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.Tasks, err = s.repo.ListTasks(ctx, userID, store.TaskFilter{}); err != nil {
		return UserDataExport{}, err
	}
	if bundle.TodoLists, err = s.repo.ListTodoLists(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.Todos, err = s.repo.ListTodos(ctx, userID, store.TodoFilter{}); err != nil {
		return UserDataExport{}, err
	}
	if bundle.CalendarEvents, err = s.repo.ListCalendarEvents(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.WordBooks, err = s.repo.ListWordBooks(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.VocabularyWords, err = s.repo.ListVocabularyWords(ctx, userID, ""); err != nil {
		return UserDataExport{}, err
	}
	if bundle.VocabularyReviews, err = s.repo.ListVocabularyReviews(ctx, userID, time.Time{}); err != nil {
		return UserDataExport{}, err
	}
	if bundle.PlannerPreferences, err = s.PlannerPreferences(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.PlanBlocks, err = s.repo.ListPlanBlocks(ctx, userID, time.Time{}, time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)); err != nil {
		return UserDataExport{}, err
	}
	if bundle.PlannerReports, err = s.repo.ListPlannerReports(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.WeeklyReflections, err = s.repo.ListWeeklyReflections(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.EnglishReadings, err = s.repo.ListEnglishReadings(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.EBookReadings, err = s.repo.ListEBookReadings(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.ClassicalStudies, err = s.repo.ListClassicalStudies(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.Decks, err = s.repo.ListDecks(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.Cards, err = s.repo.ListCards(ctx, userID); err != nil {
		return UserDataExport{}, err
	}
	if bundle.Reviews, err = s.repo.ListReviews(ctx, userID, time.Time{}); err != nil {
		return UserDataExport{}, err
	}
	if bundle.FocusSessions, err = s.repo.ListFocusSessions(ctx, userID, time.Time{}); err != nil {
		return UserDataExport{}, err
	}
	bundle.Counts = map[string]int{
		"goals": len(bundle.Goals), "moods": len(bundle.Moods), "tasks": len(bundle.Tasks), "todo_lists": len(bundle.TodoLists),
		"todos": len(bundle.Todos), "calendar_events": len(bundle.CalendarEvents), "word_books": len(bundle.WordBooks), "vocabulary_words": len(bundle.VocabularyWords),
		"vocabulary_reviews": len(bundle.VocabularyReviews), "plan_blocks": len(bundle.PlanBlocks), "weekly_reflections": len(bundle.WeeklyReflections),
		"english_readings": len(bundle.EnglishReadings),
		"ebook_readings":   len(bundle.EBookReadings), "classical_studies": len(bundle.ClassicalStudies),
		"decks": len(bundle.Decks), "cards": len(bundle.Cards), "reviews": len(bundle.Reviews), "focus_sessions": len(bundle.FocusSessions),
	}
	return bundle, nil
}

func (s *Service) ExportLearningCSV(ctx context.Context, userID string, days int, timeZone string) ([]byte, error) {
	insights, err := s.LearningInsights(ctx, userID, days, timeZone)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	buffer.Write([]byte{0xEF, 0xBB, 0xBF}) // UTF-8 BOM keeps Chinese spreadsheet imports readable.
	writer := csv.NewWriter(&buffer)
	_ = writer.Write([]string{"date", "focus_minutes", "focus_sessions", "planned_minutes", "completed_plan_minutes", "plan_adherence_percent", "tasks_completed", "todos_completed", "card_reviews", "card_accuracy_percent", "vocabulary_reviews", "vocabulary_accuracy_percent", "mood_score", "stress", "energy"})
	for _, day := range insights.Daily {
		_ = writer.Write([]string{
			day.Date, strconv.Itoa(day.FocusMinutes), strconv.Itoa(day.FocusSessions), strconv.Itoa(day.PlannedMinutes), strconv.Itoa(day.CompletedPlanMinutes),
			formatDecimal(day.PlanAdherence), strconv.Itoa(day.TasksCompleted), strconv.Itoa(day.TodosCompleted), strconv.Itoa(day.CardReviews), formatDecimal(day.CardAccuracy),
			strconv.Itoa(day.VocabularyReviews), formatDecimal(day.VocabularyAccuracy), strconv.Itoa(day.MoodScore), strconv.Itoa(day.Stress), strconv.Itoa(day.Energy),
		})
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func (s *Service) ExportPlanCalendar(ctx context.Context, userID, weekStart string) ([]byte, string, error) {
	week, err := s.PlanWeek(ctx, userID, weekStart)
	if err != nil {
		return nil, "", err
	}
	blocks := append([]domain.StudyPlanBlock(nil), week.Blocks...)
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].StartAt.Before(blocks[j].StartAt) })
	lines := []string{"BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StudyFlow//Learning Planner//ZH-CN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:StudyFlow 学习计划"}
	stamp := s.now().UTC().Format("20060102T150405Z")
	for _, block := range blocks {
		if block.Status == domain.PlanBlockSkipped {
			continue
		}
		description := block.Notes
		if block.Rationale != "" {
			if description != "" {
				description += "\n"
			}
			description += "安排依据：" + block.Rationale
		}
		lines = append(lines,
			"BEGIN:VEVENT", "UID:"+icsEscape(block.ID)+"@studyflow.local", "DTSTAMP:"+stamp,
			"DTSTART:"+block.StartAt.UTC().Format("20060102T150405Z"), "DTEND:"+block.EndAt.UTC().Format("20060102T150405Z"),
			"SUMMARY:"+icsEscape(block.Title), "DESCRIPTION:"+icsEscape(description), "CATEGORIES:"+icsEscape(string(block.Kind)),
			"STATUS:"+icsStatus(block.Status), "END:VEVENT",
		)
	}
	lines = append(lines, "END:VCALENDAR")
	for index := range lines {
		lines[index] = foldICSLine(lines[index])
	}
	return []byte(strings.Join(lines, "\r\n") + "\r\n"), "studyflow-plan-" + week.WeekStart + ".ics", nil
}

func formatDecimal(value float64) string { return strconv.FormatFloat(value, 'f', 1, 64) }

func icsStatus(status domain.PlanBlockStatus) string {
	if status == domain.PlanBlockCompleted {
		return "COMPLETED"
	}
	if status == domain.PlanBlockDoing {
		return "IN-PROCESS"
	}
	return "CONFIRMED"
}

func icsEscape(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\r\n", "\\n")
	value = strings.ReplaceAll(value, "\n", "\\n")
	value = strings.ReplaceAll(value, ";", "\\;")
	return strings.ReplaceAll(value, ",", "\\,")
}

func foldICSLine(value string) string {
	const limit = 73
	if len(value) <= limit {
		return value
	}
	var result strings.Builder
	lineBytes := 0
	for len(value) > 0 {
		r, size := utf8.DecodeRuneInString(value)
		if lineBytes > 0 && lineBytes+size > limit {
			result.WriteString("\r\n ")
			lineBytes = 1
		}
		result.WriteRune(r)
		lineBytes += size
		value = value[size:]
	}
	return result.String()
}
