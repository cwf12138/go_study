package backup

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path/filepath"
)

// ReadVerifiedSnapshot is for offline owner tools only: the returned bytes can
// contain every account's credentials and content. Never expose this via HTTP.
// It verifies the complete package, then pins the returned snapshot to the
// manifest digest instead of trusting a second, potentially changed read.
func ReadVerifiedSnapshot(input string) ([]byte, Report, error) {
	r, manifest, root, err := verified(input)
	if err != nil {
		return nil, r, err
	}
	data, err := readSmall(filepath.Join(root, filepath.FromSlash(primary)), MaxSnapshotBytes)
	if err != nil {
		return nil, r, err
	}
	sum := sha256.Sum256(data)
	for _, e := range manifest.Files {
		if e.Path == primary {
			if int64(len(data)) != e.Size || hex.EncodeToString(sum[:]) != e.SHA256 {
				return nil, r, errors.New("snapshot changed after package verification")
			}
			return data, r, nil
		}
	}
	return nil, r, errors.New("verified snapshot entry missing")
}
