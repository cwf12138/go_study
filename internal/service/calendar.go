package service

import (
	"container/list"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/6tail/lunar-go/HolidayUtil"
	"github.com/6tail/lunar-go/calendar"
	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
	"github.com/example/studyflow/internal/store"
)

const calendarDateLayout = "2006-01-02"

var calendarLocation = func() *time.Location {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*60*60)
	}
	return location
}()

type CreateCalendarEventInput struct {
	Title           string
	Description     string
	Location        string
	Category        string
	Color           string
	StartAt         time.Time
	EndAt           time.Time
	AllDay          bool
	RepeatRule      domain.CalendarRepeatRule
	RepeatUntil     *time.Time
	ReminderMinutes int
}

type UpdateCalendarEventInput struct {
	Title            *string
	Description      *string
	Location         *string
	Category         *string
	Color            *string
	StartAt          *time.Time
	EndAt            *time.Time
	AllDay           *bool
	RepeatRule       *domain.CalendarRepeatRule
	RepeatUntil      *time.Time
	ClearRepeatUntil bool
	ReminderMinutes  *int
}

func (s *Service) CreateCalendarEvent(ctx context.Context, userID string, input CreateCalendarEventInput) (domain.CalendarEvent, error) {
	event := domain.CalendarEvent{
		ID: platform.NewID(), UserID: userID, Title: strings.TrimSpace(input.Title),
		Description: strings.TrimSpace(input.Description), Location: strings.TrimSpace(input.Location),
		Category: strings.TrimSpace(input.Category), Color: strings.TrimSpace(input.Color),
		StartAt: input.StartAt.UTC(), EndAt: input.EndAt.UTC(), AllDay: input.AllDay,
		RepeatRule: input.RepeatRule, RepeatUntil: input.RepeatUntil, ReminderMinutes: input.ReminderMinutes,
	}
	if err := validateCalendarEvent(&event); err != nil {
		return domain.CalendarEvent{}, err
	}
	now := s.now().UTC()
	event.CreatedAt, event.UpdatedAt = now, now
	if err := s.repo.CreateCalendarEvent(ctx, event); err != nil {
		return domain.CalendarEvent{}, err
	}
	s.publish("calendar_event.created", userID, event.ID, map[string]any{"title": event.Title})
	return event, nil
}

func (s *Service) UpdateCalendarEvent(ctx context.Context, userID, eventID string, input UpdateCalendarEventInput) (domain.CalendarEvent, error) {
	event, err := s.repo.CalendarEventByID(ctx, eventID)
	if err != nil {
		return domain.CalendarEvent{}, err
	}
	if err := requireOwner(event.UserID, userID); err != nil {
		return domain.CalendarEvent{}, err
	}
	if input.Title != nil {
		event.Title = strings.TrimSpace(*input.Title)
	}
	if input.Description != nil {
		event.Description = strings.TrimSpace(*input.Description)
	}
	if input.Location != nil {
		event.Location = strings.TrimSpace(*input.Location)
	}
	if input.Category != nil {
		event.Category = strings.TrimSpace(*input.Category)
	}
	if input.Color != nil {
		event.Color = strings.TrimSpace(*input.Color)
	}
	if input.StartAt != nil {
		event.StartAt = input.StartAt.UTC()
	}
	if input.EndAt != nil {
		event.EndAt = input.EndAt.UTC()
	}
	if input.AllDay != nil {
		event.AllDay = *input.AllDay
	}
	if input.RepeatRule != nil {
		event.RepeatRule = *input.RepeatRule
	}
	if input.ClearRepeatUntil {
		event.RepeatUntil = nil
	} else if input.RepeatUntil != nil {
		until := input.RepeatUntil.UTC()
		event.RepeatUntil = &until
	}
	if input.ReminderMinutes != nil {
		event.ReminderMinutes = *input.ReminderMinutes
	}
	if err := validateCalendarEvent(&event); err != nil {
		return domain.CalendarEvent{}, err
	}
	event.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateCalendarEvent(ctx, event); err != nil {
		return domain.CalendarEvent{}, err
	}
	s.publish("calendar_event.updated", userID, event.ID, nil)
	return event, nil
}

func (s *Service) DeleteCalendarEvent(ctx context.Context, userID, eventID string) error {
	event, err := s.repo.CalendarEventByID(ctx, eventID)
	if err != nil {
		return err
	}
	if err := requireOwner(event.UserID, userID); err != nil {
		return err
	}
	if err := s.repo.DeleteCalendarEvent(ctx, eventID); err != nil {
		return err
	}
	s.publish("calendar_event.deleted", userID, eventID, nil)
	return nil
}

