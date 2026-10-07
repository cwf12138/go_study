package service

import (
	"context"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

type SaveBookmarkInput struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	Folder   string `json:"folder"`
	Note     string `json:"note"`
	Pinned   bool   `json:"pinned"`
	Read     bool   `json:"read"`
	Deleted  bool   `json:"deleted"`
	Revision int    `json:"revision"`
}

func (s *Service) ListBookmarks(ctx context.Context, user string) ([]domain.Bookmark, error) {
	return s.repo.ListBookmarks(ctx, user)
}

func (s *Service) SaveBookmark(ctx context.Context, user, id string, in SaveBookmarkInput) (domain.Bookmark, error) {
	in.URL, in.Title, in.Folder, in.Note = strings.TrimSpace(in.URL), strings.TrimSpace(in.Title), strings.TrimSpace(in.Folder), strings.TrimSpace(in.Note)
	bad := func(message string) (domain.Bookmark, error) {
		return domain.Bookmark{}, fmt.Errorf("%w: %s", domain.ErrInvalidInput, message)
	}
	if !ledgerID.MatchString(id) || in.Revision < 0 || in.Revision > 1000000 {
		return bad("无效标识或版本")
	}
	if in.URL == "" || len(in.URL) > 2048 || strings.IndexFunc(in.URL, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return bad("请填写不含空白的有效网址，最多 2048 字节")
	}
	if !strings.Contains(in.URL, "://") {
		in.URL = "https://" + in.URL
	}
	u, err := url.Parse(in.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || strings.ContainsAny(u.Host, "\\<>") || len(in.URL) > 2048 {
		return bad("仅支持 HTTP/HTTPS 网页地址，不能包含用户名或密码")
	}
	u.Scheme, u.Host = strings.ToLower(u.Scheme), strings.ToLower(u.Host)
	if u.Path == "" {
		u.Path = "/"
	}
	in.URL = u.String()
	if len(in.URL) > 2048 {
		return bad("规范化后的网址过长，最多 2048 字节")
	}
	if in.Title == "" {
		in.Title = u.Hostname()
	}
	if in.Folder == "" {
		in.Folder = "未分类"
	}
	if utf8.RuneCountInString(in.Title) > 160 || utf8.RuneCountInString(in.Folder) > 30 || utf8.RuneCountInString(in.Note) > 2000 || strings.ContainsAny(in.Title+in.Folder, "\r\n") {
		return bad("标题最多 160 字，文件夹最多 30 字，备注最多 2000 字；标题和文件夹须为单行")
	}
	now := s.now().UTC()
	return s.repo.SaveBookmark(ctx, domain.Bookmark{ID: id, UserID: user, URL: in.URL, Title: in.Title, Folder: in.Folder, Note: in.Note, Pinned: in.Pinned, Read: in.Read, Deleted: in.Deleted, CreatedAt: now, UpdatedAt: now}, in.Revision)
}
