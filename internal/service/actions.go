package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

type actionRepository interface {
	ActionLinkByID(context.Context, string) (domain.ActionLink, error)
	ListActionLinks(context.Context, string) ([]domain.ActionLink, error)
	LinkMemoAction(context.Context, domain.ActionLink, domain.TodoItem, domain.TodoList) (domain.ActionLink, bool, error)
	StartTodoFocus(context.Context, domain.FocusSession) (domain.FocusSession, bool, error)
	ChangeTodoFocus(context.Context, domain.FocusSession, domain.FocusSession) (domain.FocusSession, error)
}

func (s *Service) actions() (actionRepository, error) {
	repo, ok := s.repo.(actionRepository)
	if !ok {
		return nil, fmt.Errorf("%w: action links are unavailable in this repository", domain.ErrInvalidState)
	}
	return repo, nil
}

func actionHash(parts ...string) string {
	data, _ := json.Marshal(parts)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

type CreateMemoActionInput struct {
	AnchorKind        string              `json:"anchor_kind"`
	AnchorText        string              `json:"anchor_text"`
	ExpectedUpdatedAt time.Time           `json:"expected_updated_at"`
	Title             string              `json:"title"`
	Priority          domain.TaskPriority `json:"priority"`
	DueAt             *time.Time          `json:"due_at"`
	MyDayDate         string              `json:"my_day_date"`
}

type ActionSource struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Archived bool   `json:"archived"`
	Deleted  bool   `json:"deleted"`
	Changed  bool   `json:"changed"`
}

type ActionContext struct {
	Link             *domain.ActionLink    `json:"link"`
	Source           *ActionSource         `json:"source"`
	Todo             *domain.TodoItem      `json:"todo"`
	Sessions         []domain.FocusSession `json:"sessions"`
	CompletedMinutes int                   `json:"completed_minutes"`
}

type MemoActionResult struct {
	Created        bool          `json:"created"`
	MatchesRequest bool          `json:"matches_request"`
	Context        ActionContext `json:"context"`
}

func (s *Service) CreateMemoAction(ctx context.Context, user, memo string, in CreateMemoActionInput) (MemoActionResult, error) {
	var out MemoActionResult
	r, err := s.actions()
	if err != nil {
		return out, err
	}
	if (in.AnchorKind != "line" && in.AnchorKind != "title") || strings.ContainsAny(in.AnchorText, "\r\n") {
		return out, domain.ErrInvalidInput
	}
	in.AnchorText = domain.NormalizeActionText(in.AnchorText)
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > 200 || in.AnchorText == "" || utf8.RuneCountInString(in.AnchorText) > 300 || in.ExpectedUpdatedAt.IsZero() {
		return out, domain.ErrInvalidInput
	}
	if in.Priority == "" {
		in.Priority = domain.PriorityMedium
	}
	if in.Priority != domain.PriorityLow && in.Priority != domain.PriorityMedium && in.Priority != domain.PriorityHigh {
		return out, domain.ErrInvalidInput
	}
	if in.MyDayDate, err = normalizeTodoDate(in.MyDayDate, false); err != nil {
		return out, err
	}
	if in.DueAt != nil {
		value := in.DueAt.UTC()
		in.DueAt = &value
	}
	encoded, _ := json.Marshal(in)
	id := "action-" + actionHash(user, memo, in.AnchorKind, in.AnchorText)
	now := s.now().UTC()
	link := domain.ActionLink{ID: id, UserID: user, MemoID: memo, TodoID: "todo-" + actionHash(id), AnchorKind: in.AnchorKind, AnchorText: in.AnchorText, MemoUpdatedAt: in.ExpectedUpdatedAt, Fingerprint: actionHash(string(encoded)), CreatedAt: now}
	// Read title only for the first creation; the locked repository revalidates the version.
	if note, e := s.repo.MemoNoteByID(ctx, memo); e == nil && note.UserID == user {
		link.MemoTitle = note.Title
	}
	todo := domain.TodoItem{ID: link.TodoID, UserID: user, MemoActionID: id, Title: in.Title, Priority: in.Priority, Status: domain.TodoOpen, DueAt: in.DueAt, MyDayDate: in.MyDayDate, RepeatRule: domain.TodoRepeatNone, Tags: []string{}, Steps: []domain.TodoStep{}, CreatedAt: now, UpdatedAt: now}
	inbox := domain.TodoList{ID: platform.NewID(), UserID: user, Name: "收集箱", Kind: domain.TodoListInbox, Color: "#5b81ff", CreatedAt: now, UpdatedAt: now}
	actual, created, err := r.LinkMemoAction(ctx, link, todo, inbox)
	if err != nil {
		return out, err
	}
	out.Created, out.MatchesRequest = created, actual.Fingerprint == link.Fingerprint
	out.Context, err = s.ActionContext(ctx, user, actual.ID)
	if created {
		s.publish("memo.action_linked", user, actual.ID, map[string]any{"todo_id": actual.TodoID})
	}
	return out, err
}

