package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type SaveProjectInput struct {
	Title       string               `json:"title"`
	Description string               `json:"description"`
	Color       string               `json:"color"`
	Archived    bool                 `json:"archived"`
	Cards       []domain.ProjectCard `json:"cards"`
	Revision    int                  `json:"revision"`
}

var projectID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,80}$`)
var projectColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (s *Service) ListProjects(ctx context.Context, user string) ([]domain.Project, error) {
	return s.repo.ListProjects(ctx, user)
}
func (s *Service) SaveProject(ctx context.Context, user, id string, in SaveProjectInput) (domain.Project, error) {
	bad := func(msg string) (domain.Project, error) {
		return domain.Project{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, msg)
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	if !projectID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("无效的项目标识或版本")
	}
	if in.Title == "" || utf8.RuneCountInString(in.Title) > 80 || utf8.RuneCountInString(in.Description) > 2000 || !projectColor.MatchString(in.Color) {
		return bad("项目名称 1–80 字，说明最多 2000 字，颜色须为十六进制色值")
	}
	if len(in.Cards) > 100 {
		return bad("每个项目最多 100 张卡片（含回收站）")
	}
	ids := map[string]bool{}
	for i := range in.Cards {
		c := &in.Cards[i]
		c.Title = strings.TrimSpace(c.Title)
		c.Description = strings.TrimSpace(c.Description)
		if !projectID.MatchString(c.ID) || ids[c.ID] {
			return bad("卡片标识无效或重复")
		}
		ids[c.ID] = true
		if c.Title == "" || utf8.RuneCountInString(c.Title) > 120 || utf8.RuneCountInString(c.Description) > 3000 {
			return bad("卡片名称 1–120 字，说明最多 3000 字")
		}
		if c.Status != "todo" && c.Status != "doing" && c.Status != "done" {
			return bad("卡片状态无效")
		}
		if c.Priority != "low" && c.Priority != "normal" && c.Priority != "high" {
			return bad("优先级无效")
		}
		if c.Due != "" {
			d, e := time.Parse("2006-01-02", c.Due)
			if e != nil || d.Format("2006-01-02") != c.Due || d.Year() < 2000 || d.Year() > 2100 {
				return bad("截止日期须在 2000–2100 年")
			}
		}
		if len(c.Checks) > 20 {
			return bad("每张卡片最多 20 项检查清单")
		}
		for j := range c.Checks {
			c.Checks[j].Title = strings.TrimSpace(c.Checks[j].Title)
			if c.Checks[j].Title == "" || utf8.RuneCountInString(c.Checks[j].Title) > 120 {
				return bad("检查项须为 1–120 字")
			}
		}
	}
	now := s.now().UTC()
	return s.repo.SaveProject(ctx, domain.Project{ID: id, UserID: user, Title: in.Title, Description: in.Description, Color: in.Color, Archived: in.Archived, Cards: in.Cards, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
