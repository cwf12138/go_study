package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"strings"
	"time"
	"unicode/utf8"
)

type SaveFitnessInput struct {
	Kind           string               `json:"kind"`
	Title          string               `json:"title"`
	Category       string               `json:"category"`
	Equipment      string               `json:"equipment"`
	Note           string               `json:"note"`
	Date           string               `json:"date"`
	State          string               `json:"state"`
	RoutineID      string               `json:"routine_id"`
	Moves          []domain.FitnessMove `json:"moves"`
	ElapsedSeconds int                  `json:"elapsed_seconds"`
	Effort         int                  `json:"effort"`
	WeeklyMinutes  int                  `json:"weekly_minutes"`
	WeeklySessions int                  `json:"weekly_sessions"`
	Deleted        bool                 `json:"deleted"`
	Revision       int                  `json:"revision"`
}
type StartFitnessInput struct {
	SourceID  string               `json:"source_id"`
	Title     string               `json:"title"`
	Category  string               `json:"category"`
	Equipment string               `json:"equipment"`
	Moves     []domain.FitnessMove `json:"moves"`
}
type FitnessActionInput struct {
	Action    string `json:"action"`
	CommandID string `json:"command_id"`
	Revision  int    `json:"revision"`
	Note      string `json:"note"`
	Effort    int    `json:"effort"`
}

