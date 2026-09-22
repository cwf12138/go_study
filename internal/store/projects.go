package store

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"reflect"
	"sort"
)

func cloneProject(p domain.Project) domain.Project {
	p.Cards = append([]domain.ProjectCard{}, p.Cards...)
	for i := range p.Cards {
		p.Cards[i].Checks = append([]domain.ProjectCheck{}, p.Cards[i].Checks...)
	}
	return p
}
func (m *Memory) ListProjects(_ context.Context, user string) ([]domain.Project, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	items := []domain.Project{}
	for _, p := range m.projects {
		if p.UserID == user {
			items = append(items, cloneProject(p))
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	return items, nil
}
func (m *Memory) SaveProject(_ context.Context, p domain.Project, expected int) (domain.Project, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := p.UserID + ":" + p.ID
	p = cloneProject(p)
	if old, ok := m.projects[key]; ok {
		p.CreatedAt = old.CreatedAt
		p.Revision = old.Revision
		compare := p
		compare.UpdatedAt = old.UpdatedAt
		if old.Revision == expected+1 && reflect.DeepEqual(old, compare) {
			return cloneProject(old), nil
		}
		if old.Revision != expected {
			return domain.Project{}, fmt.Errorf("%w: 项目已在其他页面更新，请刷新核对", domain.ErrConflict)
		}
	} else {
		if expected != 0 {
			return domain.Project{}, domain.ErrNotFound
		}
		count := 0
		for _, v := range m.projects {
			if v.UserID == p.UserID {
				count++
			}
		}
		if count >= 50 {
			return domain.Project{}, fmt.Errorf("%w: 每账号最多 50 个项目（含归档）", domain.ErrInvalidInput)
		}
	}
	p.Revision = expected + 1
	m.projects[key] = cloneProject(p)
	return cloneProject(p), nil
}
