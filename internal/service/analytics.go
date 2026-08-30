package service

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

type dailyAccuracyCounter struct {
	cardCorrect       int
	vocabularyCorrect int
}

func (s *Service) LearningInsights(ctx context.Context, userID string, days int, timeZone string) (domain.LearningInsights, error) {
	if days == 0 {
		days = 30
	}
	if days < 7 || days > 90 {
		return domain.LearningInsights{}, fmt.Errorf("%w: days must be between 7 and 90", domain.ErrInvalidInput)
	}
	if timeZone == "" {
		preferences, err := s.PlannerPreferences(ctx, userID)
		if err != nil {
			return domain.LearningInsights{}, err
		}
		timeZone = preferences.TimeZone
	}
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		return domain.LearningInsights{}, fmt.Errorf("%w: unsupported time_zone", domain.ErrInvalidInput)
	}
	now := s.now().In(location)
	endDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	startDay := endDay.AddDate(0, 0, -(days - 1))
	endExclusive := endDay.AddDate(0, 0, 1)
	result := domain.LearningInsights{
		StartDate: startDay.Format("2006-01-02"), EndDate: endDay.Format("2006-01-02"), TimeZone: timeZone,
		Daily: make([]domain.DailyLearningMetric, days), FocusHeatmap: make([]domain.FocusHeatmapCell, 0),
		Goals: make([]domain.GoalLearningInsight, 0), Recommendations: make([]domain.LearningRecommendation, 0),
	}
	dateIndex := make(map[string]int, days)
	for index := 0; index < days; index++ {
		date := startDay.AddDate(0, 0, index).Format("2006-01-02")
		result.Daily[index].Date = date
		dateIndex[date] = index
	}
	accuracy := make([]dailyAccuracyCounter, days)
	heatmap := make(map[[2]int]int)

	sessions, err := s.repo.ListFocusSessions(ctx, userID, startDay.UTC())
	if err != nil {
		return domain.LearningInsights{}, err
	}
	for _, session := range sessions {
		if session.Status != domain.FocusCompleted || session.EndedAt == nil || !session.EndedAt.Before(endExclusive.UTC()) {
			continue
		}
		localEnd := session.EndedAt.In(location)
		index, ok := dateIndex[localEnd.Format("2006-01-02")]
		if !ok {
			continue
		}
		result.Daily[index].FocusMinutes += session.ActualMinutes
		result.Daily[index].FocusSessions++
		isoWeekday := (int(localEnd.Weekday())+6)%7 + 1
		heatmap[[2]int{isoWeekday, localEnd.Hour()}] += session.ActualMinutes
	}

	blocks, err := s.repo.ListPlanBlocks(ctx, userID, startDay.UTC(), endExclusive.UTC())
	if err != nil {
		return domain.LearningInsights{}, err
	}
	for _, block := range blocks {
		if block.Status == domain.PlanBlockSkipped {
			continue
		}
		index, ok := dateIndex[block.StartAt.In(location).Format("2006-01-02")]
		if !ok {
			continue
		}
		result.Daily[index].PlannedMinutes += block.PlannedMinutes
		if block.Status == domain.PlanBlockCompleted {
			result.Daily[index].CompletedPlanMinutes += block.PlannedMinutes
		}
	}

	tasks, err := s.repo.ListTasks(ctx, userID, store.TaskFilter{})
	if err != nil {
		return domain.LearningInsights{}, err
	}
	for _, task := range tasks {
		if task.CompletedAt == nil {
			continue
		}
		if index, ok := dateIndex[task.CompletedAt.In(location).Format("2006-01-02")]; ok {
			result.Daily[index].TasksCompleted++
		}
	}
	todos, err := s.repo.ListTodos(ctx, userID, store.TodoFilter{})
	if err != nil {
		return domain.LearningInsights{}, err
	}
	for _, todo := range todos {
		if todo.CompletedAt == nil {
			continue
		}
		if index, ok := dateIndex[todo.CompletedAt.In(location).Format("2006-01-02")]; ok {
			result.Daily[index].TodosCompleted++
		}
	}

	cardReviews, err := s.repo.ListReviews(ctx, userID, startDay.UTC())
	if err != nil {
		return domain.LearningInsights{}, err
	}
	for _, review := range cardReviews {
		if !review.ReviewedAt.Before(endExclusive.UTC()) {
			continue
		}
		if index, ok := dateIndex[review.ReviewedAt.In(location).Format("2006-01-02")]; ok {
			result.Daily[index].CardReviews++
			if review.Rating > domain.RatingAgain {
				accuracy[index].cardCorrect++
			}
		}
	}
	vocabularyReviews, err := s.repo.ListVocabularyReviews(ctx, userID, startDay.UTC())
	if err != nil {
		return domain.LearningInsights{}, err
	}
	for _, review := range vocabularyReviews {
		if !review.ReviewedAt.Before(endExclusive.UTC()) {
			continue
		}
		if index, ok := dateIndex[review.ReviewedAt.In(location).Format("2006-01-02")]; ok {
			result.Daily[index].VocabularyReviews++
			if review.Rating > domain.RatingAgain {
				accuracy[index].vocabularyCorrect++
			}
		}
	}

	for month := time.Date(startDay.Year(), startDay.Month(), 1, 0, 0, 0, 0, location); !month.After(endDay); month = month.AddDate(0, 1, 0) {
		entries, listErr := s.repo.ListMoodEntries(ctx, userID, month.Format("2006-01"))
		if listErr != nil {
			return domain.LearningInsights{}, listErr
		}
		for _, entry := range entries {
			if index, ok := dateIndex[entry.Date]; ok {
				result.Daily[index].MoodScore = moodNumericScore(entry.Mood)
				result.Daily[index].Stress = entry.Stress
				result.Daily[index].Energy = entry.Energy
			}
		}
	}

	cardCorrectTotal := 0
	vocabularyCorrectTotal := 0
	for index := range result.Daily {
		day := &result.Daily[index]
		if day.PlannedMinutes > 0 {
			day.PlanAdherence = roundedPercent(day.CompletedPlanMinutes, day.PlannedMinutes)
		}
		if day.CardReviews > 0 {
			day.CardAccuracy = roundedPercent(accuracy[index].cardCorrect, day.CardReviews)
		}
		if day.VocabularyReviews > 0 {
			day.VocabularyAccuracy = roundedPercent(accuracy[index].vocabularyCorrect, day.VocabularyReviews)
		}
		cardCorrectTotal += accuracy[index].cardCorrect
		vocabularyCorrectTotal += accuracy[index].vocabularyCorrect
		result.Summary.TotalFocusMinutes += day.FocusMinutes
		result.Summary.TasksCompleted += day.TasksCompleted
		result.Summary.TodosCompleted += day.TodosCompleted
		result.Summary.CardReviews += day.CardReviews
		result.Summary.VocabularyReviews += day.VocabularyReviews
		if learningDayActive(*day) {
			result.Summary.ActiveDays++
		}
	}
	result.Summary.AverageFocusMinutes = math.Round(float64(result.Summary.TotalFocusMinutes)*10/float64(days)) / 10
	result.Summary.LearningStreak = learningActivityStreak(result.Daily)
	plannedTotal, completedPlanTotal := 0, 0
	for _, day := range result.Daily {
		plannedTotal += day.PlannedMinutes
		completedPlanTotal += day.CompletedPlanMinutes
	}
	if plannedTotal > 0 {
		result.Summary.PlanAdherence = roundedPercent(completedPlanTotal, plannedTotal)
	}
	if result.Summary.CardReviews > 0 {
		result.Summary.CardAccuracy = roundedPercent(cardCorrectTotal, result.Summary.CardReviews)
	}
	if result.Summary.VocabularyReviews > 0 {
		result.Summary.VocabularyAccuracy = roundedPercent(vocabularyCorrectTotal, result.Summary.VocabularyReviews)
	}
	result.Summary.ConsistencyScore = learningConsistencyScore(result.Summary, days, plannedTotal)
	result.Summary.MoodFocusCorrelation, result.Summary.StressFocusCorrelation = learningCorrelations(result.Daily)

	for key, minutes := range heatmap {
		result.FocusHeatmap = append(result.FocusHeatmap, domain.FocusHeatmapCell{Weekday: key[0], Hour: key[1], Minutes: minutes})
		if minutes > heatmap[[2]int{result.Summary.PeakFocusWeekday, result.Summary.PeakFocusHour}] {
			result.Summary.PeakFocusWeekday, result.Summary.PeakFocusHour = key[0], key[1]
		}
	}
	sort.Slice(result.FocusHeatmap, func(i, j int) bool {
		if result.FocusHeatmap[i].Weekday != result.FocusHeatmap[j].Weekday {
			return result.FocusHeatmap[i].Weekday < result.FocusHeatmap[j].Weekday
		}
		return result.FocusHeatmap[i].Hour < result.FocusHeatmap[j].Hour
	})

	goals, err := s.repo.ListGoals(ctx, userID)
	if err != nil {
		return domain.LearningInsights{}, err
	}
	result.Goals = goalLearningInsights(goals, tasks, sessions)
	dueCards, err := s.repo.ListDueCards(ctx, userID, s.now().UTC(), 0)
	if err != nil {
		return domain.LearningInsights{}, err
	}
	result.Summary.DueCards = len(dueCards)
	words, err := s.repo.ListVocabularyWords(ctx, userID, "")
	if err != nil {
		return domain.LearningInsights{}, err
	}
	for _, word := range words {
		if !word.DueAt.After(s.now().UTC()) {
			result.Summary.DueVocabulary++
		}
	}
	result.Recommendations = learningRecommendations(result.Summary, days, plannedTotal)
	return result, nil
}

