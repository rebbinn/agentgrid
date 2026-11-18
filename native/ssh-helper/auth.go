package main

import (
	"crypto/x509"
	"errors"
	"io"
	"os"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

const maxAuthTries = 3

type legHandshake struct {
	session  *session
	spec     *hostSpec
	address  string
	watchdog *handshakeWatchdog
	known    *knownHostsSnapshot

	mu                         sync.Mutex
	failure                    *failure
	verifiedKey                ssh.PublicKey
	passwordAttempts           int
	storedPasswordUsedByPrompt bool
	keySigners                 []ssh.Signer
	agentConn                  io.Closer
}

func newLegHandshake(s *session, spec *hostSpec, address string, watchdog *handshakeWatchdog) *legHandshake {
	return &legHandshake{
		session:  s,
		spec:     spec,
		address:  address,
		watchdog: watchdog,
		known:    s.helper.knownHosts.load(),
	}
}

func (l *legHandshake) clientConfig() *ssh.ClientConfig {
	return &ssh.ClientConfig{
		User:              l.spec.Username,
		Auth:              l.authMethods(),
		AuthCallback:      l.stopAfterFailure,
		HostKeyCallback:   l.verifyHostKey,
		HostKeyAlgorithms: preferredHostKeyAlgorithms(l.known.knownKeyTypes(l.address)),
	}
}

func (l *legHandshake) authMethods() []ssh.AuthMethod {
	challenge := ssh.RetryableAuthMethod(ssh.KeyboardInteractive(l.answerChallenge), maxAuthTries)
	switch l.spec.Auth {
	case authKey:
		return []ssh.AuthMethod{ssh.PublicKeysCallback(l.loadKeySigners), challenge}
	case authAgent:
		return []ssh.AuthMethod{ssh.PublicKeysCallback(l.loadAgentSigners), challenge}
	default:
		return []ssh.AuthMethod{ssh.RetryableAuthMethod(ssh.PasswordCallback(l.nextPassword), maxAuthTries), challenge}
	}
}

func (l *legHandshake) release() {
	l.mu.Lock()
	conn := l.agentConn
	l.agentConn = nil
	l.mu.Unlock()
	if conn != nil {
		conn.Close()
	}
}

func (l *legHandshake) fail(f *failure) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.failure == nil {
		l.failure = f
	}
	return l.failure
}

func (l *legHandshake) recordedFailure() *failure {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.failure
}

// x/crypto keeps trying the remaining auth methods after a callback error; a cancelled
// prompt or a broken key file must end the handshake instead of asking again.
func (l *legHandshake) stopAfterFailure(*ssh.ClientAuthContext) (ssh.AuthMethod, error) {
	if f := l.recordedFailure(); f != nil {
		return nil, f
	}
	return nil, nil
}

func (l *legHandshake) failAfterQuestion(err error) error {
	message := "the user cancelled"
	if errors.Is(err, errSessionClosed) {
		message = "session closed before it was connected"
	}
	return l.fail(&failure{kind: kindCancelled, message: message, host: l.spec.displayName()})
}

func (l *legHandshake) askSecret(kind, name, instruction string, questions []promptQuestion) ([]string, error) {
	if f := l.recordedFailure(); f != nil {
		return nil, f
	}
	reply, err := l.session.ask(promptQuestions, len(questions), l.watchdog, func(rid string) any {
		return promptEvent{
			Ev:          "prompt",
			Sid:         l.session.id.raw,
			Rid:         rid,
			Host:        l.spec.displayName(),
			Kind:        kind,
			Name:        name,
			Instruction: instruction,
			Questions:   questions,
		}
	})
	if err != nil {
		return nil, l.failAfterQuestion(err)
	}
	return reply.answers, nil
}

func (l *legHandshake) nextPassword() (string, error) {
	l.mu.Lock()
	l.passwordAttempts++
	attempt := l.passwordAttempts
	l.mu.Unlock()

	if attempt == 1 && l.spec.Password != "" {
		return l.spec.Password, nil
	}
	instruction := ""
	if attempt > 1 {
		instruction = "Wrong password, try again."
	}
	answers, err := l.askSecret(promptKindPassword, "", instruction, []promptQuestion{{Text: "Password: ", Echo: false}})
	if err != nil {
		return "", err
	}
	return answers[0], nil
}

