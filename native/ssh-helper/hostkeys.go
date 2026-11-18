package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"io/fs"
	"log"
	"net"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type knownHosts struct {
	ownFile    string
	extraFiles []string
	diag       *log.Logger
	appendMu   sync.Mutex
}

type knownHostsFile struct {
	path  string
	check ssh.HostKeyCallback
}

type knownHostsSnapshot struct {
	files []knownHostsFile
}

type hostKeyStatus int

const (
	hostKeyUnknown hostKeyStatus = iota
	hostKeyKnown
	hostKeyChanged
	hostKeyRevoked
)

type hostKeyVerdict struct {
	status hostKeyStatus
	file   string
}

var unspecifiedRemote net.Addr = &net.TCPAddr{IP: net.IPv4zero}

func (k *knownHosts) load() *knownHostsSnapshot {
	snapshot := &knownHostsSnapshot{}
	paths := append([]string{k.ownFile}, k.extraFiles...)
	for _, path := range paths {
		if path == "" {
			continue
		}
		check, err := knownhosts.New(path)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				k.diag.Printf("skipping known_hosts file %s: %v", path, err)
			}
			continue
		}
		snapshot.files = append(snapshot.files, knownHostsFile{path: path, check: check})
	}
	return snapshot
}

func (k *knownHosts) remember(address string, key ssh.PublicKey) error {
	k.appendMu.Lock()
	defer k.appendMu.Unlock()
	if err := os.MkdirAll(filepath.Dir(k.ownFile), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(k.ownFile, os.O_RDWR|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	entry := knownhosts.Line([]string{address}, key) + "\n"
	if endsWithoutNewline(file) {
		entry = "\n" + entry
	}
	_, err = file.WriteString(entry)
	return err
}

func endsWithoutNewline(file *os.File) bool {
	info, err := file.Stat()
	if err != nil || info.Size() == 0 {
		return false
	}
	last := make([]byte, 1)
	if _, err := file.ReadAt(last, info.Size()-1); err != nil {
		return false
	}
	return last[0] != '\n'
}

func (snap *knownHostsSnapshot) verdict(address string, remote net.Addr, key ssh.PublicKey) hostKeyVerdict {
	result := hostKeyVerdict{status: hostKeyUnknown}
	for _, f := range snap.files {
		err := f.check(address, remote, key)
		var keyErr *knownhosts.KeyError
		var revokedErr *knownhosts.RevokedError
		switch {
		case err == nil:
			if result.status != hostKeyRevoked {
				result = hostKeyVerdict{status: hostKeyKnown}
			}
		case errors.As(err, &revokedErr):
			result = hostKeyVerdict{status: hostKeyRevoked, file: revokedErr.Revoked.Filename}
		case errors.As(err, &keyErr):
			if result.status != hostKeyUnknown {
				continue
			}
			for _, want := range keyErr.Want {
				if want.Key.Type() == key.Type() {
					result = hostKeyVerdict{status: hostKeyChanged, file: want.Filename}
					break
				}
			}
		}
	}
	return result
}

var probeKey = sync.OnceValue(func() ssh.PublicKey {
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil
	}
	key, err := ssh.NewPublicKey(public)
	if err != nil {
		return nil
	}
	return key
})

func (snap *knownHostsSnapshot) knownKeyTypes(address string) []string {
	probe := probeKey()
	if probe == nil {
		return nil
	}
	var types []string
	for _, f := range snap.files {
		var keyErr *knownhosts.KeyError
		if !errors.As(f.check(address, unspecifiedRemote, probe), &keyErr) {
			continue
		}
		for _, want := range keyErr.Want {
			if !slices.Contains(types, want.Key.Type()) {
				types = append(types, want.Key.Type())
			}
		}
	}
	return types
}

// Without this, x/crypto may negotiate a key type that is not in known_hosts yet
// (it prefers ECDSA, OpenSSH records ed25519) and the user is asked again for a known host.
func preferredHostKeyAlgorithms(knownTypes []string) []string {
	if len(knownTypes) == 0 {
		return nil
	}
	var preferred, others []string
	all := append(ssh.SupportedAlgorithms().HostKeys, ssh.InsecureAlgorithms().HostKeys...)
	for _, algorithm := range all {
		if slices.Contains(knownTypes, keyTypeOfAlgorithm(algorithm)) {
			preferred = append(preferred, algorithm)
		} else {
			others = append(others, algorithm)
		}
	}
	return append(preferred, others...)
}

func keyTypeOfAlgorithm(algorithm string) string {
	switch algorithm {
	case ssh.KeyAlgoRSASHA256, ssh.KeyAlgoRSASHA512:
		return ssh.KeyAlgoRSA
	}
	return algorithm
}

func (l *legHandshake) verifyHostKey(hostname string, remote net.Addr, key ssh.PublicKey) error {
	l.mu.Lock()
	verified := l.verifiedKey
	l.mu.Unlock()
	if verified != nil {
		if bytes.Equal(verified.Marshal(), key.Marshal()) {
			return nil
		}
		return errors.New("host key changed during the connection")
	}

	presented := key
	verdict := l.known.verdict(hostname, remote, presented)
	if cert, isCert := key.(*ssh.Certificate); isCert && verdict.status != hostKeyKnown {
		presented = cert.Key
		verdict = l.known.verdict(hostname, remote, presented)
	}

	host := l.spec.displayName()
	knownAddress := knownhosts.Normalize(hostname)
	fingerprint := ssh.FingerprintSHA256(presented)
	switch verdict.status {
	case hostKeyKnown:
	case hostKeyChanged:
		return l.fail(&failure{
			kind:           kindHostKeyChanged,
			message:        "the host key for " + knownAddress + " has changed",
			host:           host,
			fingerprint:    fingerprint,
			knownHostsFile: verdict.file,
		})
	case hostKeyRevoked:
		return l.fail(&failure{
			kind:           kindHostKeyRejected,
			message:        "the host key for " + knownAddress + " is marked as revoked in " + verdict.file,
			host:           host,
			fingerprint:    fingerprint,
			knownHostsFile: verdict.file,
		})
	default:
		if err := l.confirmUnknownHostKey(knownAddress, presented, fingerprint); err != nil {
			return err
		}
	}

	l.mu.Lock()
	l.verifiedKey = key
	l.mu.Unlock()
	l.session.emitPhase("authenticating", host)
	return nil
}

func (l *legHandshake) confirmUnknownHostKey(knownAddress string, key ssh.PublicKey, fingerprint string) error {
	host := l.spec.displayName()
	reply, err := l.session.ask(hostKeyQuestion, 0, l.watchdog, func(rid string) any {
		return hostKeyEvent{
			Ev:          "hostkey",
			Sid:         l.session.id.raw,
			Rid:         rid,
			Host:        host,
			Address:     knownAddress,
			KeyType:     key.Type(),
			Fingerprint: fingerprint,
		}
	})
	if errors.Is(err, errSessionClosed) {
		return l.failAfterQuestion(err)
	}
	if err != nil || !reply.accept {
		return l.fail(&failure{
			kind:        kindHostKeyRejected,
			message:     "the host key for " + knownAddress + " was not accepted",
			host:        host,
			fingerprint: fingerprint,
		})
	}
	if err := l.session.helper.knownHosts.remember(l.address, key); err != nil {
		l.session.helper.diag.Printf("could not save the host key for %s: %v", knownAddress, err)
	}
	return nil
}
