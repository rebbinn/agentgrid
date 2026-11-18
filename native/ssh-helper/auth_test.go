package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

const serverPassword = "correct-horse-7"

func expectPrompt(t *testing.T, h *helperUnderTest, sid, kind, host string) testEvent {
	t.Helper()
	event := h.expect(sid, "prompt")
	if event.str("kind") != kind || event.str("host") != host {
		t.Fatalf("got %s, want prompt %s for %s", event, kind, host)
	}
	if event.str("rid") == "" {
		t.Fatalf("prompt has no rid: %s", event)
	}
	return event
}

func promptQuestionsOf(t *testing.T, event testEvent) []map[string]any {
	t.Helper()
	raw, ok := event["questions"].([]any)
	if !ok {
		t.Fatalf("prompt has no questions: %s", event)
	}
	questions := make([]map[string]any, len(raw))
	for i, question := range raw {
		questions[i] = question.(map[string]any)
	}
	return questions
}

func TestStoredPasswordConnects(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	h.remember(serverPassword)

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

func TestWrongStoredPasswordIsPromptedAgain(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	h.remember(serverPassword, "stale-password")

	h.connect("s1", modeTest, passwordHost("app-01", srv, "stale-password"), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	prompt := expectPrompt(t, h, "s1", promptKindPassword, "app-01")
	questions := promptQuestionsOf(t, prompt)
	if len(questions) != 1 || questions[0]["echo"] != false || questions[0]["text"] == "" {
		t.Fatalf("unexpected password questions: %s", prompt)
	}
	h.answer("s1", prompt["rid"], map[string]any{"answers": []string{serverPassword}})
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

func TestThreeWrongPasswordsFailWithAuth(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	h.remember("bad-one", "bad-two", "bad-three")

	h.connect("s1", modeTest, passwordHost("app-01", srv, "bad-one"), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	for _, wrong := range []string{"bad-two", "bad-three"} {
		prompt := expectPrompt(t, h, "s1", promptKindPassword, "app-01")
		h.answer("s1", prompt["rid"], map[string]any{"answers": []string{wrong}})
	}
	h.expectFailed("s1", kindAuth, "app-01")
	if attempts := srv.passwordAttempts.Load(); attempts != 3 {
		t.Fatalf("server saw %d password attempts, want 3", attempts)
	}
}

func TestCancelledPasswordPromptStopsWithoutFurtherPrompts(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword, keyboardInteractive: passwordChallenge(serverPassword)})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	h.connect("s1", modeTest, passwordHost("app-01", srv, ""), nil)
	prompt := h.skipUntil("s1", "prompt")
	h.answer("s1", prompt["rid"], map[string]any{"cancel": true})
	event := h.next("s1", eventWait)
	if event.str("ev") != "failed" || event.str("kind") != kindCancelled {
		t.Fatalf("got %s, want failed cancelled", event)
	}
}

func TestChallengeAnswersStoredPasswordAndPromptsSecondFactor(t *testing.T) {
	srv := startServer(t, serverOptions{keyboardInteractive: passwordChallenge(serverPassword, "Verification code: ", "424242")})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	h.remember(serverPassword, "424242")

	h.connect("s1", modeTest, passwordHost("app-01", srv, serverPassword), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	prompt := expectPrompt(t, h, "s1", promptKindChallenge, "app-01")
	if prompt.str("name") != "Second factor" || prompt.str("instruction") != "Enter the code from your app" {
		t.Fatalf("challenge name/instruction not passed through: %s", prompt)
	}
	questions := promptQuestionsOf(t, prompt)
	if len(questions) != 1 || questions[0]["text"] != "Verification code: " || questions[0]["echo"] != true {
		t.Fatalf("unexpected challenge questions: %s", prompt)
	}
	h.answer("s1", prompt["rid"], map[string]any{"answers": []string{"424242"}})
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

func TestChallengeUsesStoredPasswordOnlyOnce(t *testing.T) {
	srv := startServer(t, serverOptions{keyboardInteractive: passwordChallenge(serverPassword)})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	h.remember(serverPassword, "stale-password")

	h.connect("s1", modeTest, passwordHost("app-01", srv, "stale-password"), nil)
	prompt := h.skipUntil("s1", "prompt")
	if prompt.str("kind") != promptKindChallenge {
		t.Fatalf("got %s, want keyboard-interactive prompt", prompt)
	}
	h.answer("s1", prompt["rid"], map[string]any{"answers": []string{serverPassword}})
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

func TestAnswerWithWrongCountIsIgnored(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	h.connect("s1", modeTest, passwordHost("app-01", srv, ""), nil)
	prompt := h.skipUntil("s1", "prompt")
	h.answer("s1", prompt["rid"], map[string]any{"answers": []string{"a", "b"}})
	h.expectQuiet("s1", 200*time.Millisecond)
	h.answer("s1", prompt["rid"], map[string]any{"answers": []string{serverPassword}})
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

type clientKey struct {
	path   string
	public ssh.PublicKey
}

func writeClientKey(t *testing.T, passphrase string) clientKey {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var block *pem.Block
	if passphrase == "" {
		block, err = ssh.MarshalPrivateKey(private, "test key")
	} else {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(private, "test key", []byte(passphrase))
	}
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "id_ed25519")
	writeFile(t, path, string(pem.EncodeToMemory(block)))
	sshPublic, err := ssh.NewPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	return clientKey{path: path, public: sshPublic}
}

func TestUnencryptedKeyConnects(t *testing.T) {
	key := writeClientKey(t, "")
	srv := startServer(t, serverOptions{authorizedKey: key.public})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	h.connect("s1", modeTest, keyHost("app-01", srv, key.path, ""), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

func TestEncryptedKeyUsesStoredPassphrase(t *testing.T) {
	key := writeClientKey(t, "key-pass-9")
	srv := startServer(t, serverOptions{authorizedKey: key.public})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	h.remember("key-pass-9")

	h.connect("s1", modeTest, keyHost("app-01", srv, key.path, "key-pass-9"), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

func TestEncryptedKeyWithoutPassphraseIsPrompted(t *testing.T) {
	key := writeClientKey(t, "key-pass-9")
	srv := startServer(t, serverOptions{authorizedKey: key.public})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	h.remember("key-pass-9", "not-the-pass")

	h.connect("s1", modeTest, keyHost("app-01", srv, key.path, ""), nil)
	h.expectPhase("s1", "connecting", "app-01")
	h.expectPhase("s1", "authenticating", "app-01")
	first := expectPrompt(t, h, "s1", promptKindPassphrase, "app-01")
	h.answer("s1", first["rid"], map[string]any{"answers": []string{"not-the-pass"}})
	second := expectPrompt(t, h, "s1", promptKindPassphrase, "app-01")
	if second.str("instruction") == "" {
		t.Fatalf("second passphrase prompt should explain the retry: %s", second)
	}
	h.answer("s1", second["rid"], map[string]any{"answers": []string{"key-pass-9"}})
	h.expect("s1", "connected")
	h.expectClosed("s1", reasonClosed)
}

func TestUnreadableKeyFailsWithKeyFile(t *testing.T) {
	key := writeClientKey(t, "")
	srv := startServer(t, serverOptions{authorizedKey: key.public, keyboardInteractive: passwordChallenge(serverPassword)})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	missing := filepath.Join(t.TempDir(), "no-such-key")
	h.connect("s1", modeTest, keyHost("app-01", srv, missing, ""), nil)
	h.expectFailed("s1", kindKeyFile, "app-01")
}

func TestGarbageKeyFailsWithKeyFile(t *testing.T) {
	key := writeClientKey(t, "")
	srv := startServer(t, serverOptions{authorizedKey: key.public})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	garbage := filepath.Join(t.TempDir(), "garbage")
	writeFile(t, garbage, "this is not a key")
	h.connect("s1", modeTest, keyHost("app-01", srv, garbage, ""), nil)
	h.expectFailed("s1", kindKeyFile, "app-01")
}
