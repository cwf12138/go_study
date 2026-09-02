package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/store"
)

const defaultPlannerTimeZone = "Asia/Shanghai"

type SavePlannerPreferencesInput struct {
	TimeZone        string
	SessionMinutes  int
	BreakMinutes    int
	DailyMaxMinutes int
	Windows         []domain.AvailabilityWindow
}

type CreatePlanBlockInput struct {
	Kind     domain.PlanBlockKind
	SourceID string
	Title    string
	Notes    string
	StartAt  time.Time
	EndAt    time.Time
	Priority domain.TaskPriority
	Locked   bool
}

type UpdatePlanBlockInput struct {
	Title    *string
	Notes    *string
	StartAt  *time.Time
	EndAt    *time.Time
	Priority *domain.TaskPriority
	Locked   *bool
}

type planCandidate struct {
	Kind       domain.PlanBlockKind
	SourceID   string
	Title      string
	Notes      string
	Minutes    int
	Priority   domain.TaskPriority
	EarliestAt time.Time
	DueAt      time.Time
	HasDueAt   bool
	Rationale  string
	Score      int
}

type plannerSlot struct {
	Start time.Time
	End   time.Time
}

func DefaultPlannerPreferences(userID string, now time.Time) domain.PlannerPreferences {
	windows := make([]domain.AvailabilityWindow, 0, 9)
	for weekday := 1; weekday <= 5; weekday++ {
		windows = append(windows, domain.AvailabilityWindow{Weekday: weekday, StartTime: "19:00", EndTime: "22:00"})
	}
	for weekday := 6; weekday <= 7; weekday++ {
		windows = append(windows,
			domain.AvailabilityWindow{Weekday: weekday, StartTime: "09:00", EndTime: "12:00"},
			domain.AvailabilityWindow{Weekday: weekday, StartTime: "14:00", EndTime: "18:00"},
		)
	}
	return domain.PlannerPreferences{
		UserID: userID, TimeZone: defaultPlannerTimeZone, SessionMinutes: 50,
		BreakMinutes: 10, DailyMaxMinutes: 180, Windows: windows, UpdatedAt: now.UTC(),
	}
}

func (s *Service) PlannerPreferences(ctx context.Context, userID string) (domain.PlannerPreferences, error) {
	preferences, err := s.repo.PlannerPreferences(ctx, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return DefaultPlannerPreferences(userID, s.now()), nil
	}
	return preferences, err
}

func (s *Service) SavePlannerPreferences(ctx context.Context, userID string, input SavePlannerPreferencesInput) (domain.PlannerPreferences, error) {
	preferences := domain.PlannerPreferences{
		UserID: userID, TimeZone: strings.TrimSpace(input.TimeZone), SessionMinutes: input.SessionMinutes,
		BreakMinutes: input.BreakMinutes, DailyMaxMinutes: input.DailyMaxMinutes,
		Windows: append([]domain.AvailabilityWindow(nil), input.Windows...), UpdatedAt: s.now().UTC(),
	}
	if preferences.TimeZone == "" {
		preferences.TimeZone = defaultPlannerTimeZone
	}
	if err := validatePlannerPreferences(preferences); err != nil {
		return domain.PlannerPreferences{}, err
	}
	sort.Slice(preferences.Windows, func(i, j int) bool {
		if preferences.Windows[i].Weekday != preferences.Windows[j].Weekday {
			return preferences.Windows[i].Weekday < preferences.Windows[j].Weekday
		}
		return preferences.Windows[i].StartTime < preferences.Windows[j].StartTime
	})
	if err := s.repo.UpsertPlannerPreferences(ctx, preferences); err != nil {
		return domain.PlannerPreferences{}, err
	}
	s.publish("planner.preferences_updated", userID, userID, nil)
	return preferences, nil
}