func moodNumericScore(mood domain.Mood) int {
	return map[domain.Mood]int{domain.MoodAwful: 1, domain.MoodLow: 2, domain.MoodNeutral: 3, domain.MoodGood: 4, domain.MoodGreat: 5}[mood]
}

func roundedPercent(numerator, denominator int) float64 {
	if denominator <= 0 {
		return 0
	}
	return math.Round(float64(numerator)*1000/float64(denominator)) / 10
}

func learningDayActive(day domain.DailyLearningMetric) bool {
	return day.FocusMinutes > 0 || day.TasksCompleted > 0 || day.TodosCompleted > 0 || day.CardReviews > 0 || day.VocabularyReviews > 0 || day.CompletedPlanMinutes > 0
}

func learningActivityStreak(daily []domain.DailyLearningMetric) int {
	if len(daily) == 0 {
		return 0
	}
	index := len(daily) - 1
	if !learningDayActive(daily[index]) {
		index--
	}
	streak := 0
	for ; index >= 0 && learningDayActive(daily[index]); index-- {
		streak++
	}
	return streak
}

func learningConsistencyScore(summary domain.LearningInsightSummary, days, plannedTotal int) int {
	activityScore := float64(summary.ActiveDays) / float64(days) * 45
	adherence := summary.PlanAdherence
	if plannedTotal == 0 {
		adherence = float64(summary.ActiveDays) / float64(days) * 100
	}
	adherenceScore := adherence * 0.3
	focusScore := math.Min(25, summary.AverageFocusMinutes/45*25)
	return int(math.Round(math.Min(100, activityScore+adherenceScore+focusScore)))
}

