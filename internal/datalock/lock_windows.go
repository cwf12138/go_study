package datalock

import (
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

var lockFileEx = syscall.NewLazyDLL("kernel32.dll").NewProc("LockFileEx")

func tryLock(f *os.File) error {
	var overlapped syscall.Overlapped
	ok, _, err := lockFileEx.Call(f.Fd(), 0x00000002|0x00000001, 0, 1, 0, uintptr(unsafe.Pointer(&overlapped)))
	runtime.KeepAlive(&overlapped)
	runtime.KeepAlive(f)
	if ok != 0 {
		return nil
	}
	if err == syscall.Errno(33) { // ERROR_LOCK_VIOLATION
		return ErrBusy
	}
	return err
}
