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
)

type SaveMoodEntryInput struct {
	Mood       domain.Mood
	Note       string
	Activities []string
	Tags       []string
	Stress     int
	Energy     int
}

func (s *Service) SaveMoodEntry(ctx context.Context, userID, date string, input SaveMoodEntryInput) (domain.MoodEntry, error) {
	date, err := normalizeMoodDate(date)
	if err != nil {
		return domain.MoodEntry{}, err
	}
	if !validMood(input.Mood) || input.Stress < 1 || input.Stress > 5 || input.Energy < 1 || input.Energy > 5 {
		return domain.MoodEntry{}, fmt.Errorf("%w: mood, stress, and energy must be within the supported range", domain.ErrInvalidInput)
	}
	note := strings.TrimSpace(input.Note)
	if len(note) > 6000 {
		return domain.MoodEntry{}, fmt.Errorf("%w: note cannot exceed 6000 characters", domain.ErrInvalidInput)
	}
	activities, err := cleanMoodLabels(input.Activities, 12)
	if err != nil {
		return domain.MoodEntry{}, err
	}
	tags, err := cleanMoodLabels(input.Tags, 12)
	if err != nil {
		return domain.MoodEntry{}, err
	}

	now := s.now().UTC()
	entry, err := s.repo.MoodEntryByDate(ctx, userID, date)
	if errors.Is(err, domain.ErrNotFound) {
		entry = domain.MoodEntry{ID: platform.NewID(), UserID: userID, Date: date, CreatedAt: now}
	} else if err != nil {
		return domain.MoodEntry{}, err
	}
	entry.Mood = input.Mood
	entry.Note = note
	entry.Activities = activities
	entry.Tags = tags
	entry.Stress = input.Stress
	entry.Energy = input.Energy
	entry.UpdatedAt = now
	if err := s.repo.UpsertMoodEntry(ctx, entry); err != nil {
		return domain.MoodEntry{}, err
	}
	s.publish("mood.saved", userID, entry.ID, map[string]any{"date": date, "mood": entry.Mood})
	return entry, nil
}

func (s *Service) ListMoodEntries(ctx context.Context, userID, month string) ([]domain.MoodEntry, error) {
	if _, err := normalizeMoodMonth(month); err != nil {
		return nil, err
	}
	return s.repo.ListMoodEntries(ctx, userID, month)
}

func (s *Service) MoodInsights(ctx context.Context, userID, month string) (domain.MoodInsights, error) {
	entries, err := s.ListMoodEntries(ctx, userID, month)
	if err != nil {
		return domain.MoodInsights{}, err
	}
	insights := domain.MoodInsights{Month: month, MoodDistribution: make(map[string]int), TopActivities: []domain.MoodActivityCount{}}
	if len(entries) == 0 {
		return insights, nil
	}
	activityCounts := make(map[string]int)
	var moodTotal, stressTotal, energyTotal int
	for _, entry := range entries {
		insights.MoodDistribution[string(entry.Mood)]++
		moodTotal += moodScore(entry.Mood)
		stressTotal += entry.Stress
		energyTotal += entry.Energy
		for _, activity := range entry.Activities {
			activityCounts[activity]++
		}
	}
	insights.LoggedDays = len(entries)
	insights.AverageMood = roundedAverage(moodTotal, len(entries))
	insights.AverageStress = roundedAverage(stressTotal, len(entries))
	insights.AverageEnergy = roundedAverage(energyTotal, len(entries))
	insights.LongestStreak = longestMoodStreak(entries)
	insights.DominantMood = dominantMood(insights.MoodDistribution)
	for name, count := range activityCounts {
		insights.TopActivities = append(insights.TopActivities, domain.MoodActivityCount{Name: name, Count: count})
	}
	sort.Slice(insights.TopActivities, func(i, j int) bool {
		if insights.TopActivities[i].Count == insights.TopActivities[j].Count {
			return insights.TopActivities[i].Name < insights.TopActivities[j].Name
		}
		return insights.TopActivities[i].Count > insights.TopActivities[j].Count
	})
	if len(insights.TopActivities) > 5 {
		insights.TopActivities = insights.TopActivities[:5]
	}
	return insights, nil
}

func (s *Service) DeleteMoodEntry(ctx context.Context, userID, date string) error {
	date, err := normalizeMoodDate(date)
	if err != nil {
		return err
	}
	if err := s.repo.DeleteMoodEntry(ctx, userID, date); err != nil {
		return err
	}
	s.publish("mood.deleted", userID, date, map[string]any{"date": date})
	return nil
}

func normalizeMoodDate(value string) (string, error) {
	date, err := time.Parse("2006-01-02", value)
	if err != nil || date.Format("2006-01-02") != value {
		return "", fmt.Errorf("%w: date must use YYYY-MM-DD", domain.ErrInvalidInput)
	}
	return value, nil
}

func normalizeMoodMonth(value string) (time.Time, error) {
	month, err := time.Parse("2006-01", value)
	if err != nil || month.Format("2006-01") != value {
		return time.Time{}, fmt.Errorf("%w: month must use YYYY-MM", domain.ErrInvalidInput)
	}
	return month, nil
}

func validMood(mood domain.Mood) bool {
	return mood == domain.MoodAwful || mood == domain.MoodLow || mood == domain.MoodNeutral || mood == domain.MoodGood || mood == domain.MoodGreat
}

func cleanMoodLabels(values []string, maximum int) ([]string, error) {
	values = cleanTags(values)
	if len(values) > maximum {
		return nil, fmt.Errorf("%w: at most %d labels are allowed", domain.ErrInvalidInput, maximum)
	}
	for _, value := range values {
		if len(value) > 48 {
			return nil, fmt.Errorf("%w: each label cannot exceed 48 characters", domain.ErrInvalidInput)
		}
	}
	return values, nil
}

func moodScore(mood domain.Mood) int {
	return map[domain.Mood]int{domain.MoodAwful: 1, domain.MoodLow: 2, domain.MoodNeutral: 3, domain.MoodGood: 4, domain.MoodGreat: 5}[mood]
}

func roundedAverage(total, count int) float64 {
	if count == 0 {
		return 0
	}
	return math.Round(float64(total)*100/float64(count)) / 100
}

func dominantMood(distribution map[string]int) domain.Mood {
	levels := []domain.Mood{domain.MoodGreat, domain.MoodGood, domain.MoodNeutral, domain.MoodLow, domain.MoodAwful}
	var best domain.Mood
	for _, mood := range levels {
		if distribution[string(mood)] > distribution[string(best)] {
			best = mood
		}
	}
	return best
}

func longestMoodStreak(entries []domain.MoodEntry) int {
	longest, current := 0, 0
	var previous time.Time
	for _, entry := range entries {
		date, _ := time.Parse("2006-01-02", entry.Date)
		if previous.IsZero() || date.Sub(previous) != 24*time.Hour {
			current = 1
		} else {
			current++
		}
		if current > longest {
			longest = current
		}
		previous = date
	}
	return longest
}
