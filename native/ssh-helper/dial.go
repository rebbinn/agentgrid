package main

import (
	"context"
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

func (s *session) openLeg(spec *hostSpec, via *ssh.Client) (*ssh.Client, *failure) {
	host := spec.displayName()
	address := spec.dialAddress()
	s.emitPhase("connecting", host)

	conn, f := s.openTransport(spec, address, via)
	if f != nil {
		return nil, f
	}
	s.track(conn)

	watchdog := startHandshakeWatchdog(handshakeTimeout, func() { conn.Close() })
	defer watchdog.stop()
	leg := newLegHandshake(s, spec, address, watchdog)
	defer leg.release()

	sshConn, channels, requests, err := ssh.NewClientConn(conn, address, leg.clientConfig())
	if err != nil {
		return nil, s.handshakeFailure(leg, watchdog, err)
	}
	client := ssh.NewClient(sshConn, channels, requests)
	s.track(client)
	return client, nil
}

func (s *session) openTransport(spec *hostSpec, address string, via *ssh.Client) (net.Conn, *failure) {
	host := spec.displayName()
	ctx, cancel := context.WithTimeout(s.ctx, tcpConnectTimeout)
	defer cancel()

	var conn net.Conn
	var err error
	if via == nil {
		var dialer net.Dialer
		conn, err = dialer.DialContext(ctx, "tcp", address)
	} else {
		conn, err = via.DialContext(ctx, "tcp", address)
	}
	if err == nil {
		return conn, nil
	}
	if s.ctx.Err() != nil {
		return nil, cancelledBeforeConnected(host)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return nil, &failure{kind: kindTimeout, message: "connection to " + address + " timed out", host: host}
	}
	if via != nil {
		kind, message := classifyForwardError(err)
		return nil, &failure{kind: kind, message: message + " (" + address + ", through the jump host)", host: host}
	}
	kind, message := classifyDialError(err)
	return nil, &failure{kind: kind, message: message + " (" + address + ")", host: host}
}

func (s *session) handshakeFailure(leg *legHandshake, watchdog *handshakeWatchdog, err error) *failure {
	host := leg.spec.displayName()
	if s.ctx.Err() != nil {
		return cancelledBeforeConnected(host)
	}
	if f := leg.recordedFailure(); f != nil {
		return f
	}
	if watchdog.hasFired() {
		return &failure{kind: kindTimeout, message: "the server did not finish the SSH handshake in time", host: host}
	}
	text := err.Error()
	lowered := strings.ToLower(text)
	switch {
	case strings.Contains(lowered, "unable to authenticate"),
		strings.Contains(lowered, "too many authentication"),
		strings.Contains(lowered, "authentication failures"):
		return &failure{kind: kindAuth, message: "authentication failed for " + leg.spec.Username, host: host}
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return &failure{kind: kindOther, message: "the server closed the connection during the SSH handshake", host: host}
	}
	return &failure{kind: kindOther, message: text, host: host}
}

func cancelledBeforeConnected(host string) *failure {
	return &failure{kind: kindCancelled, message: "session closed before it was connected", host: host}
}

func classifyDialError(err error) (kind, message string) {
	var dnsErr *net.DNSError
	switch {
	case errors.As(err, &dnsErr):
		return kindDNS, "cannot resolve " + dnsErr.Name
	case isConnectionRefused(err):
		return kindRefused, "connection refused"
	case isUnreachable(err):
		return kindUnreachable, "network or host unreachable"
	case isTimeout(err):
		return kindTimeout, "connection timed out"
	}
	return kindOther, err.Error()
}

func classifyForwardError(err error) (kind, message string) {
	var openErr *ssh.OpenChannelError
	if !errors.As(err, &openErr) {
		if isTimeout(err) {
			return kindTimeout, "connection timed out"
		}
		return kindJump, "jump host could not open a connection: " + err.Error()
	}
	reason := strings.ToLower(openErr.Message)
	switch {
	case openErr.Reason == ssh.Prohibited:
		return kindJump, "jump host does not allow forwarding: " + openErr.Message
	case strings.Contains(reason, "refused"):
		return kindRefused, "connection refused"
	case strings.Contains(reason, "timed out"), strings.Contains(reason, "timeout"):
		return kindTimeout, "connection timed out"
	case strings.Contains(reason, "unreachable"), strings.Contains(reason, "no route"):
		return kindUnreachable, "network or host unreachable"
	case strings.Contains(reason, "not known"),
		strings.Contains(reason, "name resolution"),
		strings.Contains(reason, "no such host"),
		strings.Contains(reason, "resolve"):
		return kindDNS, "cannot resolve the address"
	}
	return kindJump, "jump host could not open a connection: " + openErr.Error()
}

func isTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || isTimedOutErrno(err) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

type handshakeWatchdog struct {
	mu          sync.Mutex
	limit       time.Duration
	onExpire    func()
	timer       *time.Timer
	generation  int
	suspensions int
	stopped     bool
	expired     bool
}

func startHandshakeWatchdog(limit time.Duration, onExpire func()) *handshakeWatchdog {
	w := &handshakeWatchdog{limit: limit, onExpire: onExpire}
	w.mu.Lock()
	w.arm()
	w.mu.Unlock()
	return w
}

func (w *handshakeWatchdog) arm() {
	w.generation++
	generation := w.generation
	w.timer = time.AfterFunc(w.limit, func() { w.expire(generation) })
}

func (w *handshakeWatchdog) expire(generation int) {
	w.mu.Lock()
	if w.stopped || w.suspensions > 0 || generation != w.generation {
		w.mu.Unlock()
		return
	}
	w.expired = true
	w.mu.Unlock()
	w.onExpire()
}

func (w *handshakeWatchdog) suspend() {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.suspensions++
	w.timer.Stop()
}

func (w *handshakeWatchdog) resume() {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.suspensions--
	if w.suspensions == 0 && !w.stopped && !w.expired {
		w.arm()
	}
}

func (w *handshakeWatchdog) stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopped = true
	w.timer.Stop()
}

func (w *handshakeWatchdog) hasFired() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.expired
}