func validatePlannerPreferences(preferences domain.PlannerPreferences) error {
	if _, err := time.LoadLocation(preferences.TimeZone); err != nil {
		return fmt.Errorf("%w: unsupported time_zone", domain.ErrInvalidInput)
	}
	if preferences.SessionMinutes < 15 || preferences.SessionMinutes > 180 {
		return fmt.Errorf("%w: session_minutes must be between 15 and 180", domain.ErrInvalidInput)
	}
	if preferences.BreakMinutes < 0 || preferences.BreakMinutes > 60 {
		return fmt.Errorf("%w: break_minutes must be between 0 and 60", domain.ErrInvalidInput)
	}
	if preferences.DailyMaxMinutes < 30 || preferences.DailyMaxMinutes > 720 {
		return fmt.Errorf("%w: daily_max_minutes must be between 30 and 720", domain.ErrInvalidInput)
	}
	if len(preferences.Windows) == 0 || len(preferences.Windows) > 28 {
		return fmt.Errorf("%w: provide between 1 and 28 availability windows", domain.ErrInvalidInput)
	}
	byDay := make(map[int][][2]int)
	for _, window := range preferences.Windows {
		if window.Weekday < 1 || window.Weekday > 7 {
			return fmt.Errorf("%w: weekday must be between 1 and 7", domain.ErrInvalidInput)
		}
		start, err := parseClockMinutes(window.StartTime)
		if err != nil {
			return err
		}
		end, err := parseClockMinutes(window.EndTime)
		if err != nil {
			return err
		}
		if end <= start {
			return fmt.Errorf("%w: availability end_time must be after start_time", domain.ErrInvalidInput)
		}
		byDay[window.Weekday] = append(byDay[window.Weekday], [2]int{start, end})
	}
	for _, windows := range byDay {
		sort.Slice(windows, func(i, j int) bool { return windows[i][0] < windows[j][0] })
		for index := 1; index < len(windows); index++ {
			if windows[index][0] < windows[index-1][1] {
				return fmt.Errorf("%w: availability windows cannot overlap", domain.ErrInvalidInput)
			}
		}
	}
	return nil
}

func parseClockMinutes(value string) (int, error) {
	parsed, err := time.Parse("15:04", strings.TrimSpace(value))
	if err != nil {
		return 0, fmt.Errorf("%w: time values must use HH:MM", domain.ErrInvalidInput)
	}
	return parsed.Hour()*60 + parsed.Minute(), nil
}

func (s *Service) PlanWeek(ctx context.Context, userID, weekValue string) (domain.PlanWeek, error) {
	preferences, err := s.PlannerPreferences(ctx, userID)
	if err != nil {
		return domain.PlanWeek{}, err
	}
	weekStart, weekEnd, location, err := plannerWeekRange(weekValue, preferences.TimeZone, s.now())
	if err != nil {
		return domain.PlanWeek{}, err
	}
	blocks, err := s.repo.ListPlanBlocks(ctx, userID, weekStart.UTC(), weekEnd.UTC())
	if err != nil {
		return domain.PlanWeek{}, err
	}
	var unscheduled []domain.UnscheduledPlanItem
	overdueSources := 0
	var generatedAt *time.Time
	report, reportErr := s.repo.PlannerReport(ctx, userID, weekStart.Format("2006-01-02"))
	if reportErr == nil {
		unscheduled = report.Unscheduled
		overdueSources = report.OverdueSources
		generatedAt = &report.GeneratedAt
	} else if !errors.Is(reportErr, domain.ErrNotFound) {
		return domain.PlanWeek{}, reportErr
	}
	return buildPlanWeek(preferences, weekStart, weekEnd, location, blocks, unscheduled, overdueSources, generatedAt), nil
}

func (s *Service) GeneratePlanWeek(ctx context.Context, userID, weekValue string) (domain.PlanWeek, error) {
	preferences, err := s.PlannerPreferences(ctx, userID)
	if err != nil {
		return domain.PlanWeek{}, err
	}
	weekStart, weekEnd, location, err := plannerWeekRange(weekValue, preferences.TimeZone, s.now())
	if err != nil {
		return domain.PlanWeek{}, err
	}
	existing, err := s.repo.ListPlanBlocks(ctx, userID, weekStart.UTC(), weekEnd.UTC())
	if err != nil {
		return domain.PlanWeek{}, err
	}
	fixed := make([]domain.StudyPlanBlock, 0, len(existing))
	for _, block := range existing {
		if !block.AutoGenerated || block.Locked || block.Status == domain.PlanBlockCompleted {
			fixed = append(fixed, block)
		}
	}
	candidates, overdueSources, err := s.planCandidates(ctx, userID, weekStart, weekEnd, location, fixed)
	if err != nil {
		return domain.PlanWeek{}, err
	}
	generated, unscheduled := s.scheduleCandidates(userID, preferences, weekStart, weekEnd, location, fixed, candidates)
	if err := s.repo.ReplaceGeneratedPlanBlocks(ctx, userID, weekStart.UTC(), weekEnd.UTC(), generated); err != nil {
		return domain.PlanWeek{}, err
	}
	generatedAt := s.now().UTC()
	report := domain.PlannerReport{UserID: userID, WeekStart: weekStart.Format("2006-01-02"), Unscheduled: unscheduled, OverdueSources: overdueSources, GeneratedAt: generatedAt}
	if err := s.repo.UpsertPlannerReport(ctx, report); err != nil {
		return domain.PlanWeek{}, err
	}
	blocks, err := s.repo.ListPlanBlocks(ctx, userID, weekStart.UTC(), weekEnd.UTC())
	if err != nil {
		return domain.PlanWeek{}, err
	}
	s.publish("planner.week_generated", userID, weekStart.Format("2006-01-02"), map[string]any{"blocks": len(generated), "unscheduled": len(unscheduled)})
	return buildPlanWeek(preferences, weekStart, weekEnd, location, blocks, unscheduled, overdueSources, &generatedAt), nil
}