func fitnessBad(message string) error { return fmt.Errorf("%w: %s", domain.ErrInvalidInput, message) }
func fitnessCategory(value string) bool {
	return value == "strength" || value == "cardio" || value == "mobility"
}
func fitnessEquipment(value string) bool {
	return value == "none" || value == "chair" || value == "dumbbell"
}
func fitnessText(value string, max int, required bool) bool {
	return (!required || strings.TrimSpace(value) != "") && utf8.RuneCountInString(value) <= max
}
func fitnessMoves(moves []domain.FitnessMove) ([]domain.FitnessMove, error) {
	if len(moves) < 1 || len(moves) > 16 {
		return nil, fitnessBad("一套训练须包含 1–16 个动作")
	}
	result := make([]domain.FitnessMove, len(moves))
	total := 0
	for i, move := range moves {
		move.Name = strings.TrimSpace(move.Name)
		move.Instruction = strings.TrimSpace(move.Instruction)
		if !fitnessText(move.Name, 80, true) || strings.ContainsAny(move.Name, "\r\n") || !fitnessText(move.Instruction, 1000, false) || move.Sets < 1 || move.Sets > 8 || move.RestSeconds < 0 || move.RestSeconds > 300 || (move.Mode != "reps" && move.Mode != "time") || move.Target < 1 || (move.Mode == "reps" && move.Target > 100) || (move.Mode == "time" && move.Target > 3600) || move.Done != 0 || move.Skipped != 0 {
			return nil, fitnessBad("动作须有名称；每项 1–8 组，计次 1–100 次或计时 1–3600 秒，休息 0–300 秒；新动作不能携带完成数据")
		}
		total += move.Sets
		result[i] = move
	}
	if total > 64 {
		return nil, fitnessBad("一场训练最多 64 组，请减少组数")
	}
	return result, nil
}
func (s *Service) ListFitness(ctx context.Context, user string) ([]domain.FitnessEntry, error) {
	return s.repo.ListFitness(ctx, user)
}
func (s *Service) FitnessEntry(ctx context.Context, user, id string) (domain.FitnessEntry, error) {
	return s.repo.FitnessByID(ctx, user, id)
}
func (s *Service) SaveFitness(ctx context.Context, user, id string, in SaveFitnessInput) (domain.FitnessEntry, error) {
	var zero domain.FitnessEntry
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return zero, fitnessBad("无效标识或版本")
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Note = strings.TrimSpace(in.Note)
	if !fitnessText(in.Note, 2000, false) || in.Effort < 0 || in.Effort > 5 {
		return zero, fitnessBad("备注最多 2000 字，自评范围 0–5")
	}
	now := s.now().UTC()
	row := domain.FitnessEntry{ID: id, UserID: user, Kind: in.Kind, Title: in.Title, Category: in.Category, Equipment: in.Equipment, Note: in.Note, Date: in.Date, State: in.State, Effort: in.Effort, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}
	switch in.Kind {
	case "checkin":
		if _, err := subscriptionDate(in.Date); err != nil || in.Date > now.In(calendarLocation).Format("2006-01-02") || id != "fitness-checkin-"+in.Date {
			return zero, fitnessBad("锻炼打卡须使用对应日期标识，日期有效且不晚于今天")
		}
		row.Title = "已锻炼"
		row.Category, row.Equipment, row.Note = "", "", ""
		row.State = "completed"
		row.Effort = 0
	case "routine":
		if !fitnessText(in.Title, 80, true) || strings.ContainsAny(in.Title, "\r\n") || !fitnessCategory(in.Category) || !fitnessEquipment(in.Equipment) {
			return zero, fitnessBad("请填写训练名称并选择有效类型与器械")
		}
		moves, err := fitnessMoves(in.Moves)
		if err != nil {
			return zero, err
		}
		row.Moves = moves
		row.Date = ""
		row.State = ""
	case "plan":
		if _, err := subscriptionDate(in.Date); err != nil {
			return zero, fitnessBad("请选择 2000–2100 年内的有效安排日期")
		}
		if in.Revision == 0 {
			routine, err := s.repo.FitnessByID(ctx, user, in.RoutineID)
			if err != nil || routine.Kind != "routine" || routine.Deleted {
				return zero, fitnessBad("请先保存并选择有效训练")
			}
			row.Title = routine.Title
			row.Category = routine.Category
			row.Equipment = routine.Equipment
			row.RoutineID = routine.ID
			row.Moves = append([]domain.FitnessMove{}, routine.Moves...)
			if in.State != "scheduled" {
				return zero, fitnessBad("新安排必须为待训练状态")
			}
		} else {
			old, err := s.repo.FitnessByID(ctx, user, id)
			if err != nil {
				return zero, err
			}
			row.Title = old.Title
			row.Category = old.Category
			row.Equipment = old.Equipment
			row.RoutineID = old.RoutineID
			row.Moves = old.Moves
			if in.State == "completed" && old.State != "completed" {
				return zero, fitnessBad("安排会在关联训练完成后自动完成")
			}
			if old.State == "completed" && in.State != "completed" {
				return zero, fitnessBad("已完成安排不能重新开启，请创建新安排")
			}
		}
		if in.State != "scheduled" && in.State != "skipped" && in.State != "completed" {
			return zero, fitnessBad("无效的安排状态")
		}
	case "log":
		if !fitnessText(in.Title, 80, true) || strings.ContainsAny(in.Title, "\r\n") || !fitnessCategory(in.Category) || in.ElapsedSeconds < 60 || in.ElapsedSeconds > 86400 {
			return zero, fitnessBad("补记须有名称、类型和 1–1440 分钟时长")
		}
		if _, err := subscriptionDate(in.Date); err != nil || in.Date > now.In(calendarLocation).Format("2006-01-02") {
			return zero, fitnessBad("补记日期须有效且不晚于今天")
		}
		row.ElapsedSeconds = in.ElapsedSeconds
		row.State = "completed"
		row.Equipment = "none"
	case "settings":
		if id != "fitness-settings" || in.Deleted || in.WeeklyMinutes < 10 || in.WeeklyMinutes > 1200 || in.WeeklySessions < 1 || in.WeeklySessions > 14 {
			return zero, fitnessBad("周目标须为 10–1200 分钟、1–14 次")
		}
		row.Title = "我的运动目标"
		row.WeeklyMinutes = in.WeeklyMinutes
		row.WeeklySessions = in.WeeklySessions
		row.Date = ""
		row.State = ""
	default:
		return zero, fitnessBad("不支持此记录类型；跟练须使用专用接口")
	}
	return s.repo.SaveFitness(ctx, row, in.Revision)
}
func (s *Service) StartFitness(ctx context.Context, user, id string, in StartFitnessInput) (domain.FitnessEntry, error) {
	var zero domain.FitnessEntry
	if !ledgerID.MatchString(id) {
		return zero, fitnessBad("无效训练标识")
	}
	// An unchanged start request can be retried before later actions. Once the
	// session has advanced, a conflict requires reconciliation rather than a new start.
	raw, _ := json.Marshal(in)
	hash := sha256.Sum256(raw)
	fingerprint := hex.EncodeToString(hash[:])
	if old, err := s.repo.FitnessByID(ctx, user, id); err == nil {
		if old.Kind == "session" && old.LastCommandID == "start" && old.LastCommandHash == fingerprint {
			return old, nil
		}
		return zero, fmt.Errorf("%w: 此训练标识已被使用，请先核对记录", domain.ErrConflict)
	} else if !errors.Is(err, domain.ErrNotFound) {
		return zero, err
	}
	now := s.now().UTC()
	row := domain.FitnessEntry{ID: id, UserID: user, Kind: "session", Title: strings.TrimSpace(in.Title), Category: in.Category, Equipment: in.Equipment, Date: now.In(calendarLocation).Format("2006-01-02"), State: "active", Phase: "work", RunningSince: now, CreatedAt: now, UpdatedAt: now, LastCommandID: "start", LastCommandHash: fingerprint}
	if in.SourceID != "" {
		source, err := s.repo.FitnessByID(ctx, user, in.SourceID)
		if err != nil || source.Deleted || (source.Kind != "routine" && source.Kind != "plan") {
			return zero, fitnessBad("所选训练或安排已不可用")
		}
		if source.Kind == "plan" {
			if source.State != "scheduled" {
				return zero, fitnessBad("所选安排已完成或跳过")
			}
			row.PlanID = source.ID
		}
		row.Title = source.Title
		row.Category = source.Category
		row.Equipment = source.Equipment
		row.RoutineID = source.RoutineID
		if source.Kind == "routine" {
			row.RoutineID = source.ID
		}
		in.Moves = source.Moves
	}
	if !fitnessText(row.Title, 80, true) || strings.ContainsAny(row.Title, "\r\n") || !fitnessCategory(row.Category) || !fitnessEquipment(row.Equipment) {
		return zero, fitnessBad("请填写有效训练名称、类型与器械")
	}
	moves, err := fitnessMoves(in.Moves)
	if err != nil {
		return zero, err
	}
	row.Moves = moves
	if moves[0].Mode == "time" {
		row.RemainingSeconds = moves[0].Target
	}
	return s.repo.SaveFitness(ctx, row, 0)
}
func settleFitness(row *domain.FitnessEntry, now time.Time) {
	if row.State == "active" && !row.RunningSince.IsZero() {
		delta := int(now.Sub(row.RunningSince).Seconds())
		if delta < 0 {
			delta = 0
		}
		// Cap recorded duration, not the current stage's clock. A session left
		// open overnight must not leave all later countdowns frozen at the cap.
		row.ElapsedSeconds += delta
		if row.ElapsedSeconds > 86400 {
			row.ElapsedSeconds = 86400
		}
		if row.ElapsedSeconds < 0 {
			row.ElapsedSeconds = 0
		}
		if row.RemainingSeconds > 0 {
			row.RemainingSeconds -= delta
			if row.RemainingSeconds < 0 {
				row.RemainingSeconds = 0
			}
		}
	}
	row.RunningSince = time.Time{}
}
func fitnessNext(row *domain.FitnessEntry) {
	for i, move := range row.Moves {
		if move.Done+move.Skipped < move.Sets {
			row.CurrentMove = i
			row.Phase = "work"
			row.RemainingSeconds = 0
			if move.Mode == "time" {
				row.RemainingSeconds = move.Target
			}
			return
		}
	}
	row.CurrentMove = len(row.Moves)
	row.Phase = "done"
	row.RemainingSeconds = 0
	row.State = "paused"
}
func (s *Service) FitnessAction(ctx context.Context, user, id string, in FitnessActionInput) (domain.FitnessEntry, error) {
	var zero domain.FitnessEntry
	if !ledgerID.MatchString(id) || !ledgerID.MatchString(in.CommandID) || in.Revision < 1 || in.Revision > 1000000 || !fitnessText(in.Note, 2000, false) || in.Effort < 0 || in.Effort > 5 {
		return zero, fitnessBad("无效版本、请求标识、自评或备注")
	}
	row, err := s.repo.FitnessByID(ctx, user, id)
	if err != nil {
		return zero, err
	}
	raw, _ := json.Marshal(in)
	hash := sha256.Sum256(raw)
	signature := hex.EncodeToString(hash[:])
	if row.Kind != "session" {
		return zero, fitnessBad("此记录不是跟练会话")
	}
	if row.LastCommandID == in.CommandID && row.LastCommandHash == signature && row.Revision == in.Revision+1 {
		return row, nil
	}
	if row.Revision != in.Revision {
		return zero, fmt.Errorf("%w: 训练已更新，请保留请求并重新核对", domain.ErrConflict)
	}
	if in.Action == "archive" || in.Action == "restore" || in.Action == "annotate" {
		if row.State != "completed" && row.State != "stopped" {
			return zero, domain.ErrInvalidState
		}
		if in.Action == "annotate" {
			row.Note = strings.TrimSpace(in.Note)
			row.Effort = in.Effort
		} else {
			row.Deleted = in.Action == "archive"
		}
		row.UpdatedAt = s.now().UTC()
		row.LastCommandID = in.CommandID
		row.LastCommandHash = signature
		return s.repo.SaveFitness(ctx, row, in.Revision)
	}
	if row.State != "active" && row.State != "paused" {
		return zero, fmt.Errorf("%w: 这场训练已经结束", domain.ErrInvalidState)
	}
	now := s.now().UTC()
	wasActive := row.State == "active"
	settleFitness(&row, now)
	switch in.Action {
	case "pause":
		if !wasActive {
			return zero, domain.ErrInvalidState
		}
		row.State = "paused"
	case "resume":
		if wasActive || row.Phase == "done" {
			return zero, domain.ErrInvalidState
		}
		row.State = "active"
	case "complete_set":
		if !wasActive || row.Phase != "work" || row.CurrentMove >= len(row.Moves) {
			return zero, domain.ErrInvalidState
		}
		index := row.CurrentMove
		row.Moves[index].Done++
		rest := row.Moves[index].RestSeconds
		fitnessNext(&row)
		if row.Phase != "done" && rest > 0 {
			row.Phase = "rest"
			row.RemainingSeconds = rest
		}
	case "next":
		if !wasActive || row.Phase != "rest" {
			return zero, domain.ErrInvalidState
		}
		fitnessNext(&row)
	case "skip":
		if !wasActive || row.Phase != "work" || row.CurrentMove >= len(row.Moves) {
			return zero, domain.ErrInvalidState
		}
		move := &row.Moves[row.CurrentMove]
		move.Skipped = move.Sets - move.Done
		fitnessNext(&row)
	case "finish":
		if row.Phase != "done" {
			return zero, fitnessBad("请完成或跳过剩余动作；提前结束请使用停止训练")
		}
		done := 0
		for _, move := range row.Moves {
			done += move.Done
		}
		if done == 0 {
			return zero, fitnessBad("没有完成任何一组，请使用停止训练保存为提前结束")
		}
		row.State = "completed"
		row.Note = strings.TrimSpace(in.Note)
		row.Effort = in.Effort
	case "stop":
		row.State = "stopped"
		row.Note = strings.TrimSpace(in.Note)
		row.Effort = in.Effort
	default:
		return zero, fitnessBad("无效训练操作")
	}
	if row.State == "active" {
		row.RunningSince = now
	}
	row.UpdatedAt = now
	row.LastCommandID = in.CommandID
	row.LastCommandHash = signature
	return s.repo.SaveFitness(ctx, row, in.Revision)
}
