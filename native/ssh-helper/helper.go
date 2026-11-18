package main

import (
	"encoding/json"
	"io"
	"log"
	"strings"
	"sync"
	"time"
)

type options struct {
	knownHostsFile       string
	extraKnownHostsFiles []string
}

type helper struct {
	events     *eventWriter
	diag       *log.Logger
	knownHosts *knownHosts

	mu       sync.Mutex
	sessions map[string]*session
	running  sync.WaitGroup
}

func newHelper(opts options, stdout, stderr io.Writer) *helper {
	diag := log.New(stderr, "agentgrid-ssh: ", log.LstdFlags)
	return &helper{
		events:     &eventWriter{out: stdout, diag: diag},
		diag:       diag,
		knownHosts: &knownHosts{ownFile: opts.knownHostsFile, extraFiles: opts.extraKnownHostsFiles, diag: diag},
		sessions:   make(map[string]*session),
	}
}

func (h *helper) run(stdin io.Reader) {
	h.events.emit(readyEvent{Ev: "ready", Version: protocolVersion})
	if err := readCommandLines(stdin, h.handleLine, h.diag); err != nil {
		h.diag.Printf("stopped reading stdin: %v", err)
	}
	h.closeAllSessions()
}

func (h *helper) handleLine(line []byte) {
	defer func() {
		if r := recover(); r != nil {
			h.diag.Printf("internal error while handling a command: %v", r)
		}
	}()
	if len(strings.TrimSpace(string(line))) == 0 {
		return
	}
	var cmd command
	if err := json.Unmarshal(line, &cmd); err != nil {
		h.diag.Printf("ignoring malformed command: %s", describeDecodeError(err))
		return
	}
	switch cmd.Op {
	case "connect":
		h.connect(&cmd)
	case "input", "resize", "pause", "resume", "answer", "close":
		h.forwardToSession(&cmd)
	default:
		h.diag.Printf("ignoring unknown op %q", truncate(cmd.Op, 40))
	}
}

func (h *helper) connect(cmd *command) {
	id, ok := parseSessionID(cmd.Sid)
	if !ok {
		h.diag.Print("ignoring connect without a valid sid")
		return
	}
	if f := validateConnect(cmd); f != nil {
		if h.lookup(id) != nil {
			h.diag.Printf("ignoring connect for active sid %s", id.raw)
			return
		}
		h.events.emit(failedEventFor(id, f))
		return
	}
	h.mu.Lock()
	if _, exists := h.sessions[id.key]; exists {
		h.mu.Unlock()
		h.diag.Printf("ignoring connect for active sid %s", id.raw)
		return
	}
	s := newSession(h, id, cmd)
	h.sessions[id.key] = s
	h.running.Add(1)
	h.mu.Unlock()
	go s.run()
}

func (h *helper) forwardToSession(cmd *command) {
	id, ok := parseSessionID(cmd.Sid)
	if !ok {
		return
	}
	s := h.lookup(id)
	if s == nil {
		return
	}
	switch cmd.Op {
	case "input":
		data, err := decodeInputData(cmd.Data)
		if err != nil {
			h.diag.Printf("ignoring input for sid %s: data is not base64", id.raw)
			return
		}
		s.queueInput(data)
	case "resize":
		s.queueResize(cmd.Cols, cmd.Rows)
	case "pause":
		s.output.pause()
	case "resume":
		s.output.resume()
	case "answer":
		s.deliverAnswer(cmd)
	case "close":
		s.requestClose()
	}
}

func (h *helper) lookup(id sessionID) *session {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sessions[id.key]
}

func (h *helper) finishSession(s *session, finalEvent any) {
	h.mu.Lock()
	if h.sessions[s.id.key] == s {
		delete(h.sessions, s.id.key)
	}
	h.mu.Unlock()
	h.events.emit(finalEvent)
	h.running.Done()
}

func (h *helper) closeAllSessions() {
	h.mu.Lock()
	open := make([]*session, 0, len(h.sessions))
	for _, s := range h.sessions {
		open = append(open, s)
	}
	h.mu.Unlock()
	for _, s := range open {
		s.requestClose()
	}
	finished := make(chan struct{})
	go func() {
		h.running.Wait()
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(shutdownGrace):
		h.diag.Print("some sessions did not finish closing in time")
	}
}

func validateConnect(cmd *command) *failure {
	if cmd.Target == nil {
		return &failure{kind: kindOther, message: "connect has no target"}
	}
	if f := validateHostSpec(cmd.Target); f != nil {
		return f
	}
	if cmd.Jump != nil {
		if f := validateHostSpec(cmd.Jump); f != nil {
			return f
		}
	}
	if cmd.Mode != modeShell && cmd.Mode != modeTest {
		return &failure{kind: kindOther, message: "unknown mode " + truncate(cmd.Mode, 40), host: cmd.Target.displayName()}
	}
	return nil
}

func validateHostSpec(spec *hostSpec) *failure {
	host := spec.displayName()
	switch {
	case spec.Address == "":
		return &failure{kind: kindOther, message: "host has no address", host: host}
	case spec.Port < 0 || spec.Port > 65535:
		return &failure{kind: kindOther, message: "port is out of range", host: host}
	case spec.Username == "":
		return &failure{kind: kindOther, message: "host has no username", host: host}
	}
	switch spec.Auth {
	case authPassword, authAgent:
	case authKey:
		if spec.KeyPath == "" {
			return &failure{kind: kindKeyFile, message: "keyPath is required for key auth", host: host}
		}
	default:
		return &failure{kind: kindOther, message: "unknown auth method " + truncate(spec.Auth, 40), host: host}
	}
	return nil
}

func truncate(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "..."
}
