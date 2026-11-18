//go:build windows

package main

import (
	"errors"
	"slices"
	"syscall"
)

const (
	errorSemTimeout         syscall.Errno = 121
	errorConnectionRefused  syscall.Errno = 1225
	errorNetworkUnreachable syscall.Errno = 1231
	errorHostUnreachable    syscall.Errno = 1232
	wsaConnectionTimedOut   syscall.Errno = 10060
	wsaConnectionRefused    syscall.Errno = 10061
	wsaNetworkUnreachable   syscall.Errno = 10051
	wsaHostUnreachable      syscall.Errno = 10065
)

func isConnectionRefused(err error) bool {
	return hasErrno(err, errorConnectionRefused, wsaConnectionRefused)
}

func isUnreachable(err error) bool {
	return hasErrno(err, errorNetworkUnreachable, errorHostUnreachable, wsaNetworkUnreachable, wsaHostUnreachable)
}

func isTimedOutErrno(err error) bool {
	return hasErrno(err, errorSemTimeout, wsaConnectionTimedOut)
}

func hasErrno(err error, candidates ...syscall.Errno) bool {
	var errno syscall.Errno
	return errors.As(err, &errno) && slices.Contains(candidates, errno)
}