func plannerWeekRange(value, timeZone string, now time.Time) (time.Time, time.Time, *time.Location, error) {
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		return time.Time{}, time.Time{}, nil, fmt.Errorf("%w: unsupported planner time zone", domain.ErrInvalidInput)
	}
	var selected time.Time
	if strings.TrimSpace(value) == "" {
		selected = now.In(location)
	} else {
		selected, err = time.ParseInLocation("2006-01-02", value, location)
		if err != nil {
			return time.Time{}, time.Time{}, nil, fmt.Errorf("%w: week_start must use YYYY-MM-DD", domain.ErrInvalidInput)
		}
	}
	selected = time.Date(selected.Year(), selected.Month(), selected.Day(), 0, 0, 0, 0, location)
	isoWeekday := (int(selected.Weekday())+6)%7 + 1
	weekStart := selected.AddDate(0, 0, -(isoWeekday - 1))
	return weekStart, weekStart.AddDate(0, 0, 7), location, nil
}

func (s *Service) planCandidates(ctx context.Context, userID string, weekStart, weekEnd time.Time, location *time.Location, fixed []domain.StudyPlanBlock) ([]planCandidate, int, error) {
	plannedBySource := make(map[string]int)
	for _, block := range fixed {
		if block.Status == domain.PlanBlockSkipped {
			continue
		}
		plannedBySource[planSourceKey(block.Kind, block.SourceID)] += block.PlannedMinutes
	}
	now := s.now().In(location)
	candidates := make([]planCandidate, 0)
	overdue := make(map[string]struct{})
	tasks, err := s.repo.ListTasks(ctx, userID, store.TaskFilter{})
	if err != nil {
		return nil, 0, err
	}
	for _, task := range tasks {
		if task.Status == domain.TaskDone || task.Status == domain.TaskCancelled {
			continue
		}
		minutes := task.EstimatedMinutes
		if minutes <= 0 {
			minutes = 50
		}
		minutes -= plannedBySource[planSourceKey(domain.PlanBlockTask, task.ID)]
		if minutes <= 0 {
			continue
		}
		candidate := planCandidate{Kind: domain.PlanBlockTask, SourceID: task.ID, Title: task.Title, Notes: task.Description, Minutes: minutes, Priority: task.Priority, EarliestAt: weekStart, Rationale: "根据任务优先级、预计时长与截止时间安排"}
		if task.DueAt != nil {
			candidate.DueAt = task.DueAt.In(location)
			candidate.HasDueAt = true
			if candidate.DueAt.Before(now) {
				overdue[planSourceKey(candidate.Kind, candidate.SourceID)] = struct{}{}
			}
		}
		candidate.Score = plannerCandidateScore(candidate, now)
		candidates = append(candidates, candidate)
	}
	todos, err := s.repo.ListTodos(ctx, userID, store.TodoFilter{})
	if err != nil {
		return nil, 0, err
	}
	for _, todo := range todos {
		if todo.Status == domain.TodoCompleted {
			continue
		}
		minutes := estimateTodoMinutes(todo) - plannedBySource[planSourceKey(domain.PlanBlockTodo, todo.ID)]
		if minutes <= 0 {
			continue
		}
		candidate := planCandidate{Kind: domain.PlanBlockTodo, SourceID: todo.ID, Title: todo.Title, Notes: todo.Notes, Minutes: minutes, Priority: todo.Priority, EarliestAt: weekStart, Rationale: "根据待办优先级、步骤数量与日期安排"}
		if todo.DueAt != nil {
			candidate.DueAt = todo.DueAt.In(location)
			candidate.HasDueAt = true
		} else if todo.MyDayDate != "" {
			day, parseErr := time.ParseInLocation("2006-01-02", todo.MyDayDate, location)
			if parseErr == nil {
				candidate.DueAt = day.Add(23*time.Hour + 59*time.Minute)
				candidate.HasDueAt = true
			}
		}
		if candidate.HasDueAt && candidate.DueAt.Before(now) {
			overdue[planSourceKey(candidate.Kind, candidate.SourceID)] = struct{}{}
		}
		candidate.Score = plannerCandidateScore(candidate, now)
		candidates = append(candidates, candidate)
	}
	words, err := s.repo.ListVocabularyWords(ctx, userID, "")
	if err != nil {
		return nil, 0, err
	}
	wordBooks, err := s.repo.ListWordBooks(ctx, userID)
	if err != nil {
		return nil, 0, err
	}
	candidates = append(candidates, aggregateVocabularyCandidates(words, wordBooks, weekStart, weekEnd, location, plannedBySource)...)
	for index := range candidates {
		if candidates[index].Score == 0 {
			candidates[index].Score = plannerCandidateScore(candidates[index], now)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		if candidates[i].HasDueAt != candidates[j].HasDueAt {
			return candidates[i].HasDueAt
		}
		if candidates[i].HasDueAt && !candidates[i].DueAt.Equal(candidates[j].DueAt) {
			return candidates[i].DueAt.Before(candidates[j].DueAt)
		}
		return candidates[i].Title < candidates[j].Title
	})
	return candidates, len(overdue), nil
}

