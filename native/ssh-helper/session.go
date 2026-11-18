package main

import (
	"context"
	"errors"
	"io"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
)

var (
	tcpConnectTimeout = 15 * time.Second
	handshakeTimeout  = 60 * time.Second
	shutdownGrace     = 5 * time.Second
)

var (
	errUserCancelled = errors.New("cancelled by the user")
	errSessionClosed = errors.New("session closed")
)

type session struct {
	helper *helper
	id     sessionID
	mode   string
	target hostSpec
	jump   *hostSpec

	ctx    context.Context
	cancel context.CancelFunc

	output *flowGate
	inbox  *shellInbox

	mu         sync.Mutex
	cols       int
	rows       int
	ptyClaimed bool
	lastRid    int
	pending    map[string]*pendingQuestion
	closers    []io.Closer

	keepaliveLost atomic.Bool
}

type questionKind int

const (
	hostKeyQuestion questionKind = iota
	promptQuestions
)

type pendingQuestion struct {
	kind          questionKind
	questionCount int
	reply         chan questionReply
}

type questionReply struct {
	accept  bool
	answers []string
	cancel  bool
}

func newSession(h *helper, id sessionID, cmd *command) *session {
	ctx, cancel := context.WithCancel(context.Background())
	s := &session{
		helper:  h,
		id:      id,
		mode:    cmd.Mode,
		target:  *cmd.Target,
		ctx:     ctx,
		cancel:  cancel,
		output:  newFlowGate(),
		inbox:   newShellInbox(),
		cols:    defaultCols,
		rows:    defaultRows,
		pending: make(map[string]*pendingQuestion),
	}
	if cmd.Jump != nil {
		jump := *cmd.Jump
		s.jump = &jump
	}
	if cmd.Cols > 0 && cmd.Rows > 0 {
		s.cols, s.rows = cmd.Cols, cmd.Rows
	}
	return s
}

func (s *session) run() {
	context.AfterFunc(s.ctx, s.closeConnections)
	finalEvent := s.runUntilFinalEvent()
	s.cancel()
	s.closeConnections()
	s.helper.finishSession(s, finalEvent)
}

func (s *session) runUntilFinalEvent() (finalEvent any) {
	connected := false
	defer func() {
		if r := recover(); r != nil {
			s.helper.diag.Printf("session %s: internal error: %v", s.id.raw, r)
			if connected {
				finalEvent = closedEventFor(s.id, reasonLost, nil)
			} else {
				finalEvent = failedEventFor(s.id, &failure{kind: kindOther, message: "internal error", host: s.target.displayName()})
			}
		}
	}()

	client, f := s.establish()
	if f != nil {
		return failedEventFor(s.id, f)
	}
	if s.mode == modeTest {
		connected = true
		s.emit(connectedEvent{Ev: "connected", Sid: s.id.raw})
		return closedEventFor(s.id, reasonClosed, nil)
	}
	return s.serveShell(client, func() { connected = true })
}

func (s *session) establish() (*ssh.Client, *failure) {
	var via *ssh.Client
	if s.jump != nil {
		jumpClient, f := s.openLeg(s.jump, nil)
		if f != nil {
			return nil, f
		}
		via = jumpClient
	}
	return s.openLeg(&s.target, via)
}

