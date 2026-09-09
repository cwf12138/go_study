package service

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
)

// UpdateEBookNote keeps the original page and creation time when correcting a note.
func (s *Service) UpdateEBookNote(ctx context.Context, userID, id, noteID, content string) (domain.EBookReading, error) {
	defer s.lockLiteratureUser(userID)()
	reading, err := s.EBookReading(ctx, userID, id)
	if err != nil {
		return domain.EBookReading{}, err
	}
	content = strings.TrimSpace(content)
	if content == "" || utf8.RuneCountInString(content) > 3000 {
		return domain.EBookReading{}, fmt.Errorf("%w: invalid ebook note", domain.ErrInvalidInput)
	}
	for i := range reading.Notes {
		if reading.Notes[i].ID != noteID {
			continue
		}
		reading.Notes[i].Content = content
		reading.Notes[i].UpdatedAt = s.now().UTC()
		reading.UpdatedAt = reading.Notes[i].UpdatedAt
		if err := s.repo.UpdateEBookReading(ctx, reading); err != nil {
			return domain.EBookReading{}, err
		}
		return reading, nil
	}
	return domain.EBookReading{}, domain.ErrNotFound
}