func estimateTodoMinutes(todo domain.TodoItem) int {
	remainingSteps := 0
	for _, step := range todo.Steps {
		if !step.Completed {
			remainingSteps++
		}
	}
	if remainingSteps > 0 {
		return min(90, max(20, remainingSteps*15))
	}
	return 25
}

func plannerCandidateScore(candidate planCandidate, now time.Time) int {
	score := map[domain.TaskPriority]int{domain.PriorityHigh: 300, domain.PriorityMedium: 180, domain.PriorityLow: 80}[candidate.Priority]
	if candidate.Kind == domain.PlanBlockVocabulary {
		score += 220
	}
	if !candidate.HasDueAt {
		return score
	}
	days := int(math.Floor(candidate.DueAt.Sub(now).Hours() / 24))
	if days < 0 {
		return score + 1200 + min(300, -days*30)
	}
	return score + max(0, 600-days*60)
}

func aggregateVocabularyCandidates(words []domain.VocabularyWord, books []domain.WordBook, weekStart, weekEnd time.Time, location *time.Location, planned map[string]int) []planCandidate {
	reviewCounts := make(map[string]int)
	newCounts := make(map[string]int)
	for _, word := range words {
		if word.DueAt.After(weekEnd.UTC()) {
			continue
		}
		if word.Stage == domain.VocabularyNew {
			newCounts[word.BookID]++
			continue
		}
		day := plannerDueDay(word.DueAt.In(location), weekStart, weekEnd)
		if !day.Before(weekEnd) {
			continue
		}
		reviewCounts[day.Format("2006-01-02")]++
	}
	items := make([]planCandidate, 0, len(reviewCounts)+len(books)*7)
	for date, count := range reviewCounts {
		day, _ := time.ParseInLocation("2006-01-02", date, location)
		sourceID := "vocabulary:review:" + date
		minutes := min(60, max(15, count*2)) - planned[planSourceKey(domain.PlanBlockVocabulary, sourceID)]
		if minutes <= 0 {
			continue
		}
		items = append(items, planCandidate{Kind: domain.PlanBlockVocabulary, SourceID: sourceID, Title: fmt.Sprintf("单词复习 · %d 个到期词", count), Minutes: minutes, Priority: domain.PriorityHigh, EarliestAt: day, DueAt: day.Add(23*time.Hour + 59*time.Minute), HasDueAt: true, Rationale: "将到期单词安排到短时高频的记忆时段"})
	}
	for _, book := range books {
		remaining := newCounts[book.ID]
		if remaining <= 0 {
			continue
		}
		limit := max(1, book.DailyNewLimit)
		for dayIndex := 0; dayIndex < 7 && remaining > 0; dayIndex++ {
			count := min(limit, remaining)
			day := weekStart.AddDate(0, 0, dayIndex)
			date := day.Format("2006-01-02")
			sourceID := "vocabulary:new:" + book.ID + ":" + date
			minutes := min(60, max(15, count*2)) - planned[planSourceKey(domain.PlanBlockVocabulary, sourceID)]
			if minutes > 0 {
				items = append(items, planCandidate{Kind: domain.PlanBlockVocabulary, SourceID: sourceID, Title: fmt.Sprintf("%s · %d 个新词", book.Name, count), Minutes: minutes, Priority: domain.PriorityMedium, EarliestAt: day, DueAt: day.Add(23*time.Hour + 59*time.Minute), HasDueAt: true, Rationale: "按词书每日新词上限分散学习，避免一次摄入过多"})
			}
			remaining -= count
		}
	}
	return items
}

