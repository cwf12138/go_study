package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

var memoColors = map[string]struct{}{
	"default": {}, "yellow": {}, "orange": {}, "rose": {}, "violet": {}, "blue": {}, "mint": {}, "gray": {},
}

type SaveMemoFolderInput struct {
	Name      string
	Color     string
	SortOrder int
}

type UpdateMemoFolderInput struct {
	Name      *string
	Color     *string
	SortOrder *int
}

type SaveMemoNoteInput struct {
	FolderID string
	Title    string
	Content  string
	Tags     []string
	Color    string
	Pinned   bool
}

type UpdateMemoNoteInput struct {
	FolderID *string
	Title    *string
	Content  *string
	Tags     *[]string
	Color    *string
	Pinned   *bool
	Archived *bool
}

type ListMemoNotesInput struct {
	Query    string
	FolderID string
	Tag      string
	View     string
	Sort     string
	Order    string
}

func (s *Service) CreateMemoFolder(ctx context.Context, userID string, input SaveMemoFolderInput) (domain.MemoFolder, error) {
	name, color, err := validateMemoFolder(input.Name, input.Color)
	if err != nil {
		return domain.MemoFolder{}, err
	}
	if err := s.ensureMemoFolderNameUnique(ctx, userID, "", name); err != nil {
		return domain.MemoFolder{}, err
	}
	now := s.now().UTC()
	folder := domain.MemoFolder{ID: platform.NewID(), UserID: userID, Name: name, Color: color, SortOrder: input.SortOrder, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateMemoFolder(ctx, folder); err != nil {
		return domain.MemoFolder{}, err
	}
	s.publish("memo_folder.created", userID, folder.ID, map[string]any{"name": folder.Name})
	return folder, nil
}

func (s *Service) UpdateMemoFolder(ctx context.Context, userID, folderID string, input UpdateMemoFolderInput) (domain.MemoFolder, error) {
	folder, err := s.repo.MemoFolderByID(ctx, folderID)
	if err != nil {
		return domain.MemoFolder{}, err
	}
	if err := requireOwner(folder.UserID, userID); err != nil {
		return domain.MemoFolder{}, err
	}
	name, color := folder.Name, folder.Color
	if input.Name != nil {
		name = *input.Name
	}
	if input.Color != nil {
		color = *input.Color
	}
	name, color, err = validateMemoFolder(name, color)
	if err != nil {
		return domain.MemoFolder{}, err
	}
	if err := s.ensureMemoFolderNameUnique(ctx, userID, folder.ID, name); err != nil {
		return domain.MemoFolder{}, err
	}
	folder.Name, folder.Color = name, color
	if input.SortOrder != nil {
		folder.SortOrder = *input.SortOrder
	}
	folder.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateMemoFolder(ctx, folder); err != nil {
		return domain.MemoFolder{}, err
	}
	s.publish("memo_folder.updated", userID, folder.ID, map[string]any{"name": folder.Name})
	return folder, nil
}

func (s *Service) DeleteMemoFolder(ctx context.Context, userID, folderID string) error {
	folder, err := s.repo.MemoFolderByID(ctx, folderID)
	if err != nil {
		return err
	}
	if err := requireOwner(folder.UserID, userID); err != nil {
		return err
	}
	if err := s.repo.DeleteMemoFolder(ctx, folderID); err != nil {
		return err
	}
	s.publish("memo_folder.deleted", userID, folderID, map[string]any{"name": folder.Name})
	return nil
}

func (s *Service) ListMemoFolders(ctx context.Context, userID string) ([]domain.MemoFolder, error) {
	return s.repo.ListMemoFolders(ctx, userID)
}

func (s *Service) CreateMemoNote(ctx context.Context, userID string, input SaveMemoNoteInput) (domain.MemoNote, error) {
	if err := s.requireMemoFolder(ctx, userID, input.FolderID); err != nil {
		return domain.MemoNote{}, err
	}
	title, content, tags, color, err := validateMemoNote(input.Title, input.Content, input.Tags, input.Color)
	if err != nil {
		return domain.MemoNote{}, err
	}
	now := s.now().UTC()
	note := domain.MemoNote{ID: platform.NewID(), UserID: userID, FolderID: strings.TrimSpace(input.FolderID), Title: title, Content: content, Tags: tags, Color: color, Pinned: input.Pinned, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateMemoNote(ctx, note); err != nil {
		return domain.MemoNote{}, err
	}
	s.publish("memo_note.created", userID, note.ID, map[string]any{"title": note.Title})
	return note, nil
}

func (s *Service) MemoNote(ctx context.Context, userID, noteID string) (domain.MemoNote, error) {
	note, err := s.repo.MemoNoteByID(ctx, noteID)
	if err != nil {
		return domain.MemoNote{}, err
	}
	if err := requireOwner(note.UserID, userID); err != nil {
		return domain.MemoNote{}, err
	}
	return note, nil
}

func (s *Service) UpdateMemoNote(ctx context.Context, userID, noteID string, input UpdateMemoNoteInput) (domain.MemoNote, error) {
	note, err := s.MemoNote(ctx, userID, noteID)
	if err != nil {
		return domain.MemoNote{}, err
	}
	if note.DeletedAt != nil {
		return domain.MemoNote{}, fmt.Errorf("%w: restore a deleted memo before editing it", domain.ErrInvalidInput)
	}
	if input.FolderID != nil {
		if err := s.requireMemoFolder(ctx, userID, *input.FolderID); err != nil {
			return domain.MemoNote{}, err
		}
		note.FolderID = strings.TrimSpace(*input.FolderID)
	}
	if input.Title != nil {
		note.Title = *input.Title
	}
	if input.Content != nil {
		note.Content = *input.Content
	}
	if input.Tags != nil {
		note.Tags = *input.Tags
	}
	if input.Color != nil {
		note.Color = *input.Color
	}
	note.Title, note.Content, note.Tags, note.Color, err = validateMemoNote(note.Title, note.Content, note.Tags, note.Color)
	if err != nil {
		return domain.MemoNote{}, err
	}
	if input.Pinned != nil {
		note.Pinned = *input.Pinned
	}
	if input.Archived != nil {
		note.Archived = *input.Archived
	}
	note.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateMemoNote(ctx, note); err != nil {
		return domain.MemoNote{}, err
	}
	s.publish("memo_note.updated", userID, note.ID, map[string]any{"title": note.Title})
	return note, nil
}

func (s *Service) TrashMemoNote(ctx context.Context, userID, noteID string) error {
	note, err := s.MemoNote(ctx, userID, noteID)
	if err != nil {
		return err
	}
	if note.DeletedAt != nil {
		return nil
	}
	now := s.now().UTC()
	note.DeletedAt, note.UpdatedAt = &now, now
	if err := s.repo.UpdateMemoNote(ctx, note); err != nil {
		return err
	}
	s.publish("memo_note.trashed", userID, note.ID, map[string]any{"title": note.Title})
	return nil
}

func (s *Service) RestoreMemoNote(ctx context.Context, userID, noteID string) (domain.MemoNote, error) {
	note, err := s.MemoNote(ctx, userID, noteID)
	if err != nil {
		return domain.MemoNote{}, err
	}
	note.DeletedAt = nil
	note.Archived = false
	note.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateMemoNote(ctx, note); err != nil {
		return domain.MemoNote{}, err
	}
	s.publish("memo_note.restored", userID, note.ID, map[string]any{"title": note.Title})
	return note, nil
}

func (s *Service) DeleteMemoNotePermanently(ctx context.Context, userID, noteID string) error {
	note, err := s.MemoNote(ctx, userID, noteID)
	if err != nil {
		return err
	}
	if note.DeletedAt == nil {
		return fmt.Errorf("%w: move the memo to trash before deleting it permanently", domain.ErrInvalidInput)
	}
	if err := s.repo.DeleteMemoNote(ctx, noteID); err != nil {
		return err
	}
	s.publish("memo_note.deleted", userID, noteID, map[string]any{"title": note.Title})
	return nil
}

func (s *Service) DuplicateMemoNote(ctx context.Context, userID, noteID string) (domain.MemoNote, error) {
	original, err := s.MemoNote(ctx, userID, noteID)
	if err != nil {
		return domain.MemoNote{}, err
	}
	return s.CreateMemoNote(ctx, userID, SaveMemoNoteInput{FolderID: original.FolderID, Title: original.Title + "（副本）", Content: original.Content, Tags: original.Tags, Color: original.Color})
}

func (s *Service) ListMemoNotes(ctx context.Context, userID string, input ListMemoNotesInput) ([]domain.MemoNoteSummary, error) {
	notes, err := s.repo.ListMemoNotes(ctx, userID)
	if err != nil {
		return nil, err
	}
	query := strings.ToLower(strings.TrimSpace(input.Query))
	tag := strings.ToLower(strings.TrimSpace(input.Tag))
	view := strings.ToLower(strings.TrimSpace(input.View))
	if view == "" {
		view = "all"
	}
	items := make([]domain.MemoNoteSummary, 0, len(notes))
	for _, note := range notes {
		if !memoMatchesView(note, view) || (input.FolderID != "" && note.FolderID != input.FolderID) || (tag != "" && !containsStringFold(note.Tags, tag)) {
			continue
		}
		haystack := strings.ToLower(note.Title + "\n" + note.Content + "\n" + strings.Join(note.Tags, " "))
		if query != "" && !strings.Contains(haystack, query) {
			continue
		}
		done, total := memoChecklistProgress(note.Content)
		items = append(items, domain.MemoNoteSummary{ID: note.ID, FolderID: note.FolderID, Title: note.Title, Snippet: memoSnippet(note.Content), Tags: append([]string(nil), note.Tags...), Color: note.Color, Pinned: note.Pinned, Archived: note.Archived, DeletedAt: note.DeletedAt, HasChecklist: total > 0, ChecklistDone: done, ChecklistTotal: total, CreatedAt: note.CreatedAt, UpdatedAt: note.UpdatedAt})
	}
	sortMemoSummaries(items, input.Sort, input.Order)
	return items, nil
}

func (s *Service) MemoOverview(ctx context.Context, userID string) (domain.MemoOverview, error) {
	notes, err := s.repo.ListMemoNotes(ctx, userID)
	if err != nil {
		return domain.MemoOverview{}, err
	}
	folders, err := s.repo.ListMemoFolders(ctx, userID)
	if err != nil {
		return domain.MemoOverview{}, err
	}
	result := domain.MemoOverview{Folders: len(folders), Tags: []string{}}
	tagSet := map[string]struct{}{}
	for _, note := range notes {
		if note.DeletedAt != nil {
			result.Deleted++
			continue
		}
		if note.Archived {
			result.Archived++
			continue
		}
		result.Total++
		if note.Pinned {
			result.Pinned++
		}
		if _, total := memoChecklistProgress(note.Content); total > 0 {
			result.ChecklistNotes++
		}
		for _, tag := range note.Tags {
			tagSet[tag] = struct{}{}
		}
	}
	for tag := range tagSet {
		result.Tags = append(result.Tags, tag)
	}
	sort.Strings(result.Tags)
	return result, nil
}

func validateMemoFolder(name, color string) (string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return "", "", fmt.Errorf("%w: folder name is required and must not exceed 80 characters", domain.ErrInvalidInput)
	}
	color, err := normalizeMemoColor(color)
	return name, color, err
}

func validateMemoNote(title, content string, tags []string, color string) (string, string, []string, string, error) {
	title, content = strings.TrimSpace(title), strings.TrimRight(content, " \t\r\n")
	if title == "" {
		title = memoTitleFromContent(content)
	}
	if utf8.RuneCountInString(title) > 160 {
		return "", "", nil, "", fmt.Errorf("%w: title must not exceed 160 characters", domain.ErrInvalidInput)
	}
	if utf8.RuneCountInString(content) > 100000 {
		return "", "", nil, "", fmt.Errorf("%w: content must not exceed 100000 characters", domain.ErrInvalidInput)
	}
	tags = cleanTags(tags)
	if len(tags) > 30 {
		return "", "", nil, "", fmt.Errorf("%w: a memo cannot have more than 30 tags", domain.ErrInvalidInput)
	}
	for _, tag := range tags {
		if utf8.RuneCountInString(tag) > 40 {
			return "", "", nil, "", fmt.Errorf("%w: a tag must not exceed 40 characters", domain.ErrInvalidInput)
		}
	}
	color, err := normalizeMemoColor(color)
	return title, content, tags, color, err
}

func normalizeMemoColor(color string) (string, error) {
	color = strings.ToLower(strings.TrimSpace(color))
	if color == "" {
		color = "default"
	}
	if _, ok := memoColors[color]; !ok {
		return "", fmt.Errorf("%w: unsupported memo color", domain.ErrInvalidInput)
	}
	return color, nil
}

func (s *Service) requireMemoFolder(ctx context.Context, userID, folderID string) error {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return nil
	}
	folder, err := s.repo.MemoFolderByID(ctx, folderID)
	if err != nil {
		return err
	}
	return requireOwner(folder.UserID, userID)
}