func validateCalendarEvent(event *domain.CalendarEvent) error {
	if event.Title == "" || len(event.Title) > 160 || len(event.Description) > 6000 || len(event.Location) > 240 || len(event.Category) > 60 {
		return fmt.Errorf("%w: calendar event text is invalid", domain.ErrInvalidInput)
	}
	if event.StartAt.IsZero() || event.EndAt.IsZero() || !event.EndAt.After(event.StartAt) || event.EndAt.Sub(event.StartAt) > 366*24*time.Hour {
		return fmt.Errorf("%w: event end must be after start and within one year", domain.ErrInvalidInput)
	}
	if event.RepeatRule == "" {
		event.RepeatRule = domain.CalendarRepeatNone
	}
	switch event.RepeatRule {
	case domain.CalendarRepeatNone, domain.CalendarRepeatDaily, domain.CalendarRepeatWeekly, domain.CalendarRepeatMonthly, domain.CalendarRepeatYearly:
	default:
		return fmt.Errorf("%w: unsupported repeat rule", domain.ErrInvalidInput)
	}
	if event.RepeatRule == domain.CalendarRepeatNone {
		event.RepeatUntil = nil
	}
	if event.RepeatUntil != nil && event.RepeatUntil.Before(event.StartAt) {
		return fmt.Errorf("%w: repeat_until cannot precede start_at", domain.ErrInvalidInput)
	}
	if event.ReminderMinutes < 0 || event.ReminderMinutes > 40320 {
		return fmt.Errorf("%w: reminder must be between 0 and 40320 minutes", domain.ErrInvalidInput)
	}
	if event.Color == "" {
		event.Color = "#5b81ff"
	}
	if len(event.Color) != 7 || event.Color[0] != '#' {
		return fmt.Errorf("%w: color must use #RRGGBB", domain.ErrInvalidInput)
	}
	if event.Category == "" {
		event.Category = "学习"
	}
	return nil
}

func (s *Service) CalendarOverview(ctx context.Context, userID, startValue, endValue string) (domain.CalendarOverview, error) {
	start, err := time.ParseInLocation(calendarDateLayout, startValue, calendarLocation)
	if err != nil {
		return domain.CalendarOverview{}, fmt.Errorf("%w: start must use YYYY-MM-DD", domain.ErrInvalidInput)
	}
	end, err := time.ParseInLocation(calendarDateLayout, endValue, calendarLocation)
	if err != nil || !end.After(start) || end.Sub(start) > 370*24*time.Hour {
		return domain.CalendarOverview{}, fmt.Errorf("%w: calendar range must contain 1 to 370 days", domain.ErrInvalidInput)
	}
	events, err := s.repo.ListCalendarEvents(ctx, userID)
	if err != nil {
		return domain.CalendarOverview{}, err
	}
	blocks, err := s.repo.ListPlanBlocks(ctx, userID, start.UTC(), end.UTC())
	if err != nil {
		return domain.CalendarOverview{}, err
	}
	tasks, err := s.repo.ListTasks(ctx, userID, store.TaskFilter{})
	if err != nil {
		return domain.CalendarOverview{}, err
	}
	todos, err := s.repo.ListTodos(ctx, userID, store.TodoFilter{})
	if err != nil {
		return domain.CalendarOverview{}, err
	}
	moods, err := s.repo.ListAllMoodEntries(ctx, userID)
	if err != nil {
		return domain.CalendarOverview{}, err
	}
	overview := domain.CalendarOverview{Start: startValue, End: endValue, PlanBlocks: blocks}
	for day := start; day.Before(end); day = day.AddDate(0, 0, 1) {
		overview.Days = append(overview.Days, calendarDaySummary(day))
	}
	overview.Events = expandCalendarEvents(events, start, end)
	for _, task := range tasks {
		if task.DueAt != nil && !task.DueAt.Before(start.UTC()) && task.DueAt.Before(end.UTC()) {
			overview.Tasks = append(overview.Tasks, task)
		}
	}
	for _, todo := range todos {
		if todo.DueAt != nil && !todo.DueAt.Before(start.UTC()) && todo.DueAt.Before(end.UTC()) {
			overview.Todos = append(overview.Todos, todo)
		}
	}
	for _, mood := range moods {
		if mood.Date >= startValue && mood.Date < endValue {
			overview.MoodEntries = append(overview.MoodEntries, mood)
		}
	}
	return overview, nil
}