func plannerDueDay(value, weekStart, weekEnd time.Time) time.Time {
	day := time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, weekStart.Location())
	if day.Before(weekStart) {
		return weekStart
	}
	if !day.Before(weekEnd) {
		return weekEnd
	}
	return day
}

func planSourceKey(kind domain.PlanBlockKind, sourceID string) string {
	return string(kind) + "\x00" + sourceID
}

func (s *Service) scheduleCandidates(userID string, preferences domain.PlannerPreferences, weekStart, weekEnd time.Time, location *time.Location, fixed []domain.StudyPlanBlock, candidates []planCandidate) ([]domain.StudyPlanBlock, []domain.UnscheduledPlanItem) {
	slots := plannerSlots(preferences, weekStart, location)
	busy := make([]plannerSlot, 0, len(fixed)+len(candidates))
	dailyUsed := make(map[string]int)
	for _, block := range fixed {
		if block.Status == domain.PlanBlockSkipped {
			continue
		}
		busy = append(busy, plannerSlot{Start: block.StartAt.In(location), End: block.EndAt.In(location)})
		dailyUsed[block.StartAt.In(location).Format("2006-01-02")] += block.PlannedMinutes
	}
	generated := make([]domain.StudyPlanBlock, 0)
	unscheduled := make([]domain.UnscheduledPlanItem, 0)
	now := s.now().In(location)
	minimumStart := weekStart
	if now.After(weekStart) && now.Before(weekEnd) {
		minimumStart = now.Truncate(5 * time.Minute).Add(5 * time.Minute)
	}
	for _, candidate := range candidates {
		remaining := candidate.Minutes
		candidateEarliest := candidate.EarliestAt
		if candidateEarliest.Before(minimumStart) {
			candidateEarliest = minimumStart
		}
		deadline := weekEnd
		if candidate.HasDueAt && candidate.DueAt.After(candidateEarliest) && candidate.DueAt.Before(weekEnd) {
			deadline = candidate.DueAt
		}
		for remaining > 0 {
			duration := min(remaining, preferences.SessionMinutes)
			start, actualDuration, ok := findPlannerPlacement(slots, busy, dailyUsed, candidateEarliest, deadline, duration, remaining, preferences.DailyMaxMinutes, location)
			if !ok {
				break
			}
			end := start.Add(time.Duration(actualDuration) * time.Minute)
			nowUTC := s.now().UTC()
			block := domain.StudyPlanBlock{
				ID: platform.NewID(), UserID: userID, Kind: candidate.Kind, SourceID: candidate.SourceID,
				Title: candidate.Title, Notes: candidate.Notes, StartAt: start.UTC(), EndAt: end.UTC(), PlannedMinutes: actualDuration,
				Priority: candidate.Priority, Status: domain.PlanBlockPlanned, AutoGenerated: true, Rationale: candidate.Rationale,
				CreatedAt: nowUTC, UpdatedAt: nowUTC,
			}
			generated = append(generated, block)
			busy = append(busy, plannerSlot{Start: start, End: end.Add(time.Duration(preferences.BreakMinutes) * time.Minute)})
			dailyUsed[start.Format("2006-01-02")] += actualDuration
			remaining -= actualDuration
			candidateEarliest = end.Add(time.Duration(preferences.BreakMinutes) * time.Minute)
		}
		if remaining > 0 {
			unscheduled = append(unscheduled, domain.UnscheduledPlanItem{Kind: candidate.Kind, SourceID: candidate.SourceID, Title: candidate.Title, RemainingMinutes: remaining, Reason: "截止时间前的可用时段或每日容量不足"})
		}
	}
	return generated, unscheduled
}

