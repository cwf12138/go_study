package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/example/studyflow/internal/domain"
)

type SaveCareInput struct {
	Title           string `json:"title"`
	Category        string `json:"category"`
	Interval        int    `json:"interval"`
	Unit            string `json:"unit"`
	Rhythm          string `json:"rhythm"`
	FirstDue        string `json:"first_due"`
	EstimateMinutes int    `json:"estimate_minutes"`
	Importance      string `json:"importance"`
	Note            string `json:"note"`
	Revision        int    `json:"revision"`
}
type CareActionInput struct {
	Action    string `json:"action"`
	CommandID string `json:"command_id"`
	Revision  int    `json:"revision"`
	Date      string `json:"date"`
	Note      string `json:"note"`
}

func careDate(anchor string, index, interval int, unit string) (string, error) {
	d, e := subscriptionDate(anchor)
	if e != nil {
		return "", e
	}
	if unit == "months" {
		month := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, calendarLocation).AddDate(0, index*interval, 0)
		last := month.AddDate(0, 1, -1).Day()
		day := d.Day()
		if day > last {
			day = last
		}
		d = time.Date(month.Year(), month.Month(), day, 0, 0, 0, 0, calendarLocation)
	} else {
		days := index * interval
		if unit == "weeks" {
			days *= 7
		}
		d = d.AddDate(0, 0, days)
	}
	value := d.Format(calendarDateLayout)
	if _, e = subscriptionDate(value); e != nil {
		return "", fitnessBad("下一次日期超出 2000–2100 年范围，请调整周期")
	}
	return value, nil
}
func careEffective(row domain.CareItem) string {
	if row.SnoozedUntil > row.NextDate {
		return row.SnoozedUntil
	}
	return row.NextDate
}
func (s *Service) ListCare(ctx context.Context, user string) ([]domain.CareItem, error) {
	return s.repo.ListCare(ctx, user)
}
func (s *Service) SaveCare(ctx context.Context, user, id string, in SaveCareInput) (domain.CareItem, error) {
	var zero domain.CareItem
	in.Title = strings.TrimSpace(in.Title)
	in.Note = strings.TrimSpace(in.Note)
	limit := map[string]int{"days": 365, "weeks": 52, "months": 24}[in.Unit]
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 || !fitnessText(in.Title, 80, true) || strings.ContainsAny(in.Title, "\r\n") || !fitnessText(in.Note, 1000, false) || !nutritionOne(in.Category, "home", "digital", "personal", "other") || !nutritionOne(in.Rhythm, "rolling", "fixed") || !nutritionOne(in.Importance, "normal", "high") || limit == 0 || in.Interval < 1 || in.Interval > limit || in.EstimateMinutes < 0 || in.EstimateMinutes > 480 {
		return zero, fitnessBad("请检查名称、分类、周期、节奏、重要程度和预计时长")
	}
	if _, e := subscriptionDate(in.FirstDue); e != nil {
		return zero, fitnessBad("请选择 2000–2100 年内有效的下次日期")
	}
	now := s.now().UTC()
	row, e := s.repo.CareByID(ctx, user, id)
	if e != nil {
		if !errors.Is(e, domain.ErrNotFound) {
			return zero, e
		}
		row = domain.CareItem{ID: id, UserID: user, State: "active", CreatedAt: now, History: []domain.CareCompletion{}}
	}
	if row.Deleted {
		return zero, fitnessBad("请先从回收站恢复事项再编辑")
	}
	if row.Revision == 0 || row.NextDate != in.FirstDue || row.Interval != in.Interval || row.Unit != in.Unit || row.Rhythm != in.Rhythm {
		row.AnchorDate = in.FirstDue
		row.Index = 0
		row.NextDate = in.FirstDue
		row.SnoozedUntil = ""
	}
	row.Title, row.Category, row.Interval, row.Unit, row.Rhythm = in.Title, in.Category, in.Interval, in.Unit, in.Rhythm
	row.EstimateMinutes, row.Importance, row.Note = in.EstimateMinutes, in.Importance, in.Note
	row.Undo = nil
	row.LastCommandID = ""
	row.LastCommandHash = ""
	row.UpdatedAt = now
	return s.repo.SaveCare(ctx, row, in.Revision)
}
func (s *Service) CareAction(ctx context.Context, user, id string, in CareActionInput) (domain.CareItem, error) {
	var zero domain.CareItem
	if !ledgerID.MatchString(id) || !ledgerID.MatchString(in.CommandID) || in.Revision < 1 || in.Revision > 1000000 || !fitnessText(in.Note, 500, false) {
		return zero, fitnessBad("无效版本、操作标识或备注（最多 500 字）")
	}
	row, e := s.repo.CareByID(ctx, user, id)
	if e != nil {
		return zero, e
	}
	raw, _ := json.Marshal(in)
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	if row.LastCommandID == in.CommandID && row.LastCommandHash == hash && row.Revision == in.Revision+1 {
		return row, nil
	}
	if row.Revision != in.Revision {
		return zero, fmt.Errorf("%w: 事项已更新，请先核对当前记录", domain.ErrConflict)
	}
	now := s.now().UTC()
	today := now.In(calendarLocation).Format(calendarDateLayout)
	if row.Deleted && in.Action != "restore" {
		return zero, domain.ErrInvalidState
	}
	undo := row.Undo
	row.Undo = nil
	switch in.Action {
	case "complete":
		if row.State != "active" || row.Deleted {
			return zero, domain.ErrInvalidState
		}
		date, e := subscriptionDate(in.Date)
		if e != nil || in.Date > today || in.Date < row.LastDoneDate {
			return zero, fitnessBad("完成日期须有效、不晚于今天且不早于上次完成日期")
		}
		u := &domain.CareUndo{AnchorDate: row.AnchorDate, Index: row.Index, SnoozedUntil: row.SnoozedUntil, LastDoneDate: row.LastDoneDate}
		if row.Rhythm == "rolling" {
			row.AnchorDate = in.Date
			row.Index = 1
		} else {
			row.Index++
			anchor, _ := subscriptionDate(row.AnchorDate)
			candidate := 0
			if row.Unit == "months" {
				candidate = ((date.Year()-anchor.Year())*12 + int(date.Month()-anchor.Month())) / row.Interval
			} else {
				step := row.Interval
				if row.Unit == "weeks" {
					step *= 7
				}
				candidate = int(date.Sub(anchor).Hours()/24) / step
			}
			if candidate > row.Index {
				row.Index = candidate
			}
			for {
				next, e := careDate(row.AnchorDate, row.Index, row.Interval, row.Unit)
				if e != nil {
					return zero, e
				}
				if next > in.Date {
					break
				}
				row.Index++
			}
		}
		next, e := careDate(row.AnchorDate, row.Index, row.Interval, row.Unit)
		if e != nil {
			return zero, e
		}
		row.NextDate = next
		row.SnoozedUntil = ""
		row.LastDoneDate = in.Date
		row.TotalCompletions++
		if len(row.History) >= 100 {
			d := row.History[0]
			u.Dropped = &d
			row.History = row.History[1:]
		}
		row.History = append(row.History, domain.CareCompletion{ID: in.CommandID, Date: in.Date, Note: strings.TrimSpace(in.Note), CreatedAt: now})
		row.Undo = u
	case "undo":
		if undo == nil || len(row.History) == 0 {
			return zero, fitnessBad("只能撤销最近一次完成，编辑、推迟等操作后不再支持撤销")
		}
		row.AnchorDate, row.Index, row.SnoozedUntil, row.LastDoneDate = undo.AnchorDate, undo.Index, undo.SnoozedUntil, undo.LastDoneDate
		row.NextDate, e = careDate(row.AnchorDate, row.Index, row.Interval, row.Unit)
		if e != nil {
			return zero, e
		}
		row.TotalCompletions--
		row.History = row.History[:len(row.History)-1]
		if undo.Dropped != nil {
			row.History = append([]domain.CareCompletion{*undo.Dropped}, row.History...)
		}
	case "snooze":
		_, e := subscriptionDate(in.Date)
		if e != nil || in.Date <= today || in.Date <= row.NextDate || in.Date > now.In(calendarLocation).AddDate(0, 0, 90).Format(calendarDateLayout) || row.State != "active" {
			return zero, fitnessBad("推迟日期须晚于今天及原计划日期，且在未来 90 天内")
		}
		row.SnoozedUntil = in.Date
	case "unsnooze":
		row.SnoozedUntil = ""
	case "pause":
		if row.State != "active" {
			return zero, domain.ErrInvalidState
		}
		row.State = "paused"
	case "resume":
		if row.State != "paused" {
			return zero, domain.ErrInvalidState
		}
		row.State = "active"
	case "archive":
		row.Deleted = true
	case "restore":
		if !row.Deleted {
			return zero, domain.ErrInvalidState
		}
		row.Deleted = false
	default:
		return zero, fitnessBad("不支持的保养操作")
	}
	row.LastCommandID = in.CommandID
	row.LastCommandHash = hash
	row.UpdatedAt = now
	return s.repo.SaveCare(ctx, row, in.Revision)
}
func careCalendarEntries(rows []domain.CareItem, start, end string) []domain.CareCalendarEntry {
	result := []domain.CareCalendarEntry{}
	for _, r := range rows {
		if r.Deleted {
			continue
		}
		date := careEffective(r)
		if r.State == "active" && date >= start && date < end {
			result = append(result, domain.CareCalendarEntry{ItemID: r.ID, Date: date, Title: r.Title, Kind: "due"})
		}
		for _, h := range r.History {
			if h.Date >= start && h.Date < end {
				result = append(result, domain.CareCalendarEntry{ItemID: r.ID, Date: h.Date, Title: r.Title, Kind: "done"})
			}
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Date == result[j].Date {
			return result[i].ItemID < result[j].ItemID
		}
		return result[i].Date < result[j].Date
	})
	return result
}
