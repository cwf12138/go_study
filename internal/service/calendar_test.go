package service

import (
	"context"
	"testing"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/store"
)

func TestCalendarDayIncludesLunarFestivalSolarTermAndAlmanac(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	detail, err := svc.CalendarDay(context.Background(), "2026-02-17", false)
	if err != nil {
		t.Fatalf("CalendarDay: %v", err)
	}
	if detail.LunarFull != "正月初一" || detail.Zodiac != "马" {
		t.Fatalf("unexpected lunar detail: %#v", detail)
	}
	if !containsString(detail.Festivals, "春节") {
		t.Fatalf("festivals = %#v, want 春节", detail.Festivals)
	}
	if detail.HolidayName == "" || detail.HolidayType != "off" {
		t.Fatalf("holiday = %q/%q, want official day off", detail.HolidayName, detail.HolidayType)
	}
	if len(detail.Yi) == 0 || len(detail.Ji) == 0 || detail.Quote == "" {
		t.Fatalf("almanac or quote missing: %#v", detail)
	}

	term, err := svc.CalendarDay(context.Background(), "2026-04-05", false)
	if err != nil || term.SolarTerm != "清明" {
		t.Fatalf("Qingming detail = %#v, err = %v", term, err)
	}
}

func TestCalendarOverviewExpandsRecurringEvents(t *testing.T) {
	repository := store.NewMemory()
	svc := New(repository, nil, nil)
	start := time.Date(2026, 8, 31, 1, 0, 0, 0, calendarLocation)
	until := start.AddDate(0, 0, 20)
	event, err := svc.CreateCalendarEvent(context.Background(), "user-1", CreateCalendarEventInput{
		Title: "每周复盘", StartAt: start, EndAt: start.Add(time.Hour), RepeatRule: domain.CalendarRepeatWeekly,
		RepeatUntil: &until, Color: "#5b81ff", ReminderMinutes: 30,
	})
	if err != nil {
		t.Fatalf("CreateCalendarEvent: %v", err)
	}
	overview, err := svc.CalendarOverview(context.Background(), "user-1", "2026-08-31", "2026-09-22")
	if err != nil {
		t.Fatalf("CalendarOverview: %v", err)
	}
	if len(overview.Days) != 22 || len(overview.Events) != 3 {
		t.Fatalf("days/events = %d/%d, want 22/3", len(overview.Days), len(overview.Events))
	}
	for _, occurrence := range overview.Events {
		if occurrence.ID != event.ID || occurrence.OccurrenceID == "" {
			t.Fatalf("bad occurrence: %#v", occurrence)
		}
	}
}

func TestCalendarEventValidationAndOwnership(t *testing.T) {
	svc := New(store.NewMemory(), nil, nil)
	start := time.Now().Add(time.Hour)
	event, err := svc.CreateCalendarEvent(context.Background(), "owner", CreateCalendarEventInput{Title: "Study", StartAt: start, EndAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatalf("CreateCalendarEvent: %v", err)
	}
	if err := svc.DeleteCalendarEvent(context.Background(), "another-user", event.ID); err != domain.ErrForbidden {
		t.Fatalf("DeleteCalendarEvent error = %v, want forbidden", err)
	}
	bad := CreateCalendarEventInput{Title: "Invalid", StartAt: start, EndAt: start.Add(-time.Minute)}
	if _, err := svc.CreateCalendarEvent(context.Background(), "owner", bad); err == nil {
		t.Fatal("invalid time range was accepted")
	}
}

func TestMonthlyRecurrenceClampsToLastDayWithoutDrifting(t *testing.T) {
	base := time.Date(2026, time.January, 31, 9, 0, 0, 0, calendarLocation)
	february := recurrenceAt(base, domain.CalendarRepeatMonthly, 1)
	march := recurrenceAt(base, domain.CalendarRepeatMonthly, 2)
	if got := february.Format("2006-01-02 15:04"); got != "2026-02-28 09:00" {
		t.Fatalf("February recurrence = %s", got)
	}
	if got := march.Format("2006-01-02 15:04"); got != "2026-03-31 09:00" {
		t.Fatalf("March recurrence drifted to %s", got)
	}
}

func TestParseWikipediaDateExtract(t *testing.T) {
	extract := `9月1日是阳历年的第244天。

== 大事记 ==
=== 19世纪以前 ===
1271年：教宗额我略十世当选为教宗。
=== 20世纪 ===
1939年：第二次世界大战欧洲战场爆发。
=== 21世纪 ===
2022年：一项现代历史事件。

== 出生 ==
1854年：某人物出生。`
	events := parseWikipediaDateExtract(extract, "https://zh.wikipedia.org/wiki/9%E6%9C%881%E6%97%A5")
	if len(events) != 3 {
		t.Fatalf("events = %#v, want 3", events)
	}
	if events[0].Year != 2022 || events[1].Year != 1939 || events[2].Year != 1271 {
		t.Fatalf("events are not sorted newest first: %#v", events)
	}
	if events[0].URL == "" || events[1].Text == "" {
		t.Fatalf("event attribution missing: %#v", events)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
