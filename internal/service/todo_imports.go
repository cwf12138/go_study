package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

type todoImportRepository interface {
	CreateTodoImport(context.Context, domain.TodoImportReceipt, domain.TodoItem, domain.TodoList) (domain.TodoImportReceipt, bool, error)
	TodoImportByID(context.Context, string) (domain.TodoImportReceipt, error)
	ListTodoImports(context.Context, string) ([]domain.TodoImportReceipt, error)
}
type CreateTodoImportInput struct {
	SchemaVersion int                 `json:"schema_version"`
	RequestID     string              `json:"request_id"`
	Title         string              `json:"title"`
	Notes         string              `json:"notes"`
	Priority      domain.TaskPriority `json:"priority"`
}
type TodoImportResult struct {
	Created bool                     `json:"created"`
	Receipt domain.TodoImportReceipt `json:"receipt"`
	Todo    *domain.TodoItem         `json:"todo"`
}

var todoImportRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{16,100}$`)

func trimTodoImport(value string) string {
	return strings.TrimFunc(value, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' })
}

// Lengths are UTF-8 byte counts. This matches the browser protocol without JSON
// HTML escaping or Unicode-separator differences between Go and JavaScript.
func todoImportFingerprint(title, notes string, priority domain.TaskPriority) string {
	h := sha256.New()
	for _, part := range []string{"daynest.todo-import.v1", title, notes, string(priority)} {
		fmt.Fprintf(h, "%d:", len(part))
		h.Write([]byte(part))
	}
	return hex.EncodeToString(h.Sum(nil))
}
func (s *Service) todoImportRepo() (todoImportRepository, error) {
	r, ok := s.repo.(todoImportRepository)
	if !ok {
		return nil, fmt.Errorf("%w: todo import receipts are unavailable", domain.ErrInvalidState)
	}
	return r, nil
}

func (s *Service) CreateTodoImport(ctx context.Context, user string, in CreateTodoImportInput) (TodoImportResult, error) {
	var out TodoImportResult
	if in.SchemaVersion != 1 || !todoImportRequestID.MatchString(in.RequestID) {
		return out, fmt.Errorf("%w: schema_version or request_id is invalid", domain.ErrInvalidInput)
	}
	in.Title, in.Notes = trimTodoImport(in.Title), trimTodoImport(in.Notes)
	if in.Priority == "" {
		in.Priority = domain.PriorityMedium
	}
	if in.Title == "" || utf8.RuneCountInString(in.Title) > 200 || utf8.RuneCountInString(in.Notes) > 6000 || (in.Priority != domain.PriorityLow && in.Priority != domain.PriorityMedium && in.Priority != domain.PriorityHigh) {
		return out, fmt.Errorf("%w: title, notes or priority is invalid", domain.ErrInvalidInput)
	}
	r, err := s.todoImportRepo()
	if err != nil {
		return out, err
	}
	now := s.now().UTC()
	identity := actionHash(user, in.RequestID)
	receipt := domain.TodoImportReceipt{ID: "import-" + identity, UserID: user, RequestID: in.RequestID, TodoID: "todo-import-" + identity, SchemaVersion: 1, Fingerprint: todoImportFingerprint(in.Title, in.Notes, in.Priority), CreatedAt: now}
	todo := domain.TodoItem{ID: receipt.TodoID, UserID: user, ImportReceiptID: receipt.ID, Title: in.Title, Notes: in.Notes, Priority: in.Priority, Status: domain.TodoOpen, RepeatRule: domain.TodoRepeatNone, Tags: []string{}, Steps: []domain.TodoStep{}, CreatedAt: now, UpdatedAt: now}
	inbox := domain.TodoList{ID: platform.NewID(), UserID: user, Name: todoInboxName, Color: "#5b81ff", Kind: domain.TodoListInbox, CreatedAt: now, UpdatedAt: now}
	actual, created, err := r.CreateTodoImport(ctx, receipt, todo, inbox)
	if err != nil {
		return out, err
	}
	out, err = s.todoImportResult(ctx, user, actual)
	out.Created = created
	if created {
		s.publish("todo.imported", user, actual.TodoID, map[string]any{"receipt_id": actual.ID})
	}
	return out, err
}
func (s *Service) TodoImport(ctx context.Context, user, request string) (TodoImportResult, error) {
	if !todoImportRequestID.MatchString(request) {
		return TodoImportResult{}, domain.ErrInvalidInput
	}
	r, err := s.todoImportRepo()
	if err != nil {
		return TodoImportResult{}, err
	}
	receipt, err := r.TodoImportByID(ctx, "import-"+actionHash(user, request))
	if err != nil {
		return TodoImportResult{}, err
	}
	return s.todoImportResult(ctx, user, receipt)
}
func (s *Service) todoImportResult(ctx context.Context, user string, receipt domain.TodoImportReceipt) (TodoImportResult, error) {
	out := TodoImportResult{Receipt: receipt}
	if receipt.UserID != user {
		return out, domain.ErrForbidden
	}
	todo, err := s.repo.TodoByID(ctx, receipt.TodoID)
	if err == nil {
		if todo.UserID != user {
			return out, domain.ErrForbidden
		}
		out.Todo = &todo
	} else if !errors.Is(err, domain.ErrNotFound) {
		return out, err
	}
	return out, nil
}
