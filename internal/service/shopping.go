package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"strings"
	"unicode/utf8"
)

type SaveShoppingInput struct {
	Name      string `json:"name"`
	Quantity  string `json:"quantity"`
	Note      string `json:"note"`
	Frequent  bool   `json:"frequent"`
	Purchased bool   `json:"purchased"`
	Deleted   bool   `json:"deleted"`
	Revision  int    `json:"revision"`
}

func (s *Service) ListShopping(ctx context.Context, user string) ([]domain.ShoppingItem, error) {
	return s.repo.ListShopping(ctx, user)
}
func (s *Service) SaveShopping(ctx context.Context, user, id string, in SaveShoppingInput) (domain.ShoppingItem, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Quantity = strings.TrimSpace(in.Quantity)
	in.Note = strings.TrimSpace(in.Note)
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 || in.Name == "" || utf8.RuneCountInString(in.Name) > 80 || utf8.RuneCountInString(in.Quantity) > 30 || utf8.RuneCountInString(in.Note) > 500 || strings.ContainsAny(in.Name, "\r\n") {
		return domain.ShoppingItem{}, fmt.Errorf("%w: 名称须为 1–80 字的单行文本，数量最多 30 字，备注最多 500 字；标识与版本必须有效", domain.ErrInvalidInput)
	}
	now := s.now().UTC()
	return s.repo.SaveShopping(ctx, domain.ShoppingItem{ID: id, UserID: user, Name: in.Name, Quantity: in.Quantity, Note: in.Note, Frequent: in.Frequent, Purchased: in.Purchased, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