func expandCalendarEvents(events []domain.CalendarEvent, start, end time.Time) []domain.CalendarOccurrence {
	occurrences := make([]domain.CalendarOccurrence, 0)
	for _, event := range events {
		duration := event.EndAt.Sub(event.StartAt)
		current := event.StartAt.In(calendarLocation)
		if event.RepeatRule == domain.CalendarRepeatNone {
			if event.EndAt.After(start) && event.StartAt.Before(end) {
				occurrences = append(occurrences, makeOccurrence(event, event.StartAt, event.EndAt))
			}
			continue
		}
		for i := 0; i < 5000 && current.Before(end); i++ {
			currentEnd := current.Add(duration)
			if event.RepeatUntil != nil && current.After(event.RepeatUntil.In(calendarLocation)) {
				break
			}
			if currentEnd.After(start) {
				occurrences = append(occurrences, makeOccurrence(event, current.UTC(), currentEnd.UTC()))
			}
			current = recurrenceAt(event.StartAt.In(calendarLocation), event.RepeatRule, i+1)
		}
	}
	sort.Slice(occurrences, func(i, j int) bool { return occurrences[i].OccurrenceStart.Before(occurrences[j].OccurrenceStart) })
	return occurrences
}

func recurrenceAt(base time.Time, rule domain.CalendarRepeatRule, occurrence int) time.Time {
	switch rule {
	case domain.CalendarRepeatDaily:
		return base.AddDate(0, 0, occurrence)
	case domain.CalendarRepeatWeekly:
		return base.AddDate(0, 0, occurrence*7)
	case domain.CalendarRepeatMonthly:
		targetFirst := time.Date(base.Year(), base.Month()+time.Month(occurrence), 1, base.Hour(), base.Minute(), base.Second(), base.Nanosecond(), base.Location())
		lastDay := time.Date(targetFirst.Year(), targetFirst.Month()+1, 0, base.Hour(), base.Minute(), base.Second(), base.Nanosecond(), base.Location()).Day()
		day := base.Day()
		if day > lastDay {
			day = lastDay
		}
		return time.Date(targetFirst.Year(), targetFirst.Month(), day, base.Hour(), base.Minute(), base.Second(), base.Nanosecond(), base.Location())
	case domain.CalendarRepeatYearly:
		year := base.Year() + occurrence
		day := base.Day()
		if base.Month() == time.February && day == 29 && time.Date(year, time.March, 0, 0, 0, 0, 0, base.Location()).Day() != 29 {
			day = 28
		}
		return time.Date(year, base.Month(), day, base.Hour(), base.Minute(), base.Second(), base.Nanosecond(), base.Location())
	default:
		return base
	}
}

func makeOccurrence(event domain.CalendarEvent, start, end time.Time) domain.CalendarOccurrence {
	return domain.CalendarOccurrence{CalendarEvent: event, OccurrenceID: event.ID + "@" + start.UTC().Format("20060102T150405Z"), OccurrenceStart: start, OccurrenceEnd: end}
}

func (s *Service) CalendarDay(ctx context.Context, dateValue string, includeHistory bool) (domain.CalendarDayDetail, error) {
	day, err := time.ParseInLocation(calendarDateLayout, dateValue, calendarLocation)
	if err != nil {
		return domain.CalendarDayDetail{}, fmt.Errorf("%w: date must use YYYY-MM-DD", domain.ErrInvalidInput)
	}
	solar := calendar.NewSolarFromYmd(day.Year(), int(day.Month()), day.Day())
	lunar := solar.GetLunar()
	detail := domain.CalendarDayDetail{
		CalendarDaySummary: calendarDaySummary(day), Weekday: weekdayChinese(day.Weekday()),
		LunarFull: lunar.GetMonthInChinese() + "月" + lunar.GetDayInChinese(),
		GanZhi:    lunar.GetYearInGanZhi() + "年 " + lunar.GetMonthInGanZhi() + "月 " + lunar.GetDayInGanZhi() + "日",
		Zodiac:    lunar.GetYearShengXiao(), Constellation: solar.GetXingZuo(),
		Yi: listStrings(lunar.GetDayYi(), 8), Ji: listStrings(lunar.GetDayJi(), 8),
		Chong: lunar.GetDayChongDesc(), Sha: lunar.GetDaySha(),
		LuckyGod:  lunar.GetDayTianShen() + " · " + lunar.GetDayTianShenLuck(),
		WealthGod: lunar.GetDayPositionCaiDesc(),
	}
	detail.Quote, detail.QuoteAuthor = dailyQuote(day)
	if includeHistory {
		detail.History, detail.HistorySource = s.historyOnThisDay(ctx, day)
	}
	return detail, nil
}

