package service

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

var wikiLinkPattern = regexp.MustCompile(`\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]`)

type SaveKnowledgeNoteInput struct {
	Title   string
	Content string
	Tags    []string
	Pinned  bool
}

type UpdateKnowledgeNoteInput struct {
	Title   *string
	Content *string
	Tags    *[]string
	Pinned  *bool
}

type ListKnowledgeNotesInput struct {
	Query  string
	Tag    string
	Pinned *bool
}

type scoredKnowledgeNote struct {
	note  domain.KnowledgeNote
	score int
}

func (s *Service) CreateKnowledgeNote(ctx context.Context, userID string, input SaveKnowledgeNoteInput) (domain.KnowledgeNoteDetail, error) {
	title, content, tags, err := validateKnowledgeNote(input.Title, input.Content, input.Tags)
	if err != nil {
		return domain.KnowledgeNoteDetail{}, err
	}
	if err := s.ensureKnowledgeTitleUnique(ctx, userID, "", title); err != nil {
		return domain.KnowledgeNoteDetail{}, err
	}
	now := s.now().UTC()
	note := domain.KnowledgeNote{ID: platform.NewID(), UserID: userID, Title: title, Content: content, Tags: tags, Pinned: input.Pinned, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateKnowledgeNote(ctx, note); err != nil {
		return domain.KnowledgeNoteDetail{}, err
	}
	s.publish("knowledge_note.created", userID, note.ID, map[string]any{"title": note.Title})
	return s.KnowledgeNote(ctx, userID, note.ID)
}

func (s *Service) UpdateKnowledgeNote(ctx context.Context, userID, noteID string, input UpdateKnowledgeNoteInput) (domain.KnowledgeNoteDetail, error) {
	note, err := s.repo.KnowledgeNoteByID(ctx, noteID)
	if err != nil {
		return domain.KnowledgeNoteDetail{}, err
	}
	if err := requireOwner(note.UserID, userID); err != nil {
		return domain.KnowledgeNoteDetail{}, err
	}
	title, content, tags := note.Title, note.Content, note.Tags
	if input.Title != nil { title = *input.Title }
	if input.Content != nil { content = *input.Content }
	if input.Tags != nil { tags = *input.Tags }
	title, content, tags, err = validateKnowledgeNote(title, content, tags)
	if err != nil {
		return domain.KnowledgeNoteDetail{}, err
	}
	if err := s.ensureKnowledgeTitleUnique(ctx, userID, note.ID, title); err != nil {
		return domain.KnowledgeNoteDetail{}, err
	}
	note.Title, note.Content, note.Tags = title, content, tags
	if input.Pinned != nil { note.Pinned = *input.Pinned }
	note.UpdatedAt = s.now().UTC()
	if err := s.repo.UpdateKnowledgeNote(ctx, note); err != nil {
		return domain.KnowledgeNoteDetail{}, err
	}
	s.publish("knowledge_note.updated", userID, note.ID, map[string]any{"title": note.Title})
	return s.KnowledgeNote(ctx, userID, note.ID)
}

func (s *Service) DeleteKnowledgeNote(ctx context.Context, userID, noteID string) error {
	note, err := s.repo.KnowledgeNoteByID(ctx, noteID)
	if err != nil { return err }
	if err := requireOwner(note.UserID, userID); err != nil { return err }
	if err := s.repo.DeleteKnowledgeNote(ctx, noteID); err != nil { return err }
	s.publish("knowledge_note.deleted", userID, noteID, map[string]any{"title": note.Title})
	return nil
}

func (s *Service) KnowledgeNote(ctx context.Context, userID, noteID string) (domain.KnowledgeNoteDetail, error) {
	note, err := s.repo.KnowledgeNoteByID(ctx, noteID)
	if err != nil { return domain.KnowledgeNoteDetail{}, err }
	if err := requireOwner(note.UserID, userID); err != nil { return domain.KnowledgeNoteDetail{}, err }
	notes, err := s.repo.ListKnowledgeNotes(ctx, userID)
	if err != nil { return domain.KnowledgeNoteDetail{}, err }
	edges, _ := buildKnowledgeLinks(notes)
	detail := domain.KnowledgeNoteDetail{Note: note, Backlinks: []domain.KnowledgeLink{}, OutgoingLinks: []domain.KnowledgeLink{}, UnresolvedLinks: []domain.KnowledgeLink{}}
	for _, edge := range edges {
		if edge.SourceID == note.ID {
			if edge.Resolved { detail.OutgoingLinks = append(detail.OutgoingLinks, edge) } else { detail.UnresolvedLinks = append(detail.UnresolvedLinks, edge) }
		}
		if edge.Resolved && edge.TargetID == note.ID { detail.Backlinks = append(detail.Backlinks, edge) }
	}
	return detail, nil
}

func (s *Service) ListKnowledgeNotes(ctx context.Context, userID string, input ListKnowledgeNotesInput) ([]domain.KnowledgeNoteSummary, error) {
	notes, err := s.repo.ListKnowledgeNotes(ctx, userID)
	if err != nil { return nil, err }
	edges, counts := buildKnowledgeLinks(notes)
	_ = edges
	query := strings.ToLower(strings.TrimSpace(input.Query))
	tokens := strings.Fields(query)
	tag := strings.ToLower(strings.TrimSpace(input.Tag))
	items := make([]scoredKnowledgeNote, 0, len(notes))
	for _, note := range notes {
		if input.Pinned != nil && note.Pinned != *input.Pinned { continue }
		if tag != "" && !containsStringFold(note.Tags, tag) { continue }
		score := knowledgeSearchScore(note, tokens)
		if len(tokens) > 0 && score == 0 { continue }
		items = append(items, scoredKnowledgeNote{note: note, score: score})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].note.Pinned != items[j].note.Pinned { return items[i].note.Pinned }
		if items[i].score != items[j].score { return items[i].score > items[j].score }
		return items[i].note.UpdatedAt.After(items[j].note.UpdatedAt)
	})
	result := make([]domain.KnowledgeNoteSummary, 0, len(items))
	for _, item := range items {
		count := counts[item.note.ID]
		result = append(result, domain.KnowledgeNoteSummary{ID: item.note.ID, Title: item.note.Title, Snippet: knowledgeSnippet(item.note.Content, query), Tags: append([]string(nil), item.note.Tags...), Pinned: item.note.Pinned, BacklinkCount: count[0], OutgoingCount: count[1], UpdatedAt: item.note.UpdatedAt})
	}
	return result, nil
}

