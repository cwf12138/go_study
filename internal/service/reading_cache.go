package service

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/example/studyflow/internal/domain"
)

const englishCacheFile = "english-feed.json"

// SetReadingCache enables persistence for public, reproducible content only.
// Call it before starting the server or its content refresh workers.
func (s *Service) SetReadingCache(dir string) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		s.loadBookIndex()
		return err
	}
	s.readingCacheDir = dir
	if raw, err := s.readReadingCache(englishCacheFile, 2<<20); err == nil {
		var feed domain.EnglishFeed
		now := s.now().UTC()
		if json.Unmarshal(raw, &feed) == nil && len(feed.Articles) > 0 && !feed.Offline &&
			!feed.FetchedAt.After(now) && now.Sub(feed.FetchedAt) < 24*time.Hour {
			s.englishCache = englishCacheEntry{feed: feed, expiresAt: feed.NextRefreshAt}
		}
	}
	s.loadBookIndex()
	return nil
}

func (s *Service) readReadingCache(name string, limit int64) ([]byte, error) {
	if s.readingCacheDir == "" {
		return nil, os.ErrNotExist
	}
	file, err := os.Open(filepath.Join(s.readingCacheDir, name))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err == nil && int64(len(data)) > limit {
		return nil, io.ErrShortBuffer
	}
	return data, err
}

func (s *Service) writeReadingCache(name string, data []byte) error {
	if s.readingCacheDir == "" {
		return os.ErrNotExist
	}
	temp, err := os.CreateTemp(s.readingCacheDir, ".reading-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	_, err = temp.Write(data)
	closeErr := temp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(temp.Name(), filepath.Join(s.readingCacheDir, name))
}
