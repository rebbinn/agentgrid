package main

import (
	"time"

	"golang.org/x/crypto/ssh"
)

const keepaliveRequest = "keepalive@openssh.com"

var (
	keepaliveInterval = 15 * time.Second
	keepaliveTimeout  = 20 * time.Second
)

type pingOutcome int

const (
	pingReplied pingOutcome = iota
	pingTimedOut
	pingFailed
	pingStopped
)

func (s *session) keepAlive(client *ssh.Client, stop <-chan struct{}) {
	ticker := time.NewTicker(keepaliveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		}
		roundTrip, outcome := ping(client, keepaliveTimeout, stop)
		switch outcome {
		case pingReplied:
			if s.mode == modeShell {
				s.emit(latencyEvent{Ev: "latency", Sid: s.id.raw, Ms: roundTrip.Milliseconds()})
			}
		case pingTimedOut:
			s.keepaliveLost.Store(true)
			client.Close()
			return
		default:
			return
		}
	}
}

func ping(client *ssh.Client, timeout time.Duration, stop <-chan struct{}) (time.Duration, pingOutcome) {
	started := time.Now()
	replied := make(chan error, 1)
	go func() {
		_, _, err := client.SendRequest(keepaliveRequest, true, nil)
		replied <- err
	}()
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	select {
	case err := <-replied:
		if err != nil {
			return 0, pingFailed
		}
		return time.Since(started), pingReplied
	case <-deadline.C:
		return 0, pingTimedOut
	case <-stop:
		return 0, pingStopped
	}
}
