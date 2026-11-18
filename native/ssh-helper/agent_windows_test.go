//go:build windows

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

func agentHost(label string, srv *testServer) map[string]any {
	return map[string]any{"label": label, "address": "127.0.0.1", "port": srv.port, "username": testUser, "auth": "agent"}
}

func useAgentPipe(t *testing.T, path string) {
	t.Helper()
	previous := agentPipePath
	agentPipePath = path
	t.Cleanup(func() { agentPipePath = previous })
}

func testPipeName(purpose string) string {
	return fmt.Sprintf(`\\.\pipe\agentgrid-ssh-test-%s-%d`, purpose, time.Now().UnixNano())
}

func TestAgentUnavailableFails(t *testing.T) {
	useAgentPipe(t, testPipeName("missing"))
	overrideDuration(t, &agentDialTimeout, 200*time.Millisecond)
	srv := startServer(t, serverOptions{authorizedKey: newHostKey(t).PublicKey(), keyboardInteractive: passwordChallenge(serverPassword)})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	h.connect("s1", modeTest, agentHost("app-01", srv), nil)
	h.expectFailed("s1", kindAgentMissing, "app-01")
}

func TestAgentKeyConnects(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keyring := agent.NewKeyring()
	if err := keyring.Add(agent.AddedKey{PrivateKey: private}); err != nil {
		t.Fatal(err)
	}
	pipe := testPipeName("agent")
	listener, err := winio.ListenPipe(pipe, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				agent.ServeAgent(keyring, conn)
			}()
		}
	}()
	useAgentPipe(t, pipe)

	sshPublic, err := ssh.NewPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	srv := startServer(t, serverOptions{authorizedKey: sshPublic})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	h.connect("s1", modeTest, agentHost("app-01", srv), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}