func (s *session) serveShell(client *ssh.Client, markConnected func()) any {
	host := s.target.displayName()
	shell, err := client.NewSession()
	if err != nil {
		return failedEventFor(s.id, s.shellStartFailure(host, "could not open a session", err))
	}
	cols, rows := s.claimPtySize()
	if err := shell.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{ssh.ECHO: 1}); err != nil {
		return failedEventFor(s.id, s.shellStartFailure(host, "server refused the terminal", err))
	}
	stdin, err := shell.StdinPipe()
	if err != nil {
		return failedEventFor(s.id, s.shellStartFailure(host, "could not attach stdin", err))
	}
	stdout, err := shell.StdoutPipe()
	if err != nil {
		return failedEventFor(s.id, s.shellStartFailure(host, "could not attach stdout", err))
	}
	stderr, err := shell.StderrPipe()
	if err != nil {
		return failedEventFor(s.id, s.shellStartFailure(host, "could not attach stderr", err))
	}
	if err := shell.Shell(); err != nil {
		return failedEventFor(s.id, s.shellStartFailure(host, "server refused the shell", err))
	}

	markConnected()
	s.emit(connectedEvent{Ev: "connected", Sid: s.id.raw})

	shellCtx, stopShell := context.WithCancel(s.ctx)
	defer stopShell()
	go s.guarded(func() { s.inbox.deliver(shellCtx, stdin, shell) })()

	stopKeepalive := make(chan struct{})
	var keepalive sync.WaitGroup
	keepalive.Go(s.guarded(func() { s.keepAlive(client, stopKeepalive) }))

	var readers sync.WaitGroup
	readers.Go(s.guarded(func() { s.pumpOutput(stdout) }))
	readers.Go(s.guarded(func() { s.pumpOutput(stderr) }))
	readers.Wait()

	waitErr := shell.Wait()
	close(stopKeepalive)
	keepalive.Wait()
	return s.closedEventAfterShell(client, waitErr)
}

func (s *session) shellStartFailure(host, message string, err error) *failure {
	if s.ctx.Err() != nil {
		return &failure{kind: kindCancelled, message: "session closed before it was connected", host: host}
	}
	return &failure{kind: kindOther, message: message + ": " + err.Error(), host: host}
}

func (s *session) closedEventAfterShell(client *ssh.Client, waitErr error) closedEvent {
	var exitErr *ssh.ExitError
	switch {
	case s.ctx.Err() != nil:
		return closedEventFor(s.id, reasonClosed, nil)
	case s.keepaliveLost.Load():
		return closedEventFor(s.id, reasonLost, nil)
	case waitErr == nil:
		status := 0
		return closedEventFor(s.id, reasonExit, &status)
	case errors.As(waitErr, &exitErr):
		status := exitErr.ExitStatus()
		return closedEventFor(s.id, reasonExit, &status)
	}
	if _, outcome := ping(client, keepaliveTimeout, nil); outcome == pingReplied {
		return closedEventFor(s.id, reasonExit, nil)
	}
	return closedEventFor(s.id, reasonLost, nil)
}

func (s *session) pumpOutput(remote io.Reader) {
	buffer := make([]byte, outputChunkBytes)
	for {
		if !s.output.waitOpen(s.ctx) {
			return
		}
		n, err := remote.Read(buffer)
		if n > 0 {
			if !s.output.waitOpen(s.ctx) {
				return
			}
			s.emit(dataEvent{Ev: "data", Sid: s.id.raw, Data: buffer[:n]})
		}
		if err != nil {
			return
		}
	}
}

func (s *session) guarded(task func()) func() {
	return func() {
		defer func() {
			if r := recover(); r != nil {
				s.helper.diag.Printf("session %s: internal error: %v", s.id.raw, r)
				s.requestClose()
			}
		}()
		task()
	}
}

func (s *session) emit(event any) {
	s.helper.events.emit(event)
}

func (s *session) emitPhase(phase, host string) {
	s.emit(phaseEvent{Ev: "phase", Sid: s.id.raw, Phase: phase, Host: host})
}

func (s *session) requestClose() {
	s.cancel()
}

func (s *session) track(c io.Closer) {
	s.mu.Lock()
	if s.ctx.Err() != nil {
		s.mu.Unlock()
		c.Close()
		return
	}
	s.closers = append(s.closers, c)
	s.mu.Unlock()
}

func (s *session) closeConnections() {
	s.mu.Lock()
	closers := s.closers
	s.closers = nil
	s.mu.Unlock()
	for i := len(closers) - 1; i >= 0; i-- {
		closers[i].Close()
	}
}

func (s *session) claimPtySize() (cols, rows int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ptyClaimed = true
	return s.cols, s.rows
}

func (s *session) queueInput(data []byte) {
	if len(data) == 0 {
		return
	}
	s.inbox.push(shellAction{input: data})
}

