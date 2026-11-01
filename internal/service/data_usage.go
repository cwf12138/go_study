package service

import (
	"context"
	"github.com/example/studyflow/internal/store"
)

// Optional read model, keeping operational summaries out of write contracts.
func (s *Service) AccountUsage(ctx context.Context, user string) (store.AccountUsage, bool, error) {
	reader, ok := s.repo.(interface {
		AccountUsage(context.Context, string) (store.AccountUsage, error)
	})
	if !ok {
		return store.AccountUsage{}, false, nil
	}
	out, err := reader.AccountUsage(ctx, user)
	return out, true, err
}
