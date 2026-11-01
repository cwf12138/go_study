package backup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/example/studyflow/internal/transfers"
)

type TransferInspection struct {
	Files       int `json:"files"`
	Trashed     int `json:"trashed"`
	Expired     int `json:"expired"`
	OrphanFiles int `json:"orphan_files"`
}

var transferID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,80}$`)

func inspectTransfers(root string, users []string, entries map[string]Entry) (TransferInspection, error) {
	out := TransferInspection{}
	info, err := os.Lstat(filepath.Join(root, "payload", "transfers"))
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return out, errors.New("transfer directory is missing or unsafe")
	}
	owners := map[string]string{}
	for _, id := range users {
		sum := sha256.Sum256([]byte(id))
		owners[hex.EncodeToString(sum[:])] = id
	}
	claimed := map[string]bool{}
	for name := range entries {
		if !strings.HasPrefix(name, "payload/transfers/") {
			continue
		}
		parts := strings.Split(name, "/")
		owner := owners[parts[2]]
		if owner == "" {
			return out, errors.New("transfer directory has an unknown account owner")
		}
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		data, err := readSmall(filepath.Join(root, filepath.FromSlash(name)), 8192)
		if err != nil {
			return out, err
		}
		if err := checkJSON(data); err != nil {
			return out, err
		}
		var row transfers.Record
		d := json.NewDecoder(strings.NewReader(string(data)))
		d.DisallowUnknownFields()
		if err := d.Decode(&row); err != nil {
			return out, errors.New("invalid transfer metadata")
		}
		id := strings.TrimSuffix(parts[3], ".json")
		if !transferID.MatchString(id) || row.ID != id || row.UserID != owner || !transfers.ValidName(row.Name) || row.Size < 0 || row.Size > transfers.MaxFileBytes || !digestPattern.MatchString(row.SHA256) || (row.TTLHours != 0 && row.TTLHours != 24 && row.TTLHours != 168) || row.CreatedAt.IsZero() {
			return out, errors.New("transfer metadata identity, owner or size is invalid")
		}
		blob := strings.TrimSuffix(name, ".json") + ".blob"
		e, ok := entries[blob]
		if !ok || e.Size != row.Size || e.SHA256 != row.SHA256 {
			return out, errors.New("transfer blob is missing or disagrees with metadata")
		}
		claimed[name], claimed[blob] = true, true
		out.Files++
		if row.DeletedAt != nil {
			out.Trashed++
		}
		if row.ExpiresAt != nil && !time.Now().Before(*row.ExpiresAt) {
			out.Expired++
		}
	}
	for name := range entries {
		if strings.HasPrefix(name, "payload/transfers/") && !claimed[name] {
			out.OrphanFiles++
		}
	}
	return out, nil
}
