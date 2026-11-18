package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestConnectionRefusedFails(t *testing.T) {
	h := startHelper(t, helperSetup{})
	target := map[string]any{"label": "nobody-home", "address": "127.0.0.1", "port": unusedPort(t), "username": testUser, "auth": "password"}
	h.connect("s1", modeTest, target, nil)
	h.expectPhase("s1", "connecting", "nobody-home")
	failed := h.expect("s1", "failed")
	if failed.str("kind") != kindRefused || failed.str("host") != "nobody-home" {
		t.Fatalf("got %s, want failed refused", failed)
	}
}

func TestBadLinesAreIgnored(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	h.sendRaw("this is not json\n")
	h.sendRaw("\n")
	h.sendRaw(`{"op":"teleport","sid":"s1"}` + "\n")
	h.sendRaw(`{"op":"input","sid":"ghost","data":"aGk="}` + "\n")
	h.sendRaw(`{"op":"answer","sid":"ghost","rid":"1","accept":true}` + "\n")
	h.sendRaw(`{"op":"close","sid":{"nested":true}}` + "\n")
	h.sendRaw(`{"op":"connect","sid":"s1","mode":"shell","cols":"wide"}` + "\n")
	h.remember("987654321")
	h.sendRaw(`{"op":"connect","sid":"s1","mode":"test","target":{"label":"x","address":"127.0.0.1","username":"u","auth":"password","password":987654321}}` + "\n")
	h.expectQuiet("", 200*time.Millisecond)
	h.expectQuiet("s1", 50*time.Millisecond)

	connectShell(t, h, srv, "s1", "app-01")
	h.send(map[string]any{"op": "close", "sid": "s1"})
	h.expectClosed("s1", reasonClosed)
	if !strings.Contains(h.stderr.String(), "malformed") {
		t.Fatalf("stderr should explain the malformed line, got %q", h.stderr.String())
	}
}

func TestLineStartingWithByteOrderMarkIsAccepted(t *testing.T) {
	h := startHelper(t, helperSetup{})
	h.sendRaw("\xEF\xBB\xBF" + `{"op":"connect","sid":"s1","mode":"test","target":{"label":"bom","address":"127.0.0.1","username":"u","auth":"teleport"}}` + "\r\n")
	h.expectFailed("s1", kindOther, "bom")
}

func TestInvalidConnectFailsImmediately(t *testing.T) {
	h := startHelper(t, helperSetup{})

	h.connect("s1", modeTest, map[string]any{"label": "odd", "address": "127.0.0.1", "username": testUser, "auth": "carrier-pigeon"}, nil)
	h.expectFailed("s1", kindOther, "odd")

	h.connect("s2", modeTest, map[string]any{"label": "keyless", "address": "127.0.0.1", "username": testUser, "auth": "key"}, nil)
	h.expectFailed("s2", kindKeyFile, "keyless")

	h.connect("s3", "telepathy", map[string]any{"label": "mode", "address": "127.0.0.1", "username": testUser, "auth": "password"}, nil)
	h.expectFailed("s3", kindOther, "mode")
}

func TestVeryLongCommandLineIsAccepted(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	padding := strings.Repeat("A", 8<<20)
	line, _ := json.Marshal(map[string]any{"op": "close", "sid": "s1", "data": padding})
	h.sendRaw(string(line) + "\n")
	h.expectClosed("s1", reasonClosed)
}

func TestTooLongCommandLineIsSkipped(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	padding := strings.Repeat("A", maxCommandLineBytes+10)
	line, _ := json.Marshal(map[string]any{"op": "close", "sid": "s1", "data": padding})
	h.sendRaw(string(line) + "\n")
	h.expectQuiet("s1", 300*time.Millisecond)
	h.send(map[string]any{"op": "close", "sid": "s1"})
	h.expectClosed("s1", reasonClosed)
}

func TestSecondConnectWithActiveSidIsIgnored(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "s1", "app-01")
	h.connect("s1", modeShell, passwordHost("app-01", srv, serverPassword), nil)
	h.expectQuiet("s1", 300*time.Millisecond)
	if srv.handshakes.Load() != 1 {
		t.Fatalf("duplicate connect opened another connection")
	}
}
