package service

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/event"
	"github.com/example/studyflow/internal/security"
	"github.com/example/studyflow/internal/store"
)

type Service struct {
	repo   store.Repository
	tokens *security.TokenManager
	events event.Publisher
	now    func() time.Time

	historyMu         sync.RWMutex
	historyCache      map[string]historyCacheEntry
	englishMu         sync.RWMutex
	englishCache      englishCacheEntry
	literatureMu      sync.RWMutex
	literatureCatalog map[string]literatureCatalogCacheEntry
	literatureContent map[string]literatureContentCacheEntry
}

func New(repo store.Repository, tokens *security.TokenManager, events event.Publisher) *Service {
	return &Service{repo: repo, tokens: tokens, events: events, now: time.Now, historyCache: make(map[string]historyCacheEntry), literatureCatalog: make(map[string]literatureCatalogCacheEntry), literatureContent: make(map[string]literatureContentCacheEntry)}
}

func (s *Service) publish(eventType, actorID, aggregateID string, data map[string]any) {
	if s.events != nil {
		s.events.Publish(event.New(eventType, actorID, aggregateID, data))
	}
}

func requireOwner(ownerID, actorID string) error {
	if ownerID != actorID {
		return domain.ErrForbidden
	}
	return nil
}

func cleanTags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	cleaned := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" {
			continue
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		seen[tag] = struct{}{}
		cleaned = append(cleaned, tag)
	}
	return cleaned
}

func (s *Service) User(ctx context.Context, id string) (domain.User, error) {
	return s.repo.UserByID(ctx, id)
}
