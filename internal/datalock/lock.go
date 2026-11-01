// Package datalock coordinates the API and offline maintenance tools. The lock
// belongs to the data directory because transfers are shared by all snapshots
// in that directory. Never unlink the lock file: a new inode would split locks.
package datalock

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

var ErrBusy = errors.New("data directory is in use; stop the service before maintenance")

type Lock struct {
	file *os.File
	once sync.Once
	err  error
}

func Acquire(directory string) (*Lock, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	name := filepath.Join(directory, ".daynest.lock")
	if info, err := os.Lstat(name); err == nil {
		if !info.Mode().IsRegular() {
			return nil, errors.New("unsafe data lock file")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	f, err := os.OpenFile(name, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err = tryLock(f); err != nil {
		f.Close()
		return nil, fmt.Errorf("acquire data lock: %w", err)
	}
	return &Lock{file: f}, nil
}

func (l *Lock) Close() error {
	l.once.Do(func() { l.err = l.file.Close() }) // OS releases the lock on close/exit.
	return l.err
}