func (l *legHandshake) answerChallenge(name, instruction string, questions []string, echos []bool) ([]string, error) {
	if len(questions) == 0 {
		return []string{}, nil
	}
	if l.takeStoredPasswordFor(questions, echos) {
		return []string{l.spec.Password}, nil
	}
	prompts := make([]promptQuestion, len(questions))
	for i, text := range questions {
		prompts[i] = promptQuestion{Text: text, Echo: i < len(echos) && echos[i]}
	}
	return l.askSecret(promptKindChallenge, name, instruction, prompts)
}

func (l *legHandshake) takeStoredPasswordFor(questions []string, echos []bool) bool {
	if l.spec.Auth != authPassword || l.spec.Password == "" {
		return false
	}
	if len(questions) != 1 || len(echos) != 1 || echos[0] {
		return false
	}
	if !strings.Contains(strings.ToLower(questions[0]), "password") {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.storedPasswordUsedByPrompt {
		return false
	}
	l.storedPasswordUsedByPrompt = true
	return true
}

func (l *legHandshake) loadKeySigners() ([]ssh.Signer, error) {
	l.mu.Lock()
	cached := l.keySigners
	l.mu.Unlock()
	if cached != nil {
		return cached, nil
	}

	host := l.spec.displayName()
	pemBytes, err := os.ReadFile(l.spec.KeyPath)
	if err != nil {
		return nil, l.fail(&failure{kind: kindKeyFile, message: "cannot read key file " + l.spec.KeyPath + ": " + describeFileError(err), host: host})
	}
	signer, err := ssh.ParsePrivateKey(pemBytes)
	var missingPassphrase *ssh.PassphraseMissingError
	switch {
	case err == nil:
	case errors.As(err, &missingPassphrase):
		signer, err = l.decryptKey(pemBytes)
		if err != nil {
			return nil, err
		}
	default:
		return nil, l.fail(&failure{kind: kindKeyFile, message: "cannot parse key file " + l.spec.KeyPath + ": " + err.Error(), host: host})
	}

	signers := []ssh.Signer{signer}
	l.mu.Lock()
	l.keySigners = signers
	l.mu.Unlock()
	return signers, nil
}

func (l *legHandshake) decryptKey(pemBytes []byte) (ssh.Signer, error) {
	host := l.spec.displayName()
	question := []promptQuestion{{Text: "Passphrase for " + l.spec.KeyPath + ": ", Echo: false}}
	for attempt := 1; attempt <= maxAuthTries; attempt++ {
		var passphrase string
		if attempt == 1 && l.spec.Passphrase != "" {
			passphrase = l.spec.Passphrase
		} else {
			instruction := ""
			if attempt > 1 {
				instruction = "Wrong passphrase, try again."
			}
			answers, err := l.askSecret(promptKindPassphrase, "", instruction, question)
			if err != nil {
				return nil, err
			}
			passphrase = answers[0]
		}
		signer, err := ssh.ParsePrivateKeyWithPassphrase(pemBytes, []byte(passphrase))
		if err == nil {
			return signer, nil
		}
		if !errors.Is(err, x509.IncorrectPasswordError) {
			return nil, l.fail(&failure{kind: kindKeyFile, message: "cannot decrypt key file " + l.spec.KeyPath + ": " + err.Error(), host: host})
		}
	}
	return nil, l.fail(&failure{kind: kindAuth, message: "wrong passphrase for key file " + l.spec.KeyPath, host: host})
}

func (l *legHandshake) loadAgentSigners() ([]ssh.Signer, error) {
	conn, err := dialAgent()
	if err != nil {
		return nil, l.fail(&failure{kind: kindAgentMissing, message: "SSH agent is not reachable at " + agentLocation(), host: l.spec.displayName()})
	}
	l.mu.Lock()
	l.agentConn = conn
	l.mu.Unlock()
	signers, err := agent.NewClient(conn).Signers()
	if err != nil {
		return nil, l.fail(&failure{kind: kindAgentMissing, message: "SSH agent did not list its keys: " + err.Error(), host: l.spec.displayName()})
	}
	return signers, nil
}

func describeFileError(err error) string {
	var pathErr *os.PathError
	if errors.As(err, &pathErr) {
		return pathErr.Err.Error()
	}
	return err.Error()
}
