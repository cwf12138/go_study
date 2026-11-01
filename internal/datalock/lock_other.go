//go:build !windows && !linux && !darwin && !freebsd && !openbsd && !netbsd && !dragonfly

package datalock

import (
	"errors"
	"os"
)

func tryLock(*os.File) error { return errors.New("data locking is unsupported on this OS") }