func (s *Service) MemoActionLinks(ctx context.Context, user, memo string) ([]domain.ActionLink, error) {
	r, err := s.actions()
	if err != nil {
		return nil, err
	}
	links, err := r.ListActionLinks(ctx, user)
	if err != nil {
		return nil, err
	}
	out := []domain.ActionLink{}
	for _, link := range links {
		if link.MemoID == memo {
			out = append(out, link)
		}
	}
	// An empty collection still requires source ownership.
	if len(out) == 0 {
		note, e := s.repo.MemoNoteByID(ctx, memo)
		if e != nil {
			return nil, e
		}
		if note.UserID != user {
			return nil, domain.ErrForbidden
		}
	}
	return out, nil
}

func (s *Service) ActionContext(ctx context.Context, user, id string) (ActionContext, error) {
	out := ActionContext{Sessions: []domain.FocusSession{}}
	r, err := s.actions()
	if err != nil {
		return out, err
	}
	link, err := r.ActionLinkByID(ctx, id)
	if err != nil {
		return out, err
	}
	if link.UserID != user {
		return out, domain.ErrForbidden
	}
	out.Link = &link
	out.Source = &ActionSource{ID: link.MemoID, Title: link.MemoTitle, Deleted: true}
	if note, e := s.repo.MemoNoteByID(ctx, link.MemoID); e == nil && note.UserID == user {
		out.Source = &ActionSource{ID: note.ID, Title: note.Title, Archived: note.Archived, Deleted: note.DeletedAt != nil, Changed: !note.UpdatedAt.Equal(link.MemoUpdatedAt)}
	} else if e != nil && !errors.Is(e, domain.ErrNotFound) {
		return out, e
	}
	if todo, e := s.repo.TodoByID(ctx, link.TodoID); e == nil && todo.UserID == user {
		out.Todo = &todo
	} else if e != nil && !errors.Is(e, domain.ErrNotFound) {
		return out, e
	}
	return s.actionSessions(ctx, user, link.TodoID, out)
}

func (s *Service) TodoContext(ctx context.Context, user, id string) (ActionContext, error) {
	todo, err := s.repo.TodoByID(ctx, id)
	if err != nil {
		return ActionContext{}, err
	}
	if todo.UserID != user {
		return ActionContext{}, domain.ErrForbidden
	}
	if todo.MemoActionID != "" {
		return s.ActionContext(ctx, user, todo.MemoActionID)
	}
	return s.actionSessions(ctx, user, id, ActionContext{Todo: &todo, Sessions: []domain.FocusSession{}})
}

func (s *Service) actionSessions(ctx context.Context, user, todo string, out ActionContext) (ActionContext, error) {
	sessions, err := s.repo.ListFocusSessions(ctx, user, time.Time{})
	if err != nil {
		return out, err
	}
	for _, item := range sessions {
		if item.TodoID == todo {
			if item.Status == domain.FocusCompleted {
				out.CompletedMinutes += item.ActualMinutes
			}
			if len(out.Sessions) < 20 {
				out.Sessions = append(out.Sessions, item)
			}
		}
	}
	return out, nil
}

var focusRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{16,100}$`)

func (s *Service) startTodoFocus(ctx context.Context, user string, in StartFocusInput) (domain.FocusSession, error) {
	if !focusRequestID.MatchString(in.RequestID) || in.TaskID != "" || in.PlanBlockID != "" || in.PlannedMinutes < 1 || in.PlannedMinutes > 240 {
		return domain.FocusSession{}, domain.ErrInvalidInput
	}
	r, err := s.actions()
	if err != nil {
		return domain.FocusSession{}, err
	}
	encoded, _ := json.Marshal([]any{in.TodoID, in.PlannedMinutes, in.BreakEnabled})
	now := s.now().UTC()
	session := domain.FocusSession{ID: "focus-" + actionHash(user, in.RequestID), UserID: user, TodoID: in.TodoID, RequestFingerprint: actionHash(string(encoded)), PlannedMinutes: in.PlannedMinutes, BreakEnabled: in.BreakEnabled, Phase: domain.FocusPhaseFocus, Status: domain.FocusRunning, StartedAt: now, PhaseStartedAt: now, PhaseRemainingSeconds: in.PlannedMinutes * 60}
	if in.BreakEnabled {
		session.BreakMinutes = defaultBreakMinutes
		session.Phase = domain.FocusPhaseFocusFirst
		session.PhaseRemainingSeconds = firstFocusSeconds(in.PlannedMinutes)
	}
	actual, created, err := r.StartTodoFocus(ctx, session)
	if err == nil && created {
		s.publish("focus.started", user, actual.ID, map[string]any{"todo_id": in.TodoID})
	}
	return actual, err
}

func (s *Service) TodoFocusRequest(ctx context.Context, user, request string) (domain.FocusSession, error) {
	if !focusRequestID.MatchString(request) {
		return domain.FocusSession{}, domain.ErrInvalidInput
	}
	return s.focusSessionForUser(ctx, user, "focus-"+actionHash(user, request))
}

func (s *Service) updateFocus(ctx context.Context, before, after domain.FocusSession) (domain.FocusSession, error) {
	if before.TodoID != "" {
		r, err := s.actions()
		if err != nil {
			return after, err
		}
		return r.ChangeTodoFocus(ctx, before, after)
	}
	return after, s.repo.UpdateFocusSession(ctx, after)
}
