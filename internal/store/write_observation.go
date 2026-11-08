package store

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
)

// Observation metadata is process-local, never business data or a replacement
// for a backup. mu protects it together with the snapshot capture boundary.
type writeObservation struct {
	epoch   string
	key     []byte
	issued  map[string]uint64
	written map[string]writeCheckpoint
	failed  map[string]writeCheckpoint
}
type writeCheckpoint struct {
	through uint64
	at      time.Time
}
type writeCapture struct {
	epoch string
	users map[string]uint64
}

type WriteReceiptStatus struct {
	Receipt    string     `json:"receipt"`
	State      string     `json:"state"`
	SnapshotAt *time.Time `json:"snapshot_at,omitempty"`
	FailureAt  *time.Time `json:"failure_at,omitempty"`
}

// Begin before running the handler. A live LoadJSON invalidates this session,
// preventing an old handler from attributing its write to a replacement model.
func (m *Memory) BeginWriteObservation(user string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.users[user]; !ok {
		return "", errors.New("unavailable account")
	}
	if m.writeObservation == nil {
		var random [48]byte
		if _, err := rand.Read(random[:]); err != nil {
			return "", err
		}
		m.writeObservation = &writeObservation{epoch: hex.EncodeToString(random[32:]), key: append([]byte(nil), random[:32]...), issued: map[string]uint64{}, written: map[string]writeCheckpoint{}, failed: map[string]writeCheckpoint{}}
	}
	return m.writeObservation.epoch, nil
}

func writeMAC(key []byte, epoch, user, sequence string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte("daynest.write-observation.v1\x00" + epoch + "\x00" + user + "\x00" + sequence))
	return h.Sum(nil)
}

// Called after a successful handler mutation and before response headers. A
// snapshot captured earlier cannot acknowledge this barrier, even if it finishes
// later. No wall-clock ordering is used to establish inclusion.
func (m *Memory) ObserveWrite(user, epoch string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o := m.writeObservation
	if o == nil || o.epoch != epoch {
		return "", errors.New("observation session changed")
	}
	if _, ok := m.users[user]; !ok {
		return "", errors.New("unavailable account")
	}
	n := o.issued[user] + 1
	if n == 0 {
		return "", errors.New("observation sequence exhausted")
	}
	o.issued[user] = n
	sequence := strconv.FormatUint(n, 10)
	return "w1." + o.epoch + "." + sequence + "." + base64.RawURLEncoding.EncodeToString(writeMAC(o.key, o.epoch, user, sequence)), nil
}

func (m *Memory) captureWriteObservationLocked() *writeCapture {
	o := m.writeObservation
	if o == nil {
		return nil
	}
	c := &writeCapture{epoch: o.epoch, users: make(map[string]uint64, len(o.issued))}
	for user, n := range o.issued {
		c.users[user] = n
	}
	return c
}

func (m *Memory) finishWriteObservation(c *writeCapture, err error) {
	if c == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	o := m.writeObservation
	if o == nil || o.epoch != c.epoch {
		return
	}
	checkpoints := o.written
	if err != nil {
		checkpoints = o.failed
	}
	for user, n := range c.users {
		if n > 0 && n >= checkpoints[user].through {
			checkpoints[user] = writeCheckpoint{through: n, at: time.Now().UTC()}
		}
	}
}

func (m *Memory) WriteReceiptStatuses(user string, receipts []string) []WriteReceiptStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := make([]WriteReceiptStatus, 0, len(receipts))
	o := m.writeObservation
	for _, receipt := range receipts {
		row := WriteReceiptStatus{Receipt: receipt, State: "unverifiable"}
		parts := strings.Split(receipt, ".")
		if o == nil || len(parts) != 4 || parts[0] != "w1" || parts[1] != o.epoch {
			rows = append(rows, row)
			continue
		}
		n, err := strconv.ParseUint(parts[2], 10, 64)
		signature, decodeErr := base64.RawURLEncoding.DecodeString(parts[3])
		if err != nil || decodeErr != nil || n == 0 || strconv.FormatUint(n, 10) != parts[2] || n > o.issued[user] || !hmac.Equal(signature, writeMAC(o.key, o.epoch, user, parts[2])) {
			rows = append(rows, row)
			continue
		}
		switch {
		case n <= o.written[user].through:
			row.State = "snapshot_written"
			at := o.written[user].at
			row.SnapshotAt = &at
		case n <= o.failed[user].through:
			row.State = "snapshot_failed"
			at := o.failed[user].at
			row.FailureAt = &at
		default:
			row.State = "waiting_snapshot"
		}
		rows = append(rows, row)
	}
	return rows
}