func (s *Service) ensureMemoFolderNameUnique(ctx context.Context, userID, excludeID, name string) error {
	folders, err := s.repo.ListMemoFolders(ctx, userID)
	if err != nil {
		return err
	}
	for _, folder := range folders {
		if folder.ID != excludeID && strings.EqualFold(folder.Name, name) {
			return fmt.Errorf("%w: a folder with this name already exists", domain.ErrConflict)
		}
	}
	return nil
}

func memoMatchesView(note domain.MemoNote, view string) bool {
	switch view {
	case "trash":
		return note.DeletedAt != nil
	case "archived":
		return note.DeletedAt == nil && note.Archived
	case "pinned":
		return note.DeletedAt == nil && !note.Archived && note.Pinned
	case "checklists":
		_, total := memoChecklistProgress(note.Content)
		return note.DeletedAt == nil && !note.Archived && total > 0
	default:
		return note.DeletedAt == nil && !note.Archived
	}
}

func memoChecklistProgress(content string) (done, total int) {
	for _, line := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if len(trimmed) < 5 || (trimmed[:3] != "- [" && trimmed[:3] != "* [") || trimmed[4] != ']' {
			continue
		}
		total++
		if trimmed[3] == 'x' || trimmed[3] == 'X' {
			done++
		}
	}
	return done, total
}

