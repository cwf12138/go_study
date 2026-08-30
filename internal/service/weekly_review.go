package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

type SaveWeeklyReflectionInput struct {
	WeekStart          string
	Satisfaction       int
	Wins               string
	Challenges         string
	Lessons            string
	NextWeekPriorities []string
}

func (s *Service) WeeklyReview(ctx context.Context, userID, weekStartValue, timeZone string) (domain.WeeklyReview, error) {
	if timeZone == "" {
		preferences, err := s.PlannerPreferences(ctx, userID)
		if err != nil {
			return domain.WeeklyReview{}, err
		}
		timeZone = preferences.TimeZone
	}
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		return domain.WeeklyReview{}, fmt.Errorf("%w: unsupported time_zone", domain.ErrInvalidInput)
	}
	today := reviewDateOnly(s.now().In(location))
	weekStart, err := parseReviewWeekStart(weekStartValue, today, location)
	if err != nil {
		return domain.WeeklyReview{}, err
	}
	if weekStart.After(today) || weekStart.Before(today.AddDate(0, 0, -77)) {
		return domain.WeeklyReview{}, fmt.Errorf("%w: week_start must be within the last 12 weeks", domain.ErrInvalidInput)
	}
	currentEnd := weekStart.AddDate(0, 0, 6)
	if currentEnd.After(today) {
		currentEnd = today
	}
	elapsedDays := int(currentEnd.Sub(weekStart).Hours()/24) + 1
	previousStart := weekStart.AddDate(0, 0, -7)
	previousEnd := previousStart.AddDate(0, 0, elapsedDays-1)
	daysNeeded := int(today.Sub(previousStart).Hours()/24) + 1
	if daysNeeded < 7 {
		daysNeeded = 7
	}
	insights, err := s.LearningInsights(ctx, userID, daysNeeded, timeZone)
	if err != nil {
		return domain.WeeklyReview{}, err
	}
	current := summarizeReviewDays(insights.Daily, weekStart, currentEnd, elapsedDays)
	previous := summarizeReviewDays(insights.Daily, previousStart, previousEnd, elapsedDays)
	review := domain.WeeklyReview{
		WeekStart: weekStart.Format("2006-01-02"), WeekEnd: currentEnd.Format("2006-01-02"),
		ComparedFrom: previousStart.Format("2006-01-02"), ComparedTo: previousEnd.Format("2006-01-02"),
		Summary: current, Previous: previous,
		Comparison: domain.WeeklyReviewComparison{
			FocusMinutesDelta:   current.FocusMinutes - previous.FocusMinutes,
			ActiveDaysDelta:     current.ActiveDays - previous.ActiveDays,
			PlanAdherenceDelta:  roundOne(current.PlanAdherence - previous.PlanAdherence),
			CompletedItemsDelta: current.TasksCompleted + current.TodosCompleted - previous.TasksCompleted - previous.TodosCompleted,
			MemoryReviewsDelta:  current.MemoryReviews - previous.MemoryReviews,
		},
	}
	review.Highlights = weeklyHighlights(current, previous, elapsedDays)
	reflection, reflectionErr := s.repo.WeeklyReflection(ctx, userID, review.WeekStart)
	if reflectionErr == nil {
		review.Reflection, review.ReflectionSaved = reflection, true
	} else if !errors.Is(reflectionErr, domain.ErrNotFound) {
		return domain.WeeklyReview{}, reflectionErr
	} else {
		review.Reflection = domain.WeeklyReflection{UserID: userID, WeekStart: review.WeekStart}
	}
	return review, nil
}

