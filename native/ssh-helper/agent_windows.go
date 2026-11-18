//go:build windows

package main

import (
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

var (
	agentPipePath    = `\\.\pipe\openssh-ssh-agent`
	agentDialTimeout = 2 * time.Second
)

func dialAgent() (net.Conn, error) {
	timeout := agentDialTimeout
	return winio.DialPipe(agentPipePath, &timeout)
}

func agentLocation() string {
	return agentPipePath
}