func learningCorrelations(daily []domain.DailyLearningMetric) (float64, float64) {
	moodX, stressX, focusMood, focusStress := make([]float64, 0), make([]float64, 0), make([]float64, 0), make([]float64, 0)
	for _, day := range daily {
		if day.MoodScore > 0 {
			moodX = append(moodX, float64(day.MoodScore))
			focusMood = append(focusMood, float64(day.FocusMinutes))
		}
		if day.Stress > 0 {
			stressX = append(stressX, float64(day.Stress))
			focusStress = append(focusStress, float64(day.FocusMinutes))
		}
	}
	return pearsonCorrelation(moodX, focusMood), pearsonCorrelation(stressX, focusStress)
}

func pearsonCorrelation(left, right []float64) float64 {
	if len(left) < 3 || len(left) != len(right) {
		return 0
	}
	leftMean, rightMean := 0.0, 0.0
	for index := range left {
		leftMean += left[index]
		rightMean += right[index]
	}
	leftMean /= float64(len(left))
	rightMean /= float64(len(right))
	numerator, leftVariance, rightVariance := 0.0, 0.0, 0.0
	for index := range left {
		leftDelta, rightDelta := left[index]-leftMean, right[index]-rightMean
		numerator += leftDelta * rightDelta
		leftVariance += leftDelta * leftDelta
		rightVariance += rightDelta * rightDelta
	}
	if leftVariance == 0 || rightVariance == 0 {
		return 0
	}
	return math.Round(numerator/math.Sqrt(leftVariance*rightVariance)*100) / 100
}

