//go:build !windows

package main

import (
	"errors"
	"net"
	"os"
	"time"
)

var agentDialTimeout = 2 * time.Second

func dialAgent() (net.Conn, error) {
	socket := os.Getenv("SSH_AUTH_SOCK")
	if socket == "" {
		return nil, errors.New("SSH_AUTH_SOCK is not set")
	}
	return net.DialTimeout("unix", socket, agentDialTimeout)
}

func agentLocation() string {
	return "SSH_AUTH_SOCK"
}
