package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func expectHostKeyQuestion(t *testing.T, h *helperUnderTest, sid string, srv *testServer, host string) testEvent {
	t.Helper()
	h.expectPhase(sid, "connecting", host)
	event := h.expect(sid, "hostkey")
	wantAddress := fmt.Sprintf("[127.0.0.1]:%d", srv.port)
	switch {
	case event.str("host") != host,
		event.str("address") != wantAddress,
		event.str("keyType") != ssh.KeyAlgoED25519,
		event.str("fingerprint") != ssh.FingerprintSHA256(srv.hostKey.PublicKey()),
		event.str("rid") == "":
		t.Fatalf("unexpected hostkey event %s (want address %s)", event, wantAddress)
	}
	return event
}

func TestUnknownHostKeyAcceptedIsRememberedInNewFolder(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	knownHostsFile := filepath.Join(t.TempDir(), "not", "yet", "there", "known_hosts")
	h := startHelper(t, helperSetup{knownHostsFile: knownHostsFile})

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	question := expectHostKeyQuestion(t, h, "s1", srv, "app-01")
	h.connectAfterQuestion(t, "s1", question)

	saved := readFile(t, knownHostsFile)
	if strings.TrimSpace(saved) != srv.knownHostsLine() {
		t.Fatalf("known_hosts content %q, want %q", saved, srv.knownHostsLine())
	}

	h.connect("s2", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	h.expectPhase("s2", "connecting", "app-01")
	h.expectPhase("s2", "authenticating", "app-01")
	h.expect("s2", "connected")
	h.expectClosed("s2", reasonClosed)
}

func (h *helperUnderTest) connectAfterQuestion(t *testing.T, sid string, question testEvent) {
	t.Helper()
	h.answer(sid, question["rid"], map[string]any{"accept": true})
	h.expectPhase(sid, "authenticating", question.str("host"))
	h.expect(sid, "connected")
	h.expectClosed(sid, reasonClosed)
}

func TestUnknownHostKeyRejected(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{})

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	question := expectHostKeyQuestion(t, h, "s1", srv, "app-01")
	h.answer("s1", question["rid"], map[string]any{"accept": false})
	failed := h.expectFailed("s1", kindHostKeyRejected, "app-01")
	if failed.str("fingerprint") != ssh.FingerprintSHA256(srv.hostKey.PublicKey()) {
		t.Fatalf("rejected event should carry the fingerprint: %s", failed)
	}
	if _, err := os.Stat(h.knownHostsFile); !os.IsNotExist(err) {
		t.Fatalf("known_hosts must not be written after a rejection (stat err %v)", err)
	}
}

func TestUnknownHostKeyCancelled(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{})

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	question := expectHostKeyQuestion(t, h, "s1", srv, "app-01")
	h.answer("s1", question["rid"], map[string]any{"cancel": true})
	h.expectFailed("s1", kindHostKeyRejected, "app-01")
}

func TestChangedHostKeyFailsWithoutQuestion(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	impostor := newHostKey(t)
	knownHostsFile := filepath.Join(t.TempDir(), "known_hosts")
	writeFile(t, knownHostsFile, knownhosts.Line([]string{srv.addr}, impostor.PublicKey())+"\n")
	h := startHelper(t, helperSetup{knownHostsFile: knownHostsFile})

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	h.expectPhase("s1", "connecting", "app-01")
	failed := h.expect("s1", "failed")
	switch {
	case failed.str("kind") != kindHostKeyChanged,
		failed.str("host") != "app-01",
		failed.str("fingerprint") != ssh.FingerprintSHA256(srv.hostKey.PublicKey()),
		failed.str("knownHostsFile") != knownHostsFile:
		t.Fatalf("unexpected failure %s", failed)
	}
}

func TestKnownKeyOfAnotherTypeStillAsks(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	rsaPublic, err := ssh.NewPublicKey(&rsaKey.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	knownHostsFile := filepath.Join(t.TempDir(), "known_hosts")
	writeFile(t, knownHostsFile, knownhosts.Line([]string{srv.addr}, rsaPublic)+"\n")
	h := startHelper(t, helperSetup{knownHostsFile: knownHostsFile})

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	question := expectHostKeyQuestion(t, h, "s1", srv, "app-01")
	h.connectAfterQuestion(t, "s1", question)
}

func TestKnownKeyTypeIsPreferredDuringNegotiation(t *testing.T) {
	ecdsaKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ecdsaSigner, err := ssh.NewSignerFromKey(ecdsaKey)
	if err != nil {
		t.Fatal(err)
	}
	srv := startServer(t, serverOptions{password: serverPassword, extraHostKeys: []ssh.Signer{ecdsaSigner}})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

func TestExtraKnownHostsAreReadButNeverWritten(t *testing.T) {
	known := startServer(t, serverOptions{password: serverPassword})
	unknown := startServer(t, serverOptions{password: serverPassword})
	folder := t.TempDir()
	extra := filepath.Join(folder, "openssh_known_hosts")
	extraContent := "# managed by OpenSSH\n" + known.knownHostsLine() + "\n"
	writeFile(t, extra, extraContent)
	missingExtra := filepath.Join(folder, "missing", "known_hosts")
	own := filepath.Join(folder, "agentgrid_known_hosts")
	h := startHelper(t, helperSetup{knownHostsFile: own, extraFiles: []string{missingExtra, extra}})

	h.connect("s1", modeTest, passwordHost("known", known, serverPassword), nil)
	h.expectPhase("s1", "connecting", "known")
	h.expectPhase("s1", "authenticating", "known")
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
	if _, err := os.Stat(own); !os.IsNotExist(err) {
		t.Fatalf("own known_hosts must not be created for a key known from the extra file (stat err %v)", err)
	}

	h.connect("s2", modeTest, passwordHost("unknown", unknown, serverPassword), nil)
	question := expectHostKeyQuestion(t, h, "s2", unknown, "unknown")
	h.connectAfterQuestion(t, "s2", question)

	if got := readFile(t, extra); got != extraContent {
		t.Fatalf("extra known_hosts was modified: %q", got)
	}
	if strings.TrimSpace(readFile(t, own)) != unknown.knownHostsLine() {
		t.Fatalf("own known_hosts should hold the accepted key only")
	}
	if _, err := os.Stat(missingExtra); !os.IsNotExist(err) {
		t.Fatalf("missing extra file must not be created (stat err %v)", err)
	}
}

func TestAppendKeepsExistingLines(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	knownHostsFile := filepath.Join(t.TempDir(), "known_hosts")
	writeFile(t, knownHostsFile, knownhosts.Line([]string{"other.example"}, newHostKey(t).PublicKey()))
	h := startHelper(t, helperSetup{knownHostsFile: knownHostsFile})

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	question := expectHostKeyQuestion(t, h, "s1", srv, "app-01")
	h.connectAfterQuestion(t, "s1", question)

	lines := strings.Split(strings.TrimSpace(readFile(t, knownHostsFile)), "\n")
	if len(lines) != 2 || lines[1] != srv.knownHostsLine() {
		t.Fatalf("unexpected known_hosts lines %q", lines)
	}
}