func calendarDaySummary(day time.Time) domain.CalendarDaySummary {
	solar := calendar.NewSolarFromYmd(day.Year(), int(day.Month()), day.Day())
	lunar := solar.GetLunar()
	lunarLabel := lunar.GetDayInChinese()
	if lunar.GetDay() == 1 {
		lunarLabel = lunar.GetMonthInChinese() + "月"
	}
	festivals := append(listStrings(solar.GetFestivals(), 4), listStrings(lunar.GetFestivals(), 4)...)
	if term := lunar.GetJieQi(); term != "" {
		festivals = append(festivals, term)
	}
	summary := domain.CalendarDaySummary{Date: day.Format(calendarDateLayout), Lunar: lunarLabel, SolarTerm: lunar.GetJieQi(), Festivals: uniqueStrings(festivals)}
	if holiday := HolidayUtil.GetHoliday(summary.Date); holiday != nil {
		summary.HolidayName = holiday.GetName()
		if holiday.IsWork() {
			summary.HolidayType = "work"
		} else {
			summary.HolidayType = "off"
		}
	}
	return summary
}

func listStrings(values *list.List, limit int) []string {
	items := make([]string, 0)
	if values == nil {
		return items
	}
	for item := values.Front(); item != nil && len(items) < limit; item = item.Next() {
		if value, ok := item.Value.(string); ok && value != "" {
			items = append(items, value)
		}
	}
	return items
}

func uniqueStrings(values []string) []string {
	seen, result := map[string]bool{}, make([]string, 0, len(values))
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func weekdayChinese(day time.Weekday) string {
	return []string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}[day]
}

func dailyQuote(day time.Time) (string, string) {
	quotes := [][2]string{
		{"知之者不如好之者，好之者不如乐之者。", "《论语》"},
		{"千里之行，始于足下。", "《道德经》"},
		{"博学之，审问之，慎思之，明辨之，笃行之。", "《礼记》"},
		{"不积跬步，无以至千里。", "《荀子》"},
		{"纸上得来终觉浅，绝知此事要躬行。", "陆游"},
		{"学而不思则罔，思而不学则殆。", "《论语》"},
		{"日日行，不怕千万里；常常做，不怕千万事。", "《格言联璧》"},
		{"读书百遍，而义自见。", "《三国志》"},
	}
	index := int(day.Unix()/86400) % len(quotes)
	if index < 0 {
		index += len(quotes)
	}
	item := quotes[index]
	return item[0], item[1]
}

type historyCacheEntry struct {
	Events []domain.HistoricalEvent
	Source string
}

type historyProviderResult struct {
	Events []domain.HistoricalEvent
	Source string
}

func (s *Service) historyOnThisDay(ctx context.Context, day time.Time) ([]domain.HistoricalEvent, string) {
	key := day.Format("01-02")
	s.historyMu.RLock()
	cached, ok := s.historyCache[key]
	s.historyMu.RUnlock()
	if ok && len(cached.Events) > 0 {
		return append([]domain.HistoricalEvent(nil), cached.Events...), cached.Source
	}

	events, source := fetchOnThisDay(ctx, day)
	if len(events) > 0 {
		s.historyMu.Lock()
		if s.historyCache == nil {
			s.historyCache = make(map[string]historyCacheEntry)
		}
		s.historyCache[key] = historyCacheEntry{Events: append([]domain.HistoricalEvent(nil), events...), Source: source}
		s.historyMu.Unlock()
	}
	return events, source
}

// fetchOnThisDay races two independent Wikimedia interfaces. The structured
// Wikifeeds response is rich but large, while the Action API date extract is
// much smaller. Whichever returns usable Chinese content first wins.
func fetchOnThisDay(ctx context.Context, day time.Time) ([]domain.HistoricalEvent, string) {
	requestCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	results := make(chan historyProviderResult, 2)
	providers := []func(context.Context, time.Time) historyProviderResult{
		fetchWikipediaDateExtract,
		fetchWikifeedsHistory,
	}
	for _, provider := range providers {
		provider := provider
		go func() {
			result := provider(requestCtx, day)
			select {
			case results <- result:
			case <-requestCtx.Done():
			}
		}()
	}
	for range providers {
		select {
		case result := <-results:
			if len(result.Events) > 0 {
				cancel()
				return result.Events, result.Source
			}
		case <-requestCtx.Done():
			return fallbackHistory(day), "离线精选"
		}
	}
	return fallbackHistory(day), "离线精选"
}

