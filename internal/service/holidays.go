package service

import (
	"sort"
	"time"

	"github.com/6tail/lunar-go/calendar"
)

// The verified schedule is deliberately separate from calculated festival dates.
// Add a new year only after checking the State Council's published arrangement.
const holidaySource2026 = "https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html"

type HolidayOccurrence struct {
	Name      string `json:"name"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	DaysUntil int    `json:"days_until"`
	Duration  int    `json:"duration"`
	Confirmed bool   `json:"confirmed"`
	SourceURL string `json:"source_url,omitempty"`
}

type HolidayCountdown struct {
	Today           string             `json:"today"`
	Timezone        string             `json:"timezone"`
	ScheduleThrough int                `json:"schedule_through"`
	Current         *HolidayOccurrence `json:"current"`
	Next            *HolidayOccurrence `json:"next"`
}

func (s *Service) NextHoliday() HolidayCountdown { return holidayCountdown(s.now()) }

func holidayCountdown(now time.Time) HolidayCountdown {
	local := now.In(calendarLocation)
	// Represent civil dates at UTC midnight: subtraction must count dates, not hours.
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	result := HolidayCountdown{Today: today.Format(calendarDateLayout), Timezone: "Asia/Shanghai", ScheduleThrough: 2026}
	if today.Year() < 1900 || today.Year() > 2099 {
		return result
	}
	items := append(holidayYear(today.Year()), holidayYear(today.Year()+1)...)
	sort.Slice(items, func(i, j int) bool { return items[i].StartDate < items[j].StartDate })
	for _, item := range items {
		if item.EndDate < result.Today {
			continue
		}
		start, _ := time.Parse(calendarDateLayout, item.StartDate)
		end, _ := time.Parse(calendarDateLayout, item.EndDate)
		item.DaysUntil = int(start.Sub(today) / (24 * time.Hour))
		if item.StartDate <= result.Today {
			item.DaysUntil = 0
			if result.Current == nil {
				copy := item
				result.Current = &copy
			}
			continue
		}
		if item.Confirmed {
			item.Duration = int(end.Sub(start)/(24*time.Hour)) + 1
		}
		copy := item
		result.Next = &copy
		break
	}
	return result
}

func holidayYear(year int) []HolidayOccurrence {
	if year == 2026 {
		items := []HolidayOccurrence{
			{Name: "元旦", StartDate: "2026-01-01", EndDate: "2026-01-03", Duration: 3},
			{Name: "春节", StartDate: "2026-02-15", EndDate: "2026-02-23", Duration: 9},
			{Name: "清明节", StartDate: "2026-04-04", EndDate: "2026-04-06", Duration: 3},
			{Name: "劳动节", StartDate: "2026-05-01", EndDate: "2026-05-05", Duration: 5},
			{Name: "端午节", StartDate: "2026-06-19", EndDate: "2026-06-21", Duration: 3},
			{Name: "中秋节", StartDate: "2026-09-25", EndDate: "2026-09-27", Duration: 3},
			{Name: "国庆节", StartDate: "2026-10-01", EndDate: "2026-10-07", Duration: 7},
		}
		for i := range items {
			items[i].Confirmed = true
			items[i].SourceURL = holidaySource2026
		}
		return items
	}
	var items []HolidayOccurrence
	add := func(name string, solar *calendar.Solar) {
		date := solar.ToYmd()
		items = append(items, HolidayOccurrence{Name: name, StartDate: date, EndDate: date})
	}
	add("元旦", calendar.NewSolarFromYmd(year, 1, 1))
	add("春节", calendar.NewLunarFromYmd(year, 1, 1).GetSolar())
	add("劳动节", calendar.NewSolarFromYmd(year, 5, 1))
	add("端午节", calendar.NewLunarFromYmd(year, 5, 5).GetSolar())
	add("中秋节", calendar.NewLunarFromYmd(year, 8, 15).GetSolar())
	add("国庆节", calendar.NewSolarFromYmd(year, 10, 1))
	for day := 3; day <= 6; day++ {
		solar := calendar.NewSolarFromYmd(year, 4, day)
		if solar.GetLunar().GetJieQi() == "清明" {
			add("清明节", solar)
			break
		}
	}
	return items
}