func plannerSlots(preferences domain.PlannerPreferences, weekStart time.Time, location *time.Location) []plannerSlot {
	slots := make([]plannerSlot, 0, len(preferences.Windows))
	for _, window := range preferences.Windows {
		startMinute, _ := parseClockMinutes(window.StartTime)
		endMinute, _ := parseClockMinutes(window.EndTime)
		day := weekStart.AddDate(0, 0, window.Weekday-1)
		start := time.Date(day.Year(), day.Month(), day.Day(), startMinute/60, startMinute%60, 0, 0, location)
		end := time.Date(day.Year(), day.Month(), day.Day(), endMinute/60, endMinute%60, 0, 0, location)
		slots = append(slots, plannerSlot{Start: start, End: end})
	}
	sort.Slice(slots, func(i, j int) bool { return slots[i].Start.Before(slots[j].Start) })
	return slots
}

func findPlannerPlacement(slots, busy []plannerSlot, dailyUsed map[string]int, earliest, deadline time.Time, requested, remaining, dailyMax int, location *time.Location) (time.Time, int, bool) {
	sortedBusy := append([]plannerSlot(nil), busy...)
	sort.Slice(sortedBusy, func(i, j int) bool { return sortedBusy[i].Start.Before(sortedBusy[j].Start) })
	for _, slot := range slots {
		if !slot.End.After(earliest) || !slot.Start.Before(deadline) {
			continue
		}
		cursor := slot.Start
		if earliest.After(cursor) {
			cursor = earliest
		}
		dayKey := cursor.In(location).Format("2006-01-02")
		capacity := dailyMax - dailyUsed[dayKey]
		if capacity <= 0 {
			continue
		}
		duration := min(requested, capacity)
		if duration < 15 && remaining >= 15 {
			continue
		}
		for _, interval := range sortedBusy {
			if !interval.End.After(cursor) || !interval.Start.Before(slot.End) {
				continue
			}
			end := cursor.Add(time.Duration(duration) * time.Minute)
			if !interval.Start.Before(end) {
				break
			}
			cursor = interval.End
		}
		end := cursor.Add(time.Duration(duration) * time.Minute)
		if !end.After(slot.End) && !end.After(deadline) {
			return cursor, duration, true
		}
	}
	return time.Time{}, 0, false
}