func (s *Service) SaveWeeklyReflection(ctx context.Context, userID string, input SaveWeeklyReflectionInput) (domain.WeeklyReflection, error) {
	preferences, err := s.PlannerPreferences(ctx, userID)
	if err != nil {
		return domain.WeeklyReflection{}, err
	}
	location, err := time.LoadLocation(preferences.TimeZone)
	if err != nil {
		return domain.WeeklyReflection{}, err
	}
	today := reviewDateOnly(s.now().In(location))
	weekStart, err := parseReviewWeekStart(input.WeekStart, today, location)
	if err != nil || weekStart.After(today) || weekStart.Before(today.AddDate(0, 0, -77)) {
		return domain.WeeklyReflection{}, fmt.Errorf("%w: week_start must be within the last 12 weeks", domain.ErrInvalidInput)
	}
	if input.Satisfaction < 1 || input.Satisfaction > 5 {
		return domain.WeeklyReflection{}, fmt.Errorf("%w: satisfaction must be between 1 and 5", domain.ErrInvalidInput)
	}
	input.Wins, input.Challenges, input.Lessons = strings.TrimSpace(input.Wins), strings.TrimSpace(input.Challenges), strings.TrimSpace(input.Lessons)
	if len(input.Wins) > 4000 || len(input.Challenges) > 4000 || len(input.Lessons) > 4000 {
		return domain.WeeklyReflection{}, fmt.Errorf("%w: reflection fields must not exceed 4000 characters", domain.ErrInvalidInput)
	}
	priorities := make([]string, 0, len(input.NextWeekPriorities))
	seen := map[string]struct{}{}
	for _, value := range input.NextWeekPriorities {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len(value) > 200 {
			return domain.WeeklyReflection{}, fmt.Errorf("%w: a priority must not exceed 200 characters", domain.ErrInvalidInput)
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		priorities = append(priorities, value)
	}
	if len(priorities) > 5 {
		return domain.WeeklyReflection{}, fmt.Errorf("%w: at most 5 next-week priorities are allowed", domain.ErrInvalidInput)
	}
	now := s.now().UTC()
	reflection, loadErr := s.repo.WeeklyReflection(ctx, userID, weekStart.Format("2006-01-02"))
	if errors.Is(loadErr, domain.ErrNotFound) {
		reflection = domain.WeeklyReflection{ID: platform.NewID(), UserID: userID, WeekStart: weekStart.Format("2006-01-02"), CreatedAt: now}
	} else if loadErr != nil {
		return domain.WeeklyReflection{}, loadErr
	}
	reflection.Satisfaction = input.Satisfaction
	reflection.Wins, reflection.Challenges, reflection.Lessons = input.Wins, input.Challenges, input.Lessons
	reflection.NextWeekPriorities = priorities
	reflection.UpdatedAt = now
	if err := s.repo.UpsertWeeklyReflection(ctx, reflection); err != nil {
		return domain.WeeklyReflection{}, err
	}
	s.publish("weekly_reflection.saved", userID, reflection.ID, map[string]any{"week_start": reflection.WeekStart, "satisfaction": reflection.Satisfaction})
	return reflection, nil
}

func (s *Service) ListWeeklyReflections(ctx context.Context, userID string) ([]domain.WeeklyReflection, error) {
	return s.repo.ListWeeklyReflections(ctx, userID)
}

func parseReviewWeekStart(value string, today time.Time, location *time.Location) (time.Time, error) {
	if value == "" {
		return reviewMondayOf(today), nil
	}
	parsed, err := time.ParseInLocation("2006-01-02", value, location)
	if err != nil || parsed.Weekday() != time.Monday {
		return time.Time{}, fmt.Errorf("%w: week_start must be a Monday in YYYY-MM-DD format", domain.ErrInvalidInput)
	}
	return parsed, nil
}

func reviewDateOnly(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, value.Location())
}

func reviewMondayOf(value time.Time) time.Time {
	isoWeekday := (int(value.Weekday())+6)%7 + 1
	return reviewDateOnly(value).AddDate(0, 0, -(isoWeekday - 1))
}

func summarizeReviewDays(daily []domain.DailyLearningMetric, start, end time.Time, periodDays int) domain.WeeklyReviewSummary {
	summary := domain.WeeklyReviewSummary{}
	cardCorrect, wordCorrect, moodTotal, moodDays, stressTotal, stressDays := 0.0, 0.0, 0, 0, 0, 0
	for _, day := range daily {
		date, err := time.ParseInLocation("2006-01-02", day.Date, start.Location())
		if err != nil || date.Before(start) || date.After(end) {
			continue
		}
		summary.FocusMinutes += day.FocusMinutes
		summary.TotalPlannedMins += day.PlannedMinutes
		summary.CompletedPlanMins += day.CompletedPlanMinutes
		summary.TasksCompleted += day.TasksCompleted
		summary.TodosCompleted += day.TodosCompleted
		summary.MemoryReviews += day.CardReviews + day.VocabularyReviews
		cardCorrect += float64(day.CardReviews) * day.CardAccuracy / 100
		wordCorrect += float64(day.VocabularyReviews) * day.VocabularyAccuracy / 100
		if learningDayActive(day) {
			summary.ActiveDays++
		}
		if day.MoodScore > 0 {
			moodTotal, moodDays = moodTotal+day.MoodScore, moodDays+1
		}
		if day.Stress > 0 {
			stressTotal, stressDays = stressTotal+day.Stress, stressDays+1
		}
	}
	if summary.TotalPlannedMins > 0 {
		summary.PlanAdherence = roundedPercent(summary.CompletedPlanMins, summary.TotalPlannedMins)
	}
	if summary.MemoryReviews > 0 {
		summary.MemoryAccuracy = roundOne((cardCorrect + wordCorrect) * 100 / float64(summary.MemoryReviews))
	}
	if moodDays > 0 {
		summary.AverageMood = roundOne(float64(moodTotal) / float64(moodDays))
	}
	if stressDays > 0 {
		summary.AverageStress = roundOne(float64(stressTotal) / float64(stressDays))
	}
	analyticsSummary := domain.LearningInsightSummary{ActiveDays: summary.ActiveDays, PlanAdherence: summary.PlanAdherence, AverageFocusMinutes: float64(summary.FocusMinutes) / float64(periodDays)}
	summary.ConsistencyScore = learningConsistencyScore(analyticsSummary, periodDays, summary.TotalPlannedMins)
	return summary
}

