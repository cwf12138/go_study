package service

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
)

type SaveParcelInput struct {
	Title      string `json:"title"`
	Carrier    string `json:"carrier"`
	Location   string `json:"location"`
	PickupCode string `json:"pickup_code"`
	Tracking   string `json:"tracking"`
	Deadline   string `json:"deadline"`
	Note       string `json:"note"`
	Status     string `json:"status"`
	Deleted    bool   `json:"deleted"`
	Revision   int    `json:"revision"`
}

func (s *Service) ListParcels(ctx context.Context, user string) ([]domain.Parcel, error) {
	return s.repo.ListParcels(ctx, user)
}
func (s *Service) SaveParcel(ctx context.Context, user, id string, in SaveParcelInput) (domain.Parcel, error) {
	bad := func(msg string) (domain.Parcel, error) {
		return domain.Parcel{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, msg)
	}
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("标识或版本无效")
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" && strings.TrimSpace(in.Location) == "" && strings.TrimSpace(in.PickupCode) == "" && strings.TrimSpace(in.Tracking) == "" {
		return bad("请至少填写取件点、取件码、包裹名称或单号中的一项")
	}
	if in.Title == "" {
		in.Title = "快递包裹"
	}
	in.Carrier = strings.TrimSpace(in.Carrier)
	in.Location = strings.TrimSpace(in.Location)
	in.PickupCode = strings.TrimSpace(in.PickupCode)
	in.Tracking = strings.TrimSpace(in.Tracking)
	in.Note = strings.TrimSpace(in.Note)
	for _, f := range []struct {
		value string
		limit int
	}{{in.Title, 80}, {in.Carrier, 30}, {in.Location, 120}, {in.PickupCode, 40}, {in.Tracking, 60}} {
		if utf8.RuneCountInString(f.value) > f.limit || strings.IndexFunc(f.value, unicode.IsControl) >= 0 {
			return bad("名称、快递公司、取件点、取件码或单号过长，或包含控制字符")
		}
	}
	if utf8.RuneCountInString(in.Note) > 1000 {
		return bad("备注最多 1000 字")
	}
	if in.Deadline != "" {
		d, err := time.Parse("2006-01-02", in.Deadline)
		if err != nil || d.Year() < 2000 || d.Year() > 2200 {
			return bad("最晚取件日期无效")
		}
	}
	switch in.Status {
	case "transit", "ready", "picked":
	default:
		return bad("包裹状态无效")
	}
	now := s.now().UTC()
	return s.repo.SaveParcel(ctx, domain.Parcel{ID: id, UserID: user, Title: in.Title, Carrier: in.Carrier, Location: in.Location, PickupCode: in.PickupCode, Tracking: in.Tracking, Deadline: in.Deadline, Note: in.Note, Status: in.Status, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
