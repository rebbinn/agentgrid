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
	case "sftp-open":
		h.openFiles(&cmd)
	case "input", "resize", "pause", "resume", "answer", "close", "sftp-close", "transfer-cancel":
		h.forwardToSession(&cmd)
	case "sftp-list", "sftp-realpath", "sftp-mkdir", "sftp-rename", "sftp-remove", "sftp-chmod":
		h.forwardFileRequest(&cmd)
	case "sftp-upload", "sftp-download":
		h.forwardTransfer(&cmd)
	default:
		h.diag.Printf("ignoring unknown op %q", truncate(cmd.Op, 40))
	}
}

func (h *helper) connect(cmd *command) {
	id, ok := parseOpaqueID(cmd.Sid)
	if !ok {
		h.diag.Print("ignoring connect without a valid sid")
		return
	}
	if f := validateConnect(cmd); f != nil {
		h.rejectOpen(id, f)
		return
	}
	s := newSession(h, id, cmd.modeName(), cmd.Target, cmd.Jump)
	if cmd.Cols > 0 && cmd.Rows > 0 {
		s.cols, s.rows = cmd.Cols, cmd.Rows
	}
	h.start(s)
}

func (h *helper) openFiles(cmd *command) {
	id, ok := parseOpaqueID(cmd.Sid)
	if !ok {
		h.diag.Print("ignoring sftp-open without a valid sid")
		return
	}
	if !cmd.hasVia() {
		if f := validateTargets(cmd); f != nil {
			h.rejectOpen(id, f)
			return
		}
		h.start(newSession(h, id, modeSftp, cmd.Target, cmd.Jump))
		return
	}
	viaID, ok := parseOpaqueID(cmd.Via)
	var via *session
	if ok {
		via = h.lookup(viaID)
	}
	if via == nil || via.connectedShellClient() == nil {
		notConnected := &failure{kind: kindOther, message: "via is not a connected shell session"}
		if via != nil {
			notConnected.host = via.target.displayName()
		}
		h.rejectOpen(id, notConnected)
		return
	}
	s := newSession(h, id, modeSftp, &via.target, nil)
	s.via = via
	h.start(s)
}

func (h *helper) rejectOpen(id opaqueID, f *failure) {
	if h.lookup(id) != nil {
		h.diag.Printf("ignoring open for active sid %s", id.raw)
		return
	}
	h.events.emit(failedEventFor(id, f))
}

func (h *helper) start(s *session) {
	h.mu.Lock()
	if _, exists := h.sessions[s.id.key]; exists {
		h.mu.Unlock()
		h.diag.Printf("ignoring open for active sid %s", s.id.raw)
		return
	}
	h.sessions[s.id.key] = s
	h.running.Add(1)
	h.mu.Unlock()
	go s.run()
}

func (h *helper) forwardToSession(cmd *command) {
	s := h.sessionFor(cmd)
	if s == nil {
		return
	}
	switch cmd.Op {
	case "answer":
		s.deliverAnswer(cmd)
	case "close":
		s.requestClose()
	case "sftp-close":
		if s.mode == modeSftp {
			s.requestClose()
		}
	case "transfer-cancel":
		if files := s.readyFiles(); files != nil {
			files.cancelTransfer(cmd.Tid)
		}
	default:
		if s.mode == modeShell {
			h.forwardToShell(s, cmd)
		}
	}
}

func (h *helper) forwardToShell(s *session, cmd *command) {
	switch cmd.Op {
	case "input":
		data, err := decodeInputData(cmd.Data)
		if err != nil {
			h.diag.Printf("ignoring input for sid %s: data is not base64", s.id.raw)
			return
		}
		s.queueInput(data)
	case "resize":
		s.queueResize(cmd.Cols, cmd.Rows)
	case "pause":
		s.output.pause()
	case "resume":
		s.output.resume()
	}
}

func (h *helper) forwardFileRequest(cmd *command) {
	s := h.sessionFor(cmd)
	if s == nil {
		return
	}
	rid, ok := parseOpaqueID(cmd.Rid)
	if !ok {
		h.diag.Printf("ignoring %s for sid %s without a valid rid", cmd.Op, s.id.raw)
		return
	}
	files := s.readyFiles()
	if files == nil {
		s.emitUnlessFinished(failedReply(s.id, rid, unavailableError(s)))
		return
	}
	files.handleRequest(cmd, rid)
}

func (h *helper) forwardTransfer(cmd *command) {
	s := h.sessionFor(cmd)
	if s == nil {
		return
	}
	tid, ok := parseOpaqueID(cmd.Tid)
	if !ok {
		h.diag.Printf("ignoring %s for sid %s without a valid tid", cmd.Op, s.id.raw)
		return
	}
	files := s.readyFiles()
	if files == nil {
		s.emitUnlessFinished(transferDoneEvent{Ev: "transfer-done", Sid: s.id.raw, Tid: tid.raw, Error: unavailableError(s)})
		return
	}
	files.startTransfer(cmd, tid)
}

func unavailableError(s *session) *sftpError {
	if s.mode != modeSftp {
		return &sftpError{Code: codeFailure, Message: "not an SFTP session"}
	}
	return &sftpError{Code: codeConnection, Message: "the SFTP session is not ready"}
}

func (h *helper) sessionFor(cmd *command) *session {
	id, ok := parseOpaqueID(cmd.Sid)
	if !ok {
		return nil
	}
	return h.lookup(id)
}

func (h *helper) lookup(id opaqueID) *session {
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
	s.emitFinal(finalEvent)
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
	if f := validateTargets(cmd); f != nil {
		return f
	}
	if mode := cmd.modeName(); mode != modeShell && mode != modeTest {
		return &failure{kind: kindOther, message: "unknown mode " + truncate(mode, 40), host: cmd.Target.displayName()}
	}
	return nil
}

func validateTargets(cmd *command) *failure {
	if cmd.Target == nil {
		return &failure{kind: kindOther, message: "no target"}
	}
	if f := validateHostSpec(cmd.Target); f != nil {
		return f
	}
	if cmd.Jump != nil {
		if f := validateHostSpec(cmd.Jump); f != nil {
			return f
		}
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