func (s *Service) KnowledgeGraph(ctx context.Context, userID string) (domain.KnowledgeGraph, error) {
	notes, err := s.repo.ListKnowledgeNotes(ctx, userID)
	if err != nil { return domain.KnowledgeGraph{}, err }
	edges, counts := buildKnowledgeLinks(notes)
	graph := domain.KnowledgeGraph{Nodes: make([]domain.KnowledgeGraphNode, 0, len(notes)), Edges: []domain.KnowledgeLink{}}
	for _, edge := range edges {
		if edge.Resolved { graph.Edges = append(graph.Edges, edge) } else { graph.UnresolvedCount++ }
	}
	for _, note := range notes {
		count := counts[note.ID]
		node := domain.KnowledgeGraphNode{ID: note.ID, Title: note.Title, Tags: append([]string(nil), note.Tags...), Pinned: note.Pinned, BacklinkCount: count[0], OutgoingCount: count[1], Orphan: count[0]+count[1] == 0}
		if node.Orphan { graph.OrphanCount++ }
		graph.Nodes = append(graph.Nodes, node)
	}
	sort.Slice(graph.Nodes, func(i, j int) bool {
		left := graph.Nodes[i].BacklinkCount + graph.Nodes[i].OutgoingCount
		right := graph.Nodes[j].BacklinkCount + graph.Nodes[j].OutgoingCount
		if left != right { return left > right }
		return graph.Nodes[i].Title < graph.Nodes[j].Title
	})
	return graph, nil
}

