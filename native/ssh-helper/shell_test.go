package main

import (
	"strings"
	"testing"
	"time"
)

func connectShell(t *testing.T, h *helperUnderTest, srv *testServer, sid, label string) {
	t.Helper()
	h.connect(sid, modeShell, passwordHost(label, srv, serverPassword), nil)
	h.expectPhase(sid, "connecting", label)
	h.expectPhase(sid, "authenticating", label)
	h.expect(sid, "connected")
}

func receive[T any](t *testing.T, from <-chan T, what string) T {
	t.Helper()
	select {
	case value := <-from:
		return value
	case <-time.After(eventWait):
		t.Fatalf("server never saw %s", what)
		var zero T
		return zero
	}
}

func TestShellEchoResizeAndExitStatus(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	pty := receive(t, srv.ptyRequests, "pty-req")
	if pty.term != "xterm-256color" || pty.cols != 100 || pty.rows != 30 || !pty.echo {
		t.Fatalf("unexpected pty request %+v", pty)
	}

	h.input("s1", "hello there\n")
	if output := h.readOutputUntil("s1", "hello there\n"); output != "hello there\n" {
		t.Fatalf("echo output %q", output)
	}

	h.send(map[string]any{"op": "resize", "sid": "s1", "cols": 132, "rows": 43})
	if change := receive(t, srv.windowChanges, "window-change"); change.cols != 132 || change.rows != 43 {
		t.Fatalf("unexpected window change %+v", change)
	}

	h.input("s1", "exit 7\n")
	closed := h.expectClosed("s1", reasonExit)
	if status, ok := closed.num("exitStatus"); !ok || status != 7 {
		t.Fatalf("closed event %s, want exitStatus 7", closed)
	}
}

func TestShellExitZeroReportsStatus(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	h.input("s1", "exit 0\n")
	closed := h.expectClosed("s1", reasonExit)
	if status, ok := closed.num("exitStatus"); !ok || status != 0 {
		t.Fatalf("closed event %s, want exitStatus 0", closed)
	}
}

func TestResizeBeforeConnectedSizesThePty(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{})

	h.connect("s1", modeShell, passwordHost("app-01", srv, serverPassword), nil)
	question := h.skipUntil("s1", "hostkey")
	h.send(map[string]any{"op": "resize", "sid": "s1", "cols": 90, "rows": 20})
	h.answer("s1", question["rid"], map[string]any{"accept": true})
	h.skipUntil("s1", "connected")
	if pty := receive(t, srv.ptyRequests, "pty-req"); pty.cols != 90 || pty.rows != 20 {
		t.Fatalf("unexpected pty request %+v", pty)
	}
}

func TestCloseOpEndsShell(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	h.send(map[string]any{"op": "close", "sid": "s1"})
	h.expectClosed("s1", reasonClosed)
	receive(t, srv.connectionsEnded, "the connection close")

	h.send(map[string]any{"op": "close", "sid": "s1"})
	h.input("s1", "ignored\n")
	h.expectQuiet("s1", 200*time.Millisecond)
}

func TestCloseWhileWaitingForAnswerFailsCancelled(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{})

	h.connect("s1", modeShell, passwordHost("app-01", srv, serverPassword), nil)
	h.skipUntil("s1", "hostkey")
	h.send(map[string]any{"op": "close", "sid": "s1"})
	h.expectFailed("s1", kindCancelled, "app-01")
}

func TestPauseHoldsOutputUntilResume(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	const lines = 300000
	command := "flood 300000\n"
	var expected strings.Builder
	expected.WriteString(command)
	for i := 0; i < lines; i++ {
		expected.WriteString(floodLine(i))
	}

	h.send(map[string]any{"op": "pause", "sid": "s1"})
	h.input("s1", command)
	h.expectQuiet("s1", 700*time.Millisecond)
	written := srv.floodWritten.Load()
	if written == 0 || written >= int64(expected.Len()-len(command)) {
		t.Fatalf("server wrote %d of %d bytes while paused; the SSH window should hold it back", written, expected.Len()-len(command))
	}

	h.send(map[string]any{"op": "resume", "sid": "s1"})
	output := h.readOutputUntil("s1", floodLine(lines-1))
	if output != expected.String() {
		t.Fatalf("output after resume differs from the expected stream (got %d bytes, want %d)", len(output), expected.Len())
	}
}

func TestTwoSessionsAreTaggedBySid(t *testing.T) {
	first := startServer(t, serverOptions{password: serverPassword})
	second := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{first, second}})

	h.connect("alpha", modeShell, passwordHost("first", first, serverPassword), nil)
	h.send(map[string]any{"op": "connect", "sid": 7, "mode": modeShell, "target": passwordHost("second", second, serverPassword), "jump": nil, "cols": 80, "rows": 24})
	h.skipUntil("alpha", "connected")
	h.skipUntil("7", "connected")

	h.input("alpha", "from alpha\n")
	h.send(map[string]any{"op": "input", "sid": 7, "data": "ZnJvbSBzZXZlbgo="})
	if output := h.readOutputUntil("alpha", "from alpha\n"); strings.Contains(output, "seven") {
		t.Fatalf("alpha received seven's output: %q", output)
	}
	if output := h.readOutputUntil("7", "from seven\n"); strings.Contains(output, "alpha") {
		t.Fatalf("seven received alpha's output: %q", output)
	}

	h.input("alpha", "exit 1\n")
	h.send(map[string]any{"op": "close", "sid": 7})
	h.expectClosed("alpha", reasonExit)
	h.expectClosed("7", reasonClosed)
}

func TestStdinEOFClosesSessionsAndReturns(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	h.closeStdin()
	h.expectClosed("s1", reasonClosed)
	select {
	case <-h.finished:
	case <-time.After(eventWait):
		t.Fatal("helper did not return after stdin EOF")
	}
	receive(t, srv.connectionsEnded, "the connection close")
}

func TestServerDroppingConnectionIsLost(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	srv.dropConnections()
	h.expectClosed("s1", reasonLost)
}