func (s *session) queueResize(cols, rows int) {
	if cols <= 0 || rows <= 0 {
		return
	}
	s.mu.Lock()
	s.cols, s.rows = cols, rows
	claimed := s.ptyClaimed
	s.mu.Unlock()
	if claimed {
		s.inbox.push(shellAction{resize: true, cols: cols, rows: rows})
	}
}

func (s *session) ask(kind questionKind, questionCount int, watchdog *handshakeWatchdog, eventFor func(rid string) any) (questionReply, error) {
	question := &pendingQuestion{kind: kind, questionCount: questionCount, reply: make(chan questionReply, 1)}
	s.mu.Lock()
	s.lastRid++
	rid := strconv.Itoa(s.lastRid)
	s.pending[rid] = question
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, rid)
		s.mu.Unlock()
	}()

	watchdog.suspend()
	defer watchdog.resume()
	s.emit(eventFor(rid))
	select {
	case reply := <-question.reply:
		if reply.cancel {
			return reply, errUserCancelled
		}
		return reply, nil
	case <-s.ctx.Done():
		return questionReply{}, errSessionClosed
	}
}

func (s *session) deliverAnswer(cmd *command) {
	rid, ok := parseRequestID(cmd.Rid)
	if !ok {
		return
	}
	s.mu.Lock()
	question := s.pending[rid]
	if question == nil {
		s.mu.Unlock()
		return
	}
	reply, problem := question.interpret(cmd)
	if problem != "" {
		s.mu.Unlock()
		s.helper.diag.Printf("ignoring answer for sid %s rid %s: %s", s.id.raw, rid, problem)
		return
	}
	delete(s.pending, rid)
	s.mu.Unlock()
	question.reply <- reply
}

func (q *pendingQuestion) interpret(cmd *command) (questionReply, string) {
	if cmd.Cancel {
		return questionReply{cancel: true}, ""
	}
	switch q.kind {
	case hostKeyQuestion:
		if cmd.Accept == nil {
			return questionReply{}, "hostkey answer needs accept or cancel"
		}
		return questionReply{accept: *cmd.Accept}, ""
	default:
		if len(cmd.Answers) != q.questionCount {
			return questionReply{}, "expected " + strconv.Itoa(q.questionCount) + " answers, got " + strconv.Itoa(len(cmd.Answers))
		}
		return questionReply{answers: cmd.Answers}, ""
	}
}

type flowGate struct {
	mu     sync.Mutex
	paused bool
	open   chan struct{}
}

func newFlowGate() *flowGate {
	open := make(chan struct{})
	close(open)
	return &flowGate{open: open}
}

func (g *flowGate) pause() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.paused {
		g.paused = true
		g.open = make(chan struct{})
	}
}

func (g *flowGate) resume() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.paused {
		g.paused = false
		close(g.open)
	}
}

func (g *flowGate) waitOpen(ctx context.Context) bool {
	g.mu.Lock()
	open := g.open
	g.mu.Unlock()
	select {
	case <-open:
		return true
	case <-ctx.Done():
		return false
	}
}

type shellAction struct {
	input  []byte
	resize bool
	cols   int
	rows   int
}

type shellInbox struct {
	mu      sync.Mutex
	actions []shellAction
	wake    chan struct{}
}

func newShellInbox() *shellInbox {
	return &shellInbox{wake: make(chan struct{}, 1)}
}

func (b *shellInbox) push(action shellAction) {
	b.mu.Lock()
	b.actions = append(b.actions, action)
	b.mu.Unlock()
	select {
	case b.wake <- struct{}{}:
	default:
	}
}

func (b *shellInbox) take() []shellAction {
	b.mu.Lock()
	defer b.mu.Unlock()
	actions := b.actions
	b.actions = nil
	return actions
}

func (b *shellInbox) deliver(ctx context.Context, stdin io.Writer, shell *ssh.Session) {
	for {
		for _, action := range b.take() {
			if action.resize {
				if err := shell.WindowChange(action.rows, action.cols); err != nil {
					return
				}
				continue
			}
			if _, err := stdin.Write(action.input); err != nil {
				return
			}
		}
		select {
		case <-b.wake:
		case <-ctx.Done():
			return
		}
	}
}
