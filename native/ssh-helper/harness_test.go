package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const eventWait = 10 * time.Second

type testEvent map[string]any

func (e testEvent) str(key string) string {
	value, _ := e[key].(string)
	return value
}

func (e testEvent) num(key string) (int, bool) {
	value, ok := e[key].(float64)
	return int(value), ok
}

func (e testEvent) data(t *testing.T) []byte {
	t.Helper()
	decoded, err := base64.StdEncoding.DecodeString(e.str("data"))
	if err != nil {
		t.Fatalf("data event is not base64: %v", err)
	}
	return decoded
}

func (e testEvent) String() string {
	encoded, _ := json.Marshal(e)
	return string(encoded)
}

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

type helperUnderTest struct {
	t              *testing.T
	knownHostsFile string
	stdin          *io.PipeWriter
	stdinMu        sync.Mutex
	stdout         lockedBuffer
	stderr         lockedBuffer
	finished       chan struct{}
	secrets        []string
	sequence       int

	queuesMu sync.Mutex
	queues   map[string]chan testEvent
}

type helperSetup struct {
	knownHostsFile string
	extraFiles     []string
	trusted        []*testServer
}

func startHelper(t *testing.T, setup helperSetup) *helperUnderTest {
	t.Helper()
	if setup.knownHostsFile == "" {
		setup.knownHostsFile = filepath.Join(t.TempDir(), "agentgrid", "known_hosts")
	}
	if len(setup.trusted) > 0 {
		var lines strings.Builder
		for _, srv := range setup.trusted {
			lines.WriteString(srv.knownHostsLine() + "\n")
		}
		writeFile(t, setup.knownHostsFile, lines.String())
	}

	stdinReader, stdinWriter := io.Pipe()
	stdoutReader, stdoutWriter := io.Pipe()
	h := &helperUnderTest{
		t:              t,
		knownHostsFile: setup.knownHostsFile,
		stdin:          stdinWriter,
		finished:       make(chan struct{}),
		queues:         make(map[string]chan testEvent),
	}
	program := newHelper(options{knownHostsFile: setup.knownHostsFile, extraKnownHostsFiles: setup.extraFiles}, stdoutWriter, &h.stderr)
	go func() {
		program.run(stdinReader)
		stdoutWriter.Close()
		close(h.finished)
	}()
	go h.readEvents(stdoutReader)

	ready := h.next("", eventWait)
	if ready.str("ev") != "ready" {
		t.Fatalf("first event is %s, want ready", ready)
	}
	if version, _ := ready.num("version"); version != 1 {
		t.Fatalf("ready version = %d, want 1", version)
	}
	t.Cleanup(h.shutdown)
	return h
}

func (h *helperUnderTest) readEvents(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64<<10), 16<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		h.stdout.Write(line)
		h.stdout.Write([]byte("\n"))
		var event testEvent
		if err := json.Unmarshal(line, &event); err != nil {
			h.t.Errorf("helper wrote a non-JSON line: %q", line)
			continue
		}
		h.sequence++
		event["_seq"] = float64(h.sequence)
		h.queue(queueKey(event)) <- event
	}
}

func queueKey(event testEvent) string {
	key := sidKey(event["sid"])
	switch event.str("ev") {
	case "sftp-reply":
		return key + "#rid:" + fmt.Sprint(event["rid"])
	case "transfer", "transfer-done":
		return key + "#tid:" + fmt.Sprint(event["tid"])
	}
	return key
}

func sidKey(sid any) string {
	if sid == nil {
		return ""
	}
	return fmt.Sprint(sid)
}

func (h *helperUnderTest) queue(sid string) chan testEvent {
	h.queuesMu.Lock()
	defer h.queuesMu.Unlock()
	queue, ok := h.queues[sid]
	if !ok {
		queue = make(chan testEvent, 1<<16)
		h.queues[sid] = queue
	}
	return queue
}

func (h *helperUnderTest) shutdown() {
	h.closeStdin()
	select {
	case <-h.finished:
	case <-time.After(15 * time.Second):
		h.t.Errorf("helper did not return after stdin EOF")
	}
	everything := h.stdout.String() + h.stderr.String()
	for _, secret := range h.secrets {
		if strings.Contains(everything, secret) {
			h.t.Errorf("secret %q leaked to stdout or stderr", secret)
		}
	}
	if h.t.Failed() {
		h.t.Logf("helper stderr:\n%s", h.stderr.String())
	}
}

func (h *helperUnderTest) closeStdin() {
	h.stdinMu.Lock()
	defer h.stdinMu.Unlock()
	h.stdin.Close()
}

func (h *helperUnderTest) remember(secrets ...string) {
	h.secrets = append(h.secrets, secrets...)
}

func (h *helperUnderTest) send(cmd map[string]any) {
	h.t.Helper()
	encoded, err := json.Marshal(cmd)
	if err != nil {
		h.t.Fatal(err)
	}
	h.sendRaw(string(encoded) + "\n")
}

