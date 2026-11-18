package main

import (
	"net"
	"testing"
)

func TestJumpHostReachesTarget(t *testing.T) {
	target := startServer(t, serverOptions{password: serverPassword})
	bastion := startServer(t, serverOptions{password: "bastion-pass", directTCPIP: true})
	h := startHelper(t, helperSetup{trusted: []*testServer{target, bastion}})
	h.remember(serverPassword, "bastion-pass")

	h.connect("s1", modeShell, passwordHost("target", target, serverPassword), passwordHost("bastion", bastion, "bastion-pass"))
	h.expectPhase("s1", "connecting", "bastion")
	h.expectPhase("s1", "authenticating", "bastion")
	h.expectPhase("s1", "connecting", "target")
	h.expectPhase("s1", "authenticating", "target")
	h.expect("s1", "connected")

	h.input("s1", "through the bastion\n")
	h.readOutputUntil("s1", "through the bastion\n")
	h.input("s1", "exit 3\n")
	closed := h.expectClosed("s1", reasonExit)
	if status, _ := closed.num("exitStatus"); status != 3 {
		t.Fatalf("closed event %s, want exitStatus 3", closed)
	}
	if target.handshakes.Load() != 1 || bastion.handshakes.Load() != 1 {
		t.Fatalf("handshakes target=%d bastion=%d, want 1 each", target.handshakes.Load(), bastion.handshakes.Load())
	}
}

func TestJumpHostQuestionsUseTheJumpLabel(t *testing.T) {
	target := startServer(t, serverOptions{password: serverPassword})
	bastion := startServer(t, serverOptions{password: "bastion-pass", directTCPIP: true})
	h := startHelper(t, helperSetup{trusted: []*testServer{target}})

	h.connect("s1", modeTest, passwordHost("target", target, serverPassword), passwordHost("bastion", bastion, ""))
	question := expectHostKeyQuestion(t, h, "s1", bastion, "bastion")
	h.answer("s1", question["rid"], map[string]any{"accept": true})
	h.expectPhase("s1", "authenticating", "bastion")
	prompt := expectPrompt(t, h, "s1", promptKindPassword, "bastion")
	h.answer("s1", prompt["rid"], map[string]any{"cancel": true})
	h.expectFailed("s1", kindCancelled, "bastion")
	if target.handshakes.Load() != 0 {
		t.Fatal("target must not be contacted when the jump leg fails")
	}
}

func TestJumpHostFailuresKeepTheirKind(t *testing.T) {
	target := startServer(t, serverOptions{password: serverPassword})
	bastion := startServer(t, serverOptions{password: "bastion-pass"})
	h := startHelper(t, helperSetup{trusted: []*testServer{target, bastion}})

	h.connect("s1", modeTest, passwordHost("target", target, serverPassword), passwordHost("bastion", bastion, "wrong"))
	prompt := h.skipUntil("s1", "prompt")
	if prompt.str("host") != "bastion" {
		t.Fatalf("prompt should be for the jump host: %s", prompt)
	}
	h.answer("s1", prompt["rid"], map[string]any{"answers": []string{"still-wrong"}})
	prompt = h.expect("s1", "prompt")
	h.answer("s1", prompt["rid"], map[string]any{"answers": []string{"wrong-again"}})
	h.expectFailed("s1", kindAuth, "bastion")

	h.connect("s2", modeTest, passwordHost("target", target, serverPassword), passwordHost("bastion", bastion, "bastion-pass"))
	h.expectPhase("s2", "connecting", "bastion")
	h.expectPhase("s2", "authenticating", "bastion")
	h.expectPhase("s2", "connecting", "target")
	failed := h.expectFailed("s2", kindJump, "target")
	if failed.str("message") == "" {
		t.Fatalf("jump failure needs a message: %s", failed)
	}
}

func TestJumpHostTargetRefused(t *testing.T) {
	bastion := startServer(t, serverOptions{password: "bastion-pass", directTCPIP: true})
	h := startHelper(t, helperSetup{trusted: []*testServer{bastion}})

	closedPort := unusedPort(t)
	target := map[string]any{"label": "target", "address": "127.0.0.1", "port": closedPort, "username": testUser, "auth": "password", "password": serverPassword}
	h.connect("s1", modeTest, target, passwordHost("bastion", bastion, "bastion-pass"))
	h.expectFailed("s1", kindRefused, "target")
}

func unusedPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	return port
}