func validateKnowledgeNote(title, content string, tags []string) (string, string, []string, error) {
	title, content = strings.TrimSpace(title), strings.TrimSpace(content)
	if title == "" || utf8.RuneCountInString(title) > 160 { return "", "", nil, fmt.Errorf("%w: title is required and must not exceed 160 characters", domain.ErrInvalidInput) }
	if utf8.RuneCountInString(content) > 100000 { return "", "", nil, fmt.Errorf("%w: content must not exceed 100000 characters", domain.ErrInvalidInput) }
	tags = cleanTags(tags)
	if len(tags) > 12 { return "", "", nil, fmt.Errorf("%w: at most 12 tags are allowed", domain.ErrInvalidInput) }
	for _, tag := range tags { if utf8.RuneCountInString(tag) > 48 { return "", "", nil, fmt.Errorf("%w: tags must not exceed 48 characters", domain.ErrInvalidInput) } }
	return title, content, tags, nil
}

func (s *Service) ensureKnowledgeTitleUnique(ctx context.Context, userID, exceptID, title string) error {
	notes, err := s.repo.ListKnowledgeNotes(ctx, userID)
	if err != nil { return err }
	for _, note := range notes {
		if note.ID != exceptID && strings.EqualFold(strings.TrimSpace(note.Title), title) { return fmt.Errorf("%w: a note with this title already exists", domain.ErrConflict) }
	}
	return nil
}

func buildKnowledgeLinks(notes []domain.KnowledgeNote) ([]domain.KnowledgeLink, map[string][2]int) {
	byTitle := make(map[string]domain.KnowledgeNote, len(notes))
	for _, note := range notes { byTitle[strings.ToLower(strings.TrimSpace(note.Title))] = note }
	edges := make([]domain.KnowledgeLink, 0)
	counts := make(map[string][2]int)
	seen := map[string]struct{}{}
	for _, note := range notes {
		for _, match := range wikiLinkPattern.FindAllStringSubmatch(note.Content, -1) {
			targetTitle := strings.TrimSpace(match[1])
			key := note.ID + "\x00" + strings.ToLower(targetTitle)
			if _, exists := seen[key]; exists { continue }
			seen[key] = struct{}{}
			edge := domain.KnowledgeLink{SourceID: note.ID, SourceTitle: note.Title, TargetTitle: targetTitle}
			count := counts[note.ID]; count[1]++; counts[note.ID] = count
			if target, exists := byTitle[strings.ToLower(targetTitle)]; exists {
				edge.TargetID, edge.TargetTitle, edge.Resolved = target.ID, target.Title, true
				targetCount := counts[target.ID]; targetCount[0]++; counts[target.ID] = targetCount
			}
			edges = append(edges, edge)
		}
	}
	return edges, counts
}

func knowledgeSearchScore(note domain.KnowledgeNote, tokens []string) int {
	if len(tokens) == 0 { return 0 }
	title, content, tags := strings.ToLower(note.Title), strings.ToLower(note.Content), strings.ToLower(strings.Join(note.Tags, " "))
	score := 0
	for _, token := range tokens {
		if strings.Contains(title, token) { score += 12 }
		if strings.Contains(tags, token) { score += 7 }
		score += min(strings.Count(content, token), 5)
	}
	return score
}

func knowledgeSnippet(content, _ string) string {
	plain := wikiLinkPattern.ReplaceAllString(content, "$1")
	plain = strings.Join(strings.Fields(strings.NewReplacer("#", "", "*", "", "`", "").Replace(plain)), " ")
	if plain == "" { return "空白笔记" }
	runes := []rune(plain)
	start := 0
	end := min(len(runes), start+120)
	prefix, suffix := "", ""
	if start > 0 { prefix = "…" }
	if end < len(runes) { suffix = "…" }
	return prefix + string(runes[start:end]) + suffix
}

func containsStringFold(values []string, target string) bool {
	for _, value := range values { if strings.EqualFold(value, target) { return true } }
	return false
}