func (h *helperUnderTest) sendRaw(line string) {
	h.t.Helper()
	h.stdinMu.Lock()
	defer h.stdinMu.Unlock()
	if _, err := io.WriteString(h.stdin, line); err != nil {
		h.t.Fatalf("writing to helper stdin: %v", err)
	}
}

func (h *helperUnderTest) next(sid string, timeout time.Duration) testEvent {
	h.t.Helper()
	select {
	case event := <-h.queue(sid):
		return event
	case <-time.After(timeout):
		h.t.Fatalf("no event for sid %q within %s", sid, timeout)
		return nil
	}
}

func (h *helperUnderTest) expect(sid, ev string) testEvent {
	h.t.Helper()
	event := h.next(sid, eventWait)
	if event.str("ev") != ev {
		h.t.Fatalf("sid %s: got %s, want %s event", sid, event, ev)
	}
	return event
}

func (h *helperUnderTest) expectPhase(sid, phase, host string) {
	h.t.Helper()
	event := h.expect(sid, "phase")
	if event.str("phase") != phase || event.str("host") != host {
		h.t.Fatalf("sid %s: got %s, want phase %s for %s", sid, event, phase, host)
	}
}

func (h *helperUnderTest) skipUntil(sid, ev string) testEvent {
	h.t.Helper()
	deadline := time.Now().Add(eventWait)
	for {
		event := h.next(sid, time.Until(deadline))
		if event.str("ev") == ev {
			return event
		}
		if final := event.str("ev"); final == "failed" || final == "closed" {
			h.t.Fatalf("sid %s: session ended with %s while waiting for %s", sid, event, ev)
		}
	}
}

func (h *helperUnderTest) expectQuiet(sid string, period time.Duration) {
	h.t.Helper()
	select {
	case event := <-h.queue(sid):
		h.t.Fatalf("sid %s: unexpected event %s", sid, event)
	case <-time.After(period):
	}
}

func (h *helperUnderTest) expectFailed(sid, kind, host string) testEvent {
	h.t.Helper()
	event := h.skipUntilFinal(sid)
	if event.str("ev") != "failed" || event.str("kind") != kind || event.str("host") != host {
		h.t.Fatalf("sid %s: got %s, want failed %s for %s", sid, event, kind, host)
	}
	return event
}

func (h *helperUnderTest) expectClosed(sid, reason string) testEvent {
	h.t.Helper()
	event := h.skipUntilFinal(sid)
	if event.str("ev") != "closed" || event.str("reason") != reason {
		h.t.Fatalf("sid %s: got %s, want closed %s", sid, event, reason)
	}
	return event
}

func (h *helperUnderTest) skipUntilFinal(sid string) testEvent {
	h.t.Helper()
	deadline := time.Now().Add(eventWait)
	for {
		event := h.next(sid, time.Until(deadline))
		switch event.str("ev") {
		case "failed", "closed":
			return event
		case "hostkey", "prompt":
			h.t.Fatalf("sid %s: unexpected question %s", sid, event)
		}
	}
}

func (h *helperUnderTest) connect(sid, mode string, target map[string]any, jump map[string]any) {
	h.t.Helper()
	cmd := map[string]any{"op": "connect", "sid": sid, "mode": mode, "target": target, "jump": jump, "cols": 100, "rows": 30}
	h.send(cmd)
}

func (h *helperUnderTest) answer(sid string, rid any, fields map[string]any) {
	h.t.Helper()
	cmd := map[string]any{"op": "answer", "sid": sid, "rid": rid}
	for key, value := range fields {
		cmd[key] = value
	}
	h.send(cmd)
}

func (h *helperUnderTest) input(sid, text string) {
	h.t.Helper()
	h.send(map[string]any{"op": "input", "sid": sid, "data": base64.StdEncoding.EncodeToString([]byte(text))})
}

func (h *helperUnderTest) readOutputUntil(sid, marker string) string {
	h.t.Helper()
	var output []byte
	deadline := time.Now().Add(eventWait)
	for {
		event := h.next(sid, time.Until(deadline))
		switch event.str("ev") {
		case "data":
			chunk := event.data(h.t)
			searchFrom := max(0, len(output)-len(marker))
			output = append(output, chunk...)
			if bytes.Contains(output[searchFrom:], []byte(marker)) {
				return string(output)
			}
		case "latency":
		default:
			h.t.Fatalf("sid %s: got %s while reading output (have %d bytes)", sid, event, len(output))
		}
	}
}

func passwordHost(label string, srv *testServer, password string) map[string]any {
	host := map[string]any{"label": label, "address": "127.0.0.1", "port": srv.port, "username": testUser, "auth": "password"}
	if password != "" {
		host["password"] = password
	}
	return host
}

func keyHost(label string, srv *testServer, keyPath, passphrase string) map[string]any {
	host := map[string]any{"label": label, "address": "127.0.0.1", "port": srv.port, "username": testUser, "auth": "key", "keyPath": keyPath}
	if passphrase != "" {
		host["passphrase"] = passphrase
	}
	return host
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}

func overrideDuration(t *testing.T, target *time.Duration, value time.Duration) {
	t.Helper()
	previous := *target
	*target = value
	t.Cleanup(func() { *target = previous })
}
