package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
)

const (
	protocolVersion     = 1
	maxCommandLineBytes = 16 << 20
	outputChunkBytes    = 32 << 10
	defaultSSHPort      = 22
	defaultCols         = 80
	defaultRows         = 24
)

const (
	modeShell = "shell"
	modeTest  = "test"

	authPassword = "password"
	authKey      = "key"
	authAgent    = "agent"
)

const (
	kindDNS             = "dns"
	kindRefused         = "refused"
	kindTimeout         = "timeout"
	kindUnreachable     = "unreachable"
	kindAuth            = "auth"
	kindHostKeyChanged  = "hostkey-changed"
	kindHostKeyRejected = "hostkey-rejected"
	kindCancelled       = "cancelled"
	kindKeyFile         = "key-file"
	kindAgentMissing    = "agent-unavailable"
	kindJump            = "jump"
	kindOther           = "other"
)

const (
	reasonExit   = "exit"
	reasonLost   = "lost"
	reasonClosed = "closed"
)

const (
	promptKindPassword   = "password"
	promptKindPassphrase = "passphrase"
	promptKindChallenge  = "keyboard-interactive"
)

type hostSpec struct {
	Label      string `json:"label"`
	Address    string `json:"address"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Auth       string `json:"auth"`
	Password   string `json:"password"`
	KeyPath    string `json:"keyPath"`
	Passphrase string `json:"passphrase"`
}

func (h *hostSpec) displayName() string {
	if h.Label != "" {
		return h.Label
	}
	return h.Address
}

func (h *hostSpec) dialAddress() string {
	port := h.Port
	if port == 0 {
		port = defaultSSHPort
	}
	return net.JoinHostPort(h.Address, strconv.Itoa(port))
}

type command struct {
	Op         string          `json:"op"`
	Sid        json.RawMessage `json:"sid"`
	Mode       json.RawMessage `json:"mode"`
	Target     *hostSpec       `json:"target"`
	Jump       *hostSpec       `json:"jump"`
	Via        json.RawMessage `json:"via"`
	Cols       int             `json:"cols"`
	Rows       int             `json:"rows"`
	Data       string          `json:"data"`
	Rid        json.RawMessage `json:"rid"`
	Accept     *bool           `json:"accept"`
	Answers    []string        `json:"answers"`
	Cancel     bool            `json:"cancel"`
	Path       string          `json:"path"`
	From       string          `json:"from"`
	To         string          `json:"to"`
	Recursive  bool            `json:"recursive"`
	Tid        json.RawMessage `json:"tid"`
	LocalPath  string          `json:"localPath"`
	RemotePath string          `json:"remotePath"`
	Overwrite  bool            `json:"overwrite"`
}

func (c *command) modeName() string {
	value, _ := decodeScalar(c.Mode)
	name, _ := value.(string)
	return name
}

func (c *command) permissionBits() (uint32, bool) {
	value, _ := decodeScalar(c.Mode)
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	bits, err := strconv.ParseUint(number.String(), 10, 32)
	if err != nil || bits > 0o7777 {
		return 0, false
	}
	return uint32(bits), true
}

func (c *command) hasVia() bool {
	value, ok := decodeScalar(c.Via)
	return ok && value != nil
}

type opaqueID struct {
	key string
	raw json.RawMessage
}

func parseOpaqueID(raw json.RawMessage) (opaqueID, bool) {
	value, ok := decodeScalar(raw)
	if !ok {
		return opaqueID{}, false
	}
	switch v := value.(type) {
	case string:
		if v == "" {
			return opaqueID{}, false
		}
		encoded, _ := json.Marshal(v)
		return opaqueID{key: "s:" + v, raw: encoded}, true
	case json.Number:
		return opaqueID{key: "n:" + v.String(), raw: json.RawMessage(v.String())}, true
	}
	return opaqueID{}, false
}

func parseQuestionID(raw json.RawMessage) (string, bool) {
	value, ok := decodeScalar(raw)
	if !ok {
		return "", false
	}
	switch v := value.(type) {
	case string:
		return v, true
	case json.Number:
		return v.String(), true
	}
	return "", false
}

func decodeScalar(raw json.RawMessage) (any, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, false
	}
	return value, true
}

func decodeInputData(encoded string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err == nil {
		return data, nil
	}
	return base64.RawStdEncoding.DecodeString(encoded)
}

type readyEvent struct {
	Ev      string `json:"ev"`
	Version int    `json:"version"`
}

type phaseEvent struct {
	Ev    string          `json:"ev"`
	Sid   json.RawMessage `json:"sid"`
	Phase string          `json:"phase"`
	Host  string          `json:"host"`
}

type hostKeyEvent struct {
	Ev          string          `json:"ev"`
	Sid         json.RawMessage `json:"sid"`
	Rid         string          `json:"rid"`
	Host        string          `json:"host"`
	Address     string          `json:"address"`
	KeyType     string          `json:"keyType"`
	Fingerprint string          `json:"fingerprint"`
}

type promptQuestion struct {
	Text string `json:"text"`
	Echo bool   `json:"echo"`
}

type promptEvent struct {
	Ev          string           `json:"ev"`
	Sid         json.RawMessage  `json:"sid"`
	Rid         string           `json:"rid"`
	Host        string           `json:"host"`
	Kind        string           `json:"kind"`
	Name        string           `json:"name"`
	Instruction string           `json:"instruction"`
	Questions   []promptQuestion `json:"questions"`
}

type connectedEvent struct {
	Ev  string          `json:"ev"`
	Sid json.RawMessage `json:"sid"`
}

type dataEvent struct {
	Ev   string          `json:"ev"`
	Sid  json.RawMessage `json:"sid"`
	Data []byte          `json:"data"`
}

type latencyEvent struct {
	Ev  string          `json:"ev"`
	Sid json.RawMessage `json:"sid"`
	Ms  int64           `json:"ms"`
}

type failedEvent struct {
	Ev             string          `json:"ev"`
	Sid            json.RawMessage `json:"sid"`
	Kind           string          `json:"kind"`
	Message        string          `json:"message"`
	Host           string          `json:"host"`
	Fingerprint    string          `json:"fingerprint,omitempty"`
	KnownHostsFile string          `json:"knownHostsFile,omitempty"`
}

type closedEvent struct {
	Ev         string          `json:"ev"`
	Sid        json.RawMessage `json:"sid"`
	Reason     string          `json:"reason"`
	ExitStatus *int            `json:"exitStatus,omitempty"`
}

type failure struct {
	kind           string
	message        string
	host           string
	fingerprint    string
	knownHostsFile string
}

func (f *failure) Error() string {
	return f.kind + ": " + f.message
}

type sftpReadyEvent struct {
	Ev   string          `json:"ev"`
	Sid  json.RawMessage `json:"sid"`
	Home string          `json:"home"`
}

type sftpError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type sftpEntry struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Size       int64  `json:"size"`
	Mtime      int64  `json:"mtime"`
	Mode       uint32 `json:"mode"`
	Target     string `json:"target,omitempty"`
	TargetKind string `json:"targetKind,omitempty"`
}

type sftpReplyEvent struct {
	Ev      string          `json:"ev"`
	Sid     json.RawMessage `json:"sid"`
	Rid     json.RawMessage `json:"rid"`
	Ok      bool            `json:"ok"`
	Path    string          `json:"path,omitempty"`
	Entries *[]sftpEntry    `json:"entries,omitempty"`
	Error   *sftpError      `json:"error,omitempty"`
}

type transferEvent struct {
	Ev         string          `json:"ev"`
	Sid        json.RawMessage `json:"sid"`
	Tid        json.RawMessage `json:"tid"`
	Bytes      int64           `json:"bytes"`
	Total      int64           `json:"total"`
	Files      int             `json:"files"`
	FilesTotal int             `json:"filesTotal"`
	Current    string          `json:"current"`
}

type transferDoneEvent struct {
	Ev    string          `json:"ev"`
	Sid   json.RawMessage `json:"sid"`
	Tid   json.RawMessage `json:"tid"`
	Ok    bool            `json:"ok"`
	Error *sftpError      `json:"error,omitempty"`
}

func failedEventFor(id opaqueID, f *failure) failedEvent {
	return failedEvent{
		Ev:             "failed",
		Sid:            id.raw,
		Kind:           f.kind,
		Message:        f.message,
		Host:           f.host,
		Fingerprint:    f.fingerprint,
		KnownHostsFile: f.knownHostsFile,
	}
}

func closedEventFor(id opaqueID, reason string, exitStatus *int) closedEvent {
	return closedEvent{Ev: "closed", Sid: id.raw, Reason: reason, ExitStatus: exitStatus}
}

type eventWriter struct {
	mu     sync.Mutex
	out    io.Writer
	diag   *log.Logger
	broken bool
}

func (w *eventWriter) emit(event any) {
	line, err := json.Marshal(event)
	if err != nil {
		w.diag.Printf("cannot encode %T event: %v", event, err)
		return
	}
	line = append(line, '\n')
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, err := w.out.Write(line); err != nil && !w.broken {
		w.broken = true
		w.diag.Printf("cannot write events to stdout: %v", err)
	}
}

var utf8ByteOrderMark = []byte{0xEF, 0xBB, 0xBF}

func readCommandLines(in io.Reader, handle func([]byte), diag *log.Logger) error {
	reader := bufio.NewReaderSize(in, 64<<10)
	var line []byte
	discarding := false
	for {
		chunk, err := reader.ReadSlice('\n')
		if !discarding {
			if len(line)+len(chunk) > maxCommandLineBytes {
				diag.Printf("ignoring command line longer than %d bytes", maxCommandLineBytes)
				discarding = true
				line = nil
			} else {
				line = append(line, chunk...)
			}
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		lineEnded := err == nil || (errors.Is(err, io.EOF) && len(line) > 0)
		if lineEnded {
			if !discarding {
				handle(bytes.TrimPrefix(bytes.TrimRight(line, "\r\n"), utf8ByteOrderMark))
			}
			discarding = false
			if cap(line) > 1<<20 {
				line = nil
			} else {
				line = line[:0]
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}

func describeDecodeError(err error) string {
	var syntaxErr *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	switch {
	case errors.As(err, &syntaxErr):
		return fmt.Sprintf("invalid JSON at offset %d", syntaxErr.Offset)
	case errors.As(err, &typeErr):
		valueKind, _, _ := strings.Cut(typeErr.Value, " ")
		return fmt.Sprintf("field %q must be %s, got %s", typeErr.Field, typeErr.Type, valueKind)
	}
	return "invalid JSON"
}
