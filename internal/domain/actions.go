package domain

import (
	"regexp"
	"strings"
	"time"
)

// ActionLink is a permanent receipt, including when its source or target is
// deleted. It prevents an uncertain retry from resurrecting a deleted todo.
type ActionLink struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	MemoID        string    `json:"memo_id"`
	TodoID        string    `json:"todo_id"`
	AnchorKind    string    `json:"anchor_kind"`
	AnchorText    string    `json:"anchor_text"`
	MemoTitle     string    `json:"memo_title"`
	MemoUpdatedAt time.Time `json:"memo_updated_at"`
	Fingerprint   string    `json:"fingerprint"`
	CreatedAt     time.Time `json:"created_at"`
}

var actionPrefix = regexp.MustCompile(`^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)、]\s*)`)

func NormalizeActionText(text string) string {
	return strings.Join(strings.Fields(actionPrefix.ReplaceAllString(strings.TrimSpace(text), "")), " ")
}

func MemoHasAction(note MemoNote, kind, text string) bool {
	if kind == "title" {
		return NormalizeActionText(note.Title) == text
	}
	for _, line := range strings.Split(note.Content, "\n") {
		if NormalizeActionText(line) == text {
			return true
		}
	}
	return false
}