func goalLearningInsights(goals []domain.Goal, tasks []domain.StudyTask, sessions []domain.FocusSession) []domain.GoalLearningInsight {
	goalByID := make(map[string]domain.Goal, len(goals))
	resultByID := make(map[string]*domain.GoalLearningInsight)
	for _, goal := range goals {
		goalByID[goal.ID] = goal
		resultByID[goal.ID] = &domain.GoalLearningInsight{GoalID: goal.ID, Title: goal.Title}
	}
	taskGoal := make(map[string]string)
	for _, task := range tasks {
		if task.GoalID == "" {
			continue
		}
		taskGoal[task.ID] = task.GoalID
		if insight := resultByID[task.GoalID]; insight != nil {
			insight.TotalTasks++
			if task.Status == domain.TaskDone {
				insight.CompletedTasks++
			}
		}
	}
	for _, session := range sessions {
		if session.Status != domain.FocusCompleted {
			continue
		}
		if insight := resultByID[taskGoal[session.TaskID]]; insight != nil {
			insight.FocusMinutes += session.ActualMinutes
		}
	}
	items := make([]domain.GoalLearningInsight, 0, len(goals))
	for goalID, insight := range resultByID {
		if _, ok := goalByID[goalID]; !ok {
			continue
		}
		if insight.TotalTasks > 0 {
			insight.CompletionRate = roundedPercent(insight.CompletedTasks, insight.TotalTasks)
		}
		items = append(items, *insight)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].FocusMinutes != items[j].FocusMinutes {
			return items[i].FocusMinutes > items[j].FocusMinutes
		}
		return items[i].Title < items[j].Title
	})
	return items
}

func learningRecommendations(summary domain.LearningInsightSummary, days, plannedTotal int) []domain.LearningRecommendation {
	items := make([]domain.LearningRecommendation, 0, 6)
	if summary.TotalFocusMinutes == 0 {
		items = append(items, domain.LearningRecommendation{Code: "start_small", Level: "attention", Title: "先建立一个可重复的小节奏", Description: "从每天一个 25 分钟专注开始，比一次安排大量任务更容易形成稳定反馈。", Evidence: fmt.Sprintf("过去 %d 天没有完成专注会话", days)})
	} else if summary.ActiveDays*10 < days*4 {
		items = append(items, domain.LearningRecommendation{Code: "improve_consistency", Level: "attention", Title: "减少空档日", Description: "尝试把较长任务拆开，并在智能规划中给更多日期保留短时段。", Evidence: fmt.Sprintf("过去 %d 天仅有 %d 个活跃学习日", days, summary.ActiveDays)})
	}
	if plannedTotal > 0 && summary.PlanAdherence < 60 {
		items = append(items, domain.LearningRecommendation{Code: "reduce_overcommitment", Level: "warning", Title: "当前计划可能过载", Description: "降低每日容量或缩短本周承诺，再重新运行智能排程，让计划更接近真实执行能力。", Evidence: fmt.Sprintf("时间块执行率为 %.1f%%", summary.PlanAdherence)})
	} else if plannedTotal > 0 && summary.PlanAdherence >= 85 {
		items = append(items, domain.LearningRecommendation{Code: "strong_adherence", Level: "positive", Title: "计划与执行非常一致", Description: "保持当前每日容量；新增工作时继续用锁定时间块保护最重要的学习。", Evidence: fmt.Sprintf("时间块执行率达到 %.1f%%", summary.PlanAdherence)})
	}
	if summary.DueCards+summary.DueVocabulary >= 20 {
		items = append(items, domain.LearningRecommendation{Code: "review_backlog", Level: "warning", Title: "记忆复习正在积压", Description: "优先清理到期内容，并暂时减少新卡片或新词摄入，避免复习负债继续增长。", Evidence: fmt.Sprintf("当前有 %d 张知识卡和 %d 个单词到期", summary.DueCards, summary.DueVocabulary)})
	}
	if summary.StressFocusCorrelation <= -0.35 {
		items = append(items, domain.LearningRecommendation{Code: "stress_sensitive", Level: "attention", Title: "高压力日的专注时间明显下降", Description: "在高压力日安排复习、整理等低启动成本工作，把高认知任务放到精力更稳定的时段。", Evidence: fmt.Sprintf("压力与专注相关系数为 %.2f", summary.StressFocusCorrelation)})
	}
	if summary.PeakFocusWeekday > 0 {
		weekdays := []string{"", "周一", "周二", "周三", "周四", "周五", "周六", "周日"}
		items = append(items, domain.LearningRecommendation{Code: "protect_peak_time", Level: "info", Title: "保护你的高产时段", Description: "把最重要、最需要连续思考的任务优先锁定在这个时间附近。", Evidence: fmt.Sprintf("专注累计最高的时段是%s %02d:00 左右", weekdays[summary.PeakFocusWeekday], summary.PeakFocusHour)})
	}
	if len(items) == 0 {
		items = append(items, domain.LearningRecommendation{Code: "collect_more_data", Level: "info", Title: "继续积累可比较的数据", Description: "持续记录专注、计划完成与心情，至少三个记录日后相关性分析会更有参考价值。", Evidence: "当前数据未触发明显风险信号"})
	}
	return items
}