func weeklyHighlights(current, previous domain.WeeklyReviewSummary, elapsedDays int) []domain.WeeklyHighlight {
	items := make([]domain.WeeklyHighlight, 0, 5)
	focusDelta := current.FocusMinutes - previous.FocusMinutes
	if focusDelta >= 30 {
		items = append(items, domain.WeeklyHighlight{Kind: "win", Title: "专注投入正在增长", Description: "本周截至目前的有效专注时间高于上周同期。", Evidence: fmt.Sprintf("增加 %d 分钟，当前共 %d 分钟", focusDelta, current.FocusMinutes)})
	} else if focusDelta <= -30 {
		items = append(items, domain.WeeklyHighlight{Kind: "risk", Title: "专注投入低于上周同期", Description: "检查计划容量、临时事务或精力状态，主动缩小本周剩余承诺。", Evidence: fmt.Sprintf("减少 %d 分钟，当前共 %d 分钟", -focusDelta, current.FocusMinutes)})
	}
	if current.PlanAdherence >= 85 && current.TotalPlannedMins > 0 {
		items = append(items, domain.WeeklyHighlight{Kind: "win", Title: "计划执行稳定", Description: "当前时间盒容量与真实执行能力较为匹配。", Evidence: fmt.Sprintf("执行率 %.1f%%", current.PlanAdherence)})
	} else if current.TotalPlannedMins > 0 && current.PlanAdherence < 60 {
		items = append(items, domain.WeeklyHighlight{Kind: "risk", Title: "计划存在过载信号", Description: "下周先减少承诺，再为高优先级工作保留缓冲。", Evidence: fmt.Sprintf("计划 %d 分钟，完成 %d 分钟", current.TotalPlannedMins, current.CompletedPlanMins)})
	}
	if current.ActiveDays == elapsedDays && elapsedDays >= 3 {
		items = append(items, domain.WeeklyHighlight{Kind: "win", Title: "保持了连续行动", Description: "本周每个已过去的日期都有有效学习记录。", Evidence: fmt.Sprintf("%d/%d 个活跃日", current.ActiveDays, elapsedDays)})
	}
	if current.MemoryReviews >= 10 {
		kind := "info"
		if current.MemoryAccuracy >= 80 {
			kind = "win"
		}
		items = append(items, domain.WeeklyHighlight{Kind: kind, Title: "记忆训练形成有效样本", Description: "用正确率决定下周是增加新内容，还是优先清理到期复习。", Evidence: fmt.Sprintf("%d 次复习，正确率 %.1f%%", current.MemoryReviews, current.MemoryAccuracy)})
	}
	if current.AverageStress >= 4 {
		items = append(items, domain.WeeklyHighlight{Kind: "risk", Title: "持续高压力值得关注", Description: "压力记录不是绩效指标；建议降低容量并观察睡眠、休息与专注变化。", Evidence: fmt.Sprintf("平均压力 %.1f/5", current.AverageStress)})
	}
	if len(items) == 0 {
		items = append(items, domain.WeeklyHighlight{Kind: "info", Title: "先建立一周的真实基线", Description: "继续记录专注、计划完成和心情，完整样本会让下周对比更可靠。", Evidence: fmt.Sprintf("当前 %d 个活跃学习日", current.ActiveDays)})
	}
	return items
}

func roundOne(value float64) float64 {
	return math.Round(value*10) / 10
}