func memoTitleFromContent(content string) string {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimSpace(strings.TrimLeft(line, "#>"))
		if (strings.HasPrefix(line, "- [") || strings.HasPrefix(line, "* [")) && len(line) >= 5 {
			line = strings.TrimSpace(line[5:])
		} else {
			line = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(line, "- "), "* "))
		}
		if dot := strings.Index(line, ". "); dot > 0 {
			numbered := true
			for _, char := range line[:dot] {
				if char < '0' || char > '9' {
					numbered = false
					break
				}
			}
			if numbered {
				line = strings.TrimSpace(line[dot+2:])
			}
		}
		if line == "" {
			continue
		}
		runes := []rune(line)
		if len(runes) > 40 {
			line = string(runes[:40])
		}
		return line
	}
	return "新备忘录"
}

func memoSnippet(content string) string {
	text := strings.Join(strings.Fields(strings.NewReplacer("#", "", "*", "", "`", "", "[", "", "]", "", ">", "").Replace(content)), " ")
	if text == "" {
		return "还没有内容"
	}
	runes := []rune(text)
	if len(runes) > 90 {
		return string(runes[:90]) + "…"
	}
	return text
}

func sortMemoSummaries(items []domain.MemoNoteSummary, field, order string) {
	descending := strings.ToLower(order) != "asc"
	field = strings.ToLower(strings.TrimSpace(field))
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Pinned != items[j].Pinned {
			return items[i].Pinned
		}
		if items[i].ID == items[j].ID {
			return false
		}
		switch field {
		case "created_at":
			if !items[i].CreatedAt.Equal(items[j].CreatedAt) {
				if descending {
					return items[i].CreatedAt.After(items[j].CreatedAt)
				}
				return items[i].CreatedAt.Before(items[j].CreatedAt)
			}
		case "title":
			left, right := strings.ToLower(items[i].Title), strings.ToLower(items[j].Title)
			if left != right {
				if descending {
					return left > right
				}
				return left < right
			}
		default:
			if !items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
				if descending {
					return items[i].UpdatedAt.After(items[j].UpdatedAt)
				}
				return items[i].UpdatedAt.Before(items[j].UpdatedAt)
			}
		}
		return items[i].ID < items[j].ID
	})
}