func fetchWikifeedsHistory(ctx context.Context, day time.Time) historyProviderResult {
	endpoint := fmt.Sprintf("https://zh.wikipedia.org/api/rest_v1/feed/onthisday/events/%02d/%02d", day.Month(), day.Day())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return historyProviderResult{}
	}
	request.Header.Set("User-Agent", "StudyFlow/1.0 (calendar learning project)")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return historyProviderResult{}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return historyProviderResult{}
	}
	var payload struct {
		Events []struct {
			Text  string `json:"text"`
			Year  int    `json:"year"`
			Pages []struct {
				Titles struct {
					Canonical string `json:"canonical"`
				} `json:"titles"`
			} `json:"pages"`
		} `json:"events"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&payload) != nil {
		return historyProviderResult{}
	}
	result := make([]domain.HistoricalEvent, 0, 6)
	for _, item := range payload.Events {
		if len(result) == 6 {
			break
		}
		entry := domain.HistoricalEvent{Year: item.Year, Text: strings.TrimSpace(item.Text)}
		if len(item.Pages) > 0 && item.Pages[0].Titles.Canonical != "" {
			entry.URL = "https://zh.wikipedia.org/wiki/" + url.PathEscape(item.Pages[0].Titles.Canonical)
		}
		if entry.Text != "" {
			result = append(result, entry)
		}
	}
	return historyProviderResult{Events: result, Source: "Wikipedia Wikifeeds / CC BY-SA"}
}

var historyLinePattern = regexp.MustCompile(`^\s*(?:(?:公元前|前)(\d{1,5})|(\d{1,5}))年\s*[：:—－-]+\s*(.+?)\s*$`)

func fetchWikipediaDateExtract(ctx context.Context, day time.Time) historyProviderResult {
	title := fmt.Sprintf("%d月%d日", day.Month(), day.Day())
	query := url.Values{
		"action":        {"query"},
		"prop":          {"extracts"},
		"explaintext":   {"1"},
		"redirects":     {"1"},
		"format":        {"json"},
		"formatversion": {"2"},
		"titles":        {title},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://zh.wikipedia.org/w/api.php?"+query.Encode(), nil)
	if err != nil {
		return historyProviderResult{}
	}
	request.Header.Set("User-Agent", "StudyFlow/1.0 (calendar learning project)")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return historyProviderResult{}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return historyProviderResult{}
	}
	var payload struct {
		Query struct {
			Pages []struct {
				Extract string `json:"extract"`
			} `json:"pages"`
		} `json:"query"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 512<<10)).Decode(&payload) != nil || len(payload.Query.Pages) == 0 {
		return historyProviderResult{}
	}
	events := parseWikipediaDateExtract(payload.Query.Pages[0].Extract, "https://zh.wikipedia.org/wiki/"+url.PathEscape(title))
	return historyProviderResult{Events: events, Source: "中文维基百科日期条目 / CC BY-SA"}
}

func parseWikipediaDateExtract(extract, pageURL string) []domain.HistoricalEvent {
	start := strings.Index(extract, "== 大事记 ==")
	headerLength := len("== 大事记 ==")
	if start < 0 {
		start = strings.Index(extract, "== 大事記 ==")
		headerLength = len("== 大事記 ==")
	}
	if start < 0 {
		return nil
	}
	section := extract[start+headerLength:]
	if end := strings.Index(section, "\n== "); end >= 0 {
		section = section[:end]
	}
	events := make([]domain.HistoricalEvent, 0, 32)
	for _, line := range strings.Split(section, "\n") {
		matches := historyLinePattern.FindStringSubmatch(strings.TrimSpace(strings.TrimPrefix(line, "*")))
		if len(matches) != 4 {
			continue
		}
		yearText := matches[2]
		negative := false
		if matches[1] != "" {
			yearText, negative = matches[1], true
		}
		year := 0
		for _, digit := range yearText {
			year = year*10 + int(digit-'0')
		}
		if negative {
			year = -year
		}
		text := strings.TrimSpace(matches[3])
		if text != "" {
			events = append(events, domain.HistoricalEvent{Year: year, Text: truncateRunes(text, 420), URL: pageURL})
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].Year > events[j].Year })
	if len(events) > 6 {
		events = events[:6]
	}
	return events
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}

func fallbackHistory(day time.Time) []domain.HistoricalEvent {
	if day.Month() == time.October && day.Day() == 1 {
		return []domain.HistoricalEvent{{Year: 1949, Text: "中华人民共和国中央人民政府成立。"}}
	}
	if day.Month() == time.July && day.Day() == 1 {
		return []domain.HistoricalEvent{{Year: 1921, Text: "中国共产党成立纪念日。"}}
	}
	if day.Month() == time.May && day.Day() == 4 {
		return []domain.HistoricalEvent{{Year: 1919, Text: "五四运动爆发。"}}
	}
	return nil
}