func (s *Service) CreatePlanBlock(ctx context.Context, userID string, input CreatePlanBlockInput) (domain.StudyPlanBlock, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Notes = strings.TrimSpace(input.Notes)
	if input.Title == "" || len(input.Title) > 200 || len(input.Notes) > 4000 {
		return domain.StudyPlanBlock{}, fmt.Errorf("%w: title or notes are invalid", domain.ErrInvalidInput)
	}
	if !validPlanBlockKind(input.Kind) {
		return domain.StudyPlanBlock{}, fmt.Errorf("%w: unsupported plan block kind", domain.ErrInvalidInput)
	}
	if input.Priority == "" {
		input.Priority = domain.PriorityMedium
	}
	if err := validatePlanPriority(input.Priority); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	if err := validatePlanRange(input.StartAt, input.EndAt); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	if err := s.validatePlanSource(ctx, userID, input.Kind, input.SourceID); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	if err := s.ensureNoPlanConflict(ctx, userID, "", input.StartAt, input.EndAt); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	now := s.now().UTC()
	block := domain.StudyPlanBlock{
		ID: platform.NewID(), UserID: userID, Kind: input.Kind, SourceID: strings.TrimSpace(input.SourceID), Title: input.Title,
		Notes: input.Notes, StartAt: input.StartAt.UTC(), EndAt: input.EndAt.UTC(), PlannedMinutes: int(input.EndAt.Sub(input.StartAt).Minutes()),
		Priority: input.Priority, Status: domain.PlanBlockPlanned, Locked: input.Locked, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreatePlanBlock(ctx, block); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	s.publish("planner.block_created", userID, block.ID, map[string]any{"kind": block.Kind})
	return block, nil
}

func (s *Service) UpdatePlanBlock(ctx context.Context, userID, blockID string, input UpdatePlanBlockInput) (domain.StudyPlanBlock, error) {
	block, err := s.planBlockForUser(ctx, userID, blockID)
	if err != nil {
		return domain.StudyPlanBlock{}, err
	}
	if input.Title != nil {
		block.Title = strings.TrimSpace(*input.Title)
	}
	if input.Notes != nil {
		block.Notes = strings.TrimSpace(*input.Notes)
	}
	if block.Title == "" || len(block.Title) > 200 || len(block.Notes) > 4000 {
		return domain.StudyPlanBlock{}, fmt.Errorf("%w: title or notes are invalid", domain.ErrInvalidInput)
	}
	if input.StartAt != nil {
		block.StartAt = input.StartAt.UTC()
		block.Locked = true
	}
	if input.EndAt != nil {
		block.EndAt = input.EndAt.UTC()
		block.Locked = true
	}
	if err := validatePlanRange(block.StartAt, block.EndAt); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	if input.Priority != nil {
		if err := validatePlanPriority(*input.Priority); err != nil {
			return domain.StudyPlanBlock{}, err
		}
		block.Priority = *input.Priority
	}
	if input.Locked != nil {
		block.Locked = *input.Locked
	}
	if err := s.ensureNoPlanConflict(ctx, userID, block.ID, block.StartAt, block.EndAt); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	block.PlannedMinutes = int(block.EndAt.Sub(block.StartAt).Minutes())
	block.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdatePlanBlock(ctx, block); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	s.publish("planner.block_updated", userID, block.ID, nil)
	return block, nil
}

func (s *Service) ChangePlanBlockStatus(ctx context.Context, userID, blockID string, status domain.PlanBlockStatus, completeSource bool) (domain.StudyPlanBlock, error) {
	block, err := s.planBlockForUser(ctx, userID, blockID)
	if err != nil {
		return domain.StudyPlanBlock{}, err
	}
	if !validPlanBlockStatus(status) {
		return domain.StudyPlanBlock{}, fmt.Errorf("%w: unsupported plan block status", domain.ErrInvalidInput)
	}
	if completeSource && status != domain.PlanBlockCompleted {
		return domain.StudyPlanBlock{}, fmt.Errorf("%w: complete_source requires completed status", domain.ErrInvalidInput)
	}
	if completeSource {
		switch block.Kind {
		case domain.PlanBlockTask:
			if _, err := s.ChangeTaskStatus(ctx, userID, block.SourceID, domain.TaskDone); err != nil {
				return domain.StudyPlanBlock{}, err
			}
		case domain.PlanBlockTodo:
			if _, _, err := s.CompleteTodo(ctx, userID, block.SourceID, true); err != nil {
				return domain.StudyPlanBlock{}, err
			}
		default:
			return domain.StudyPlanBlock{}, fmt.Errorf("%w: this block kind has no completable source", domain.ErrInvalidState)
		}
	}
	now := s.now().UTC()
	block.Status = status
	block.UpdatedAt = now
	if status == domain.PlanBlockCompleted {
		block.CompletedAt = &now
	} else {
		block.CompletedAt = nil
	}
	if err := s.repo.UpdatePlanBlock(ctx, block); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	s.publish("planner.block_status_changed", userID, block.ID, map[string]any{"status": status, "complete_source": completeSource})
	return block, nil
}

func (s *Service) DeletePlanBlock(ctx context.Context, userID, blockID string) error {
	block, err := s.planBlockForUser(ctx, userID, blockID)
	if err != nil {
		return err
	}
	if block.Status == domain.PlanBlockDoing {
		return fmt.Errorf("%w: an in-progress block cannot be deleted", domain.ErrInvalidState)
	}
	if err := s.repo.DeletePlanBlock(ctx, block.ID); err != nil {
		return err
	}
	s.publish("planner.block_deleted", userID, block.ID, nil)
	return nil
}

func (s *Service) planBlockForUser(ctx context.Context, userID, blockID string) (domain.StudyPlanBlock, error) {
	block, err := s.repo.PlanBlockByID(ctx, blockID)
	if err != nil {
		return domain.StudyPlanBlock{}, err
	}
	if err := requireOwner(block.UserID, userID); err != nil {
		return domain.StudyPlanBlock{}, err
	}
	return block, nil
}

func (s *Service) validatePlanSource(ctx context.Context, userID string, kind domain.PlanBlockKind, sourceID string) error {
	sourceID = strings.TrimSpace(sourceID)
	if kind == domain.PlanBlockCustom || kind == domain.PlanBlockVocabulary {
		return nil
	}
	if sourceID == "" {
		return fmt.Errorf("%w: task and todo blocks require source_id", domain.ErrInvalidInput)
	}
	switch kind {
	case domain.PlanBlockTask:
		task, err := s.repo.TaskByID(ctx, sourceID)
		if err != nil {
			return err
		}
		return requireOwner(task.UserID, userID)
	case domain.PlanBlockTodo:
		todo, err := s.repo.TodoByID(ctx, sourceID)
		if err != nil {
			return err
		}
		return requireOwner(todo.UserID, userID)
	}
	return nil
}

func (s *Service) ensureNoPlanConflict(ctx context.Context, userID, excludeID string, start, end time.Time) error {
	blocks, err := s.repo.ListPlanBlocks(ctx, userID, start.UTC(), end.UTC())
	if err != nil {
		return err
	}
	for _, block := range blocks {
		if block.ID != excludeID && block.Status != domain.PlanBlockSkipped {
			return fmt.Errorf("%w: the selected time overlaps %q", domain.ErrConflict, block.Title)
		}
	}
	return nil
}

func validatePlanRange(start, end time.Time) error {
	if start.IsZero() || end.IsZero() || !end.After(start) {
		return fmt.Errorf("%w: end_at must be after start_at", domain.ErrInvalidInput)
	}
	minutes := int(end.Sub(start).Minutes())
	if minutes < 10 || minutes > 480 {
		return fmt.Errorf("%w: plan blocks must last between 10 and 480 minutes", domain.ErrInvalidInput)
	}
	return nil
}

func validPlanBlockKind(kind domain.PlanBlockKind) bool {
	return kind == domain.PlanBlockTask || kind == domain.PlanBlockTodo || kind == domain.PlanBlockVocabulary || kind == domain.PlanBlockCustom
}

func validPlanBlockStatus(status domain.PlanBlockStatus) bool {
	return status == domain.PlanBlockPlanned || status == domain.PlanBlockDoing || status == domain.PlanBlockCompleted || status == domain.PlanBlockSkipped
}

func validatePlanPriority(priority domain.TaskPriority) error {
	if priority == "" {
		return nil
	}
	if priority != domain.PriorityLow && priority != domain.PriorityMedium && priority != domain.PriorityHigh {
		return fmt.Errorf("%w: priority must be low, medium, or high", domain.ErrInvalidInput)
	}
	return nil
}

func buildPlanWeek(preferences domain.PlannerPreferences, weekStart, weekEnd time.Time, location *time.Location, blocks []domain.StudyPlanBlock, unscheduled []domain.UnscheduledPlanItem, overdue int, generatedAt *time.Time) domain.PlanWeek {
	summary := domain.PlanWeekSummary{TotalBlocks: len(blocks), CapacityMinutes: plannerCapacity(preferences), OverdueSources: overdue, UnscheduledItems: len(unscheduled)}
	for _, block := range blocks {
		summary.PlannedMinutes += block.PlannedMinutes
		if block.Status == domain.PlanBlockCompleted {
			summary.CompletedBlocks++
			summary.CompletedMinutes += block.PlannedMinutes
		}
	}
	for _, item := range unscheduled {
		summary.UnscheduledMinutes += item.RemainingMinutes
	}
	if summary.CapacityMinutes > 0 {
		summary.Utilization = math.Round(float64(summary.PlannedMinutes)*1000/float64(summary.CapacityMinutes)) / 10
	}
	return domain.PlanWeek{
		WeekStart: weekStart.In(location).Format("2006-01-02"), WeekEnd: weekEnd.AddDate(0, 0, -1).In(location).Format("2006-01-02"),
		GeneratedAt: generatedAt, Preferences: preferences, Blocks: blocks, Unscheduled: unscheduled, Summary: summary,
	}
}

func plannerCapacity(preferences domain.PlannerPreferences) int {
	byDay := make(map[int]int)
	for _, window := range preferences.Windows {
		start, _ := parseClockMinutes(window.StartTime)
		end, _ := parseClockMinutes(window.EndTime)
		byDay[window.Weekday] += end - start
	}
	total := 0
	for _, minutes := range byDay {
		total += min(minutes, preferences.DailyMaxMinutes)
	}
	return total
}
