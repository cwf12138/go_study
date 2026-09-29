package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"strings"
	"time"
	"unicode/utf8"
)

type SaveInventoryInput struct {
	Name          string `json:"name"`
	Category      string `json:"category"`
	Location      string `json:"location"`
	Quantity      int    `json:"quantity"`
	Price         int64  `json:"price"`
	PurchasedOn   string `json:"purchased_on"`
	WarrantyUntil string `json:"warranty_until"`
	ExpiresOn     string `json:"expires_on"`
	Borrower      string `json:"borrower"`
	ReturnOn      string `json:"return_on"`
	Note          string `json:"note"`
	Archived      bool   `json:"archived"`
	Revision      int    `json:"revision"`
}

func (s *Service) ListInventory(ctx context.Context, user string) ([]domain.InventoryItem, error) {
	return s.repo.ListInventory(ctx, user)
}
func (s *Service) SaveInventory(ctx context.Context, user, id string, in SaveInventoryInput) (domain.InventoryItem, error) {
	bad := func(message string) (domain.InventoryItem, error) {
		return domain.InventoryItem{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, message)
	}
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("物品标识或版本无效")
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Category = strings.TrimSpace(in.Category)
	in.Location = strings.TrimSpace(in.Location)
	in.Borrower = strings.TrimSpace(in.Borrower)
	in.Note = strings.TrimSpace(in.Note)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 80 {
		return bad("物品名称须为 1–80 字")
	}
	if in.Category == "" || utf8.RuneCountInString(in.Category) > 24 || utf8.RuneCountInString(in.Location) > 80 || utf8.RuneCountInString(in.Borrower) > 80 || utf8.RuneCountInString(in.Note) > 2000 {
		return bad("分类最多 24 字，位置和借用人最多 80 字，备注最多 2000 字")
	}
	if in.Quantity < 1 || in.Quantity > 9999 || in.Price < 0 || in.Price > 10000000000 {
		return bad("数量须为 1–9999，购入总价须为零至一亿元的整数分")
	}
	for _, value := range []string{in.PurchasedOn, in.WarrantyUntil, in.ExpiresOn, in.ReturnOn} {
		if value == "" {
			continue
		}
		d, err := time.Parse("2006-01-02", value)
		if err != nil || d.Format("2006-01-02") != value || d.Year() < 1900 || d.Year() > 2200 {
			return bad("日期须为 1900–2200 年的有效日期")
		}
	}
	if in.PurchasedOn != "" && ((in.WarrantyUntil != "" && in.WarrantyUntil < in.PurchasedOn) || (in.ExpiresOn != "" && in.ExpiresOn < in.PurchasedOn)) {
		return bad("保修或到期日期不能早于购入日期")
	}
	if in.Borrower == "" && in.ReturnOn != "" {
		return bad("请填写借用人，或清空预计归还日期")
	}
	if in.Archived && in.Borrower != "" {
		return bad("请先确认归还，再归档物品")
	}
	now := s.now().UTC()
	return s.repo.SaveInventory(ctx, domain.InventoryItem{ID: id, UserID: user, Name: in.Name, Category: in.Category, Location: in.Location, Quantity: in.Quantity, Price: in.Price, PurchasedOn: in.PurchasedOn, WarrantyUntil: in.WarrantyUntil, ExpiresOn: in.ExpiresOn, Borrower: in.Borrower, ReturnOn: in.ReturnOn, Note: in.Note, Archived: in.Archived, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
