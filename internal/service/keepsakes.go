package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

type SaveKeepsakeInput struct {
	Kind       string   `json:"kind"`
	Title      string   `json:"title"`
	Story      string   `json:"story"`
	Category   string   `json:"category"`
	Collection string   `json:"collection"`
	Status     string   `json:"status"`
	Date       string   `json:"date"`
	Latitude   *float64 `json:"latitude"`
	Longitude  *float64 `json:"longitude"`
	Photo      string   `json:"photo"`
	Favorite   bool     `json:"favorite"`
	Archived   bool     `json:"archived"`
	Revision   int      `json:"revision"`
}

func (s *Service) ListKeepsakes(ctx context.Context, user string) ([]domain.Keepsake, error) {
	return s.repo.ListKeepsakes(ctx, user)
}
func (s *Service) SaveKeepsake(ctx context.Context, user, id string, in SaveKeepsakeInput) (domain.Keepsake, error) {
	bad := func(message string) (domain.Keepsake, error) {
		return domain.Keepsake{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, message)
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Story = strings.TrimSpace(in.Story)
	in.Collection = strings.TrimSpace(in.Collection)
	if len(id) < 16 || len(id) > 80 || strings.ContainsAny(id, "/\\ \r\n") || in.Revision < 0 || in.Revision > 1000000 {
		return bad("记录标识或版本无效")
	}
	if in.Title == "" || utf8.RuneCountInString(in.Title) > 120 || utf8.RuneCountInString(in.Story) > 6000 || utf8.RuneCountInString(in.Collection) > 60 {
		return bad("标题 1–120 字，故事最多 6000 字，主题最多 60 字")
	}
	if in.Date != "" {
		d, err := time.Parse("2006-01-02", in.Date)
		if err != nil || d.Format("2006-01-02") != in.Date {
			return bad("日期无效")
		}
	}
	if in.Kind == "place" {
		if in.Status != "visited" && in.Status != "wish" {
			return bad("地点状态须为去过或想去")
		}
		if in.Latitude == nil || in.Longitude == nil || math.IsNaN(*in.Latitude) || math.IsNaN(*in.Longitude) || math.IsInf(*in.Latitude, 0) || math.IsInf(*in.Longitude, 0) || math.Abs(*in.Latitude) > 90 || math.Abs(*in.Longitude) > 180 {
			return bad("请填写有效经纬度")
		}
		in.Category = ""
	} else if in.Kind == "exhibit" {
		switch in.Category {
		case "film", "music", "game", "object", "moment":
		default:
			return bad("展品类型无效")
		}
		in.Status = ""
		in.Latitude = nil
		in.Longitude = nil
	} else {
		return bad("只支持地点与展品")
	}
	if in.Photo != "" {
		parts := strings.SplitN(in.Photo, ",", 2)
		if len(parts) != 2 || len(parts[1]) > 400000 || (parts[0] != "data:image/jpeg;base64" && parts[0] != "data:image/png;base64") {
			return bad("照片须为压缩后的 JPEG 或 PNG")
		}
		data, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil || len(data) > 280000 {
			return bad("照片最大 280 KB")
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 1600 || config.Height > 1600 {
			return bad("照片尺寸无效（最大 1600 × 1600）")
		}
		if (format == "jpeg" && parts[0] != "data:image/jpeg;base64") || (format == "png" && parts[0] != "data:image/png;base64") {
			return bad("照片类型不匹配")
		}
		if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
			return bad("照片数据损坏")
		}
	}
	now := s.now().UTC()
	e := domain.Keepsake{ID: id, UserID: user, Kind: in.Kind, Title: in.Title, Story: in.Story, Category: in.Category, Collection: in.Collection, Status: in.Status, Date: in.Date, Latitude: in.Latitude, Longitude: in.Longitude, Photo: in.Photo, Favorite: in.Favorite, Archived: in.Archived, CreatedAt: now, UpdatedAt: now}
	return s.repo.SaveKeepsake(ctx, e, in.Revision)
}
