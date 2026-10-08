package service

import (
	"testing"
	"time"
)

func TestHolidayCountdown(t *testing.T) {
	for _, test := range []struct {
		now, today, next, start, current string
		days                             int
		confirmed                        bool
	}{
		{"2025-12-31T04:00:00Z", "2025-12-31", "元旦", "2026-01-01", "", 1, true},
		{"2026-02-14T12:00:00Z", "2026-02-14", "春节", "2026-02-15", "", 1, true},
		{"2026-02-15T00:00:00Z", "2026-02-15", "清明节", "2026-04-04", "春节", 48, true},
		{"2026-09-27T10:00:00Z", "2026-09-27", "国庆节", "2026-10-01", "中秋节", 4, true},
		{"2026-10-07T10:00:00Z", "2026-10-07", "元旦", "2027-01-01", "国庆节", 86, false},
		{"2026-10-08T15:59:59Z", "2026-10-08", "元旦", "2027-01-01", "", 85, false},
		{"2026-10-08T16:00:00Z", "2026-10-09", "元旦", "2027-01-01", "", 84, false},
		{"2026-10-10T00:00:00Z", "2026-10-10", "元旦", "2027-01-01", "", 83, false}, // make-up workday, not a holiday
		{"2027-01-02T00:00:00Z", "2027-01-02", "春节", "2027-02-06", "", 35, false},
	} {
		t.Run(test.now, func(t *testing.T) {
			now, _ := time.Parse(time.RFC3339, test.now)
			result := holidayCountdown(now)
			if result.Today != test.today || result.Next == nil {
				t.Fatalf("unexpected result: %+v", result)
			}
			n := result.Next
			if n.Name != test.next || n.StartDate != test.start || n.DaysUntil != test.days || n.Confirmed != test.confirmed {
				t.Fatalf("next = %+v", n)
			}
			if test.current == "" && result.Current != nil || test.current != "" && (result.Current == nil || result.Current.Name != test.current || result.Current.DaysUntil != 0) {
				t.Fatalf("current = %+v", result.Current)
			}
			if !n.Confirmed && (n.Duration != 0 || n.SourceURL != "") {
				t.Fatal("calculated festival must not claim official leave duration/source")
			}
		})
	}
}

func TestHolidayCatalogAndYearBounds(t *testing.T) {
	for _, year := range []int{2026, 2027, 2028, 2099} {
		items := holidayYear(year)
		if len(items) != 7 {
			t.Fatalf("year %d: got %d holidays", year, len(items))
		}
		for _, item := range items {
			start, err := time.Parse(calendarDateLayout, item.StartDate)
			if err != nil || start.Year() != year {
				t.Fatalf("invalid date: %+v", item)
			}
			end, err := time.Parse(calendarDateLayout, item.EndDate)
			if err != nil || end.Before(start) {
				t.Fatalf("invalid range: %+v", item)
			}
			if year == 2026 && (!item.Confirmed || item.SourceURL == "" || item.Duration != int(end.Sub(start)/(24*time.Hour))+1) {
				t.Fatalf("invalid verified record: %+v", item)
			}
		}
	}
	if holidayCountdown(time.Date(2200, 1, 1, 0, 0, 0, 0, time.UTC)).Next != nil {
		t.Fatal("out of supported range")
	}
}
