package service

import (
	"sort"

	"github.com/example/studyflow/internal/domain"
)

func fitnessCalendarDays(rows []domain.FitnessEntry, start, end string) []domain.FitnessDay {
	days := map[string]domain.FitnessDay{}
	for _, row := range rows {
		if row.Deleted || row.Date < start || row.Date >= end || row.State != "completed" {
			continue
		}
		if row.Kind != "checkin" && row.Kind != "log" && row.Kind != "session" {
			continue
		}
		day := days[row.Date]
		day.Date = row.Date
		if row.Kind == "checkin" {
			day.ManualCheckIn = true
		} else {
			day.CompletedSessions++
			day.RecordedSeconds += row.ElapsedSeconds
		}
		days[row.Date] = day
	}
	result := make([]domain.FitnessDay, 0, len(days))
	for _, day := range days {
		result = append(result, day)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Date < result[j].Date })
	return result
}
