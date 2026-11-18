package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

const testUser = "tester"

type serverOptions struct {
	password            string
	keyboardInteractive func(ssh.ConnMetadata, ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error)
	authorizedKey       ssh.PublicKey
	directTCPIP         bool
	keepaliveReplies    int
	extraHostKeys       []ssh.Signer
	files               *virtualFS
}

type ptyRequest struct {
	term       string
	cols, rows int
	echo       bool
}

type windowChange struct {
	cols, rows int
}

type testServer struct {
	t        *testing.T
	opts     serverOptions
	listener net.Listener
	addr     string
	port     int
	hostKey  ssh.Signer
	config   *ssh.ServerConfig

	passwordAttempts atomic.Int32
	keepalivesSeen   atomic.Int32
	floodWritten     atomic.Int64
	ptyRequests      chan ptyRequest
	windowChanges    chan windowChange
	connectionsEnded chan struct{}
	handshakes       atomic.Int32

	connsMu sync.Mutex
	conns   []*ssh.ServerConn
}

func (srv *testServer) dropConnections() {
	srv.connsMu.Lock()
	conns := srv.conns
	srv.conns = nil
	srv.connsMu.Unlock()
	for _, conn := range conns {
		conn.Close()
	}
}

func newHostKey(t *testing.T) ssh.Signer {
	t.Helper()
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	return signer
}

func startServer(t *testing.T, opts serverOptions) *testServer {
	t.Helper()
	if opts.keepaliveReplies == 0 {
		opts.keepaliveReplies = -1
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &testServer{
		t:                t,
		opts:             opts,
		listener:         listener,
		addr:             listener.Addr().String(),
		port:             listener.Addr().(*net.TCPAddr).Port,
		hostKey:          newHostKey(t),
		ptyRequests:      make(chan ptyRequest, 16),
		windowChanges:    make(chan windowChange, 16),
		connectionsEnded: make(chan struct{}, 16),
	}
	srv.config = srv.buildConfig()
	go srv.acceptLoop()
	t.Cleanup(func() {
		listener.Close()
	})
	return srv
}

func (srv *testServer) buildConfig() *ssh.ServerConfig {
	config := &ssh.ServerConfig{}
	config.AddHostKey(srv.hostKey)
	for _, extra := range srv.opts.extraHostKeys {
		config.AddHostKey(extra)
	}
	if srv.opts.password != "" {
		config.PasswordCallback = func(meta ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			srv.passwordAttempts.Add(1)
			if meta.User() == testUser && string(password) == srv.opts.password {
				return &ssh.Permissions{}, nil
			}
			return nil, fmt.Errorf("wrong password")
		}
	}
	if srv.opts.keyboardInteractive != nil {
		config.KeyboardInteractiveCallback = srv.opts.keyboardInteractive
	}
	if srv.opts.authorizedKey != nil {
		authorized := srv.opts.authorizedKey.Marshal()
		config.PublicKeyCallback = func(meta ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if meta.User() == testUser && bytes.Equal(key.Marshal(), authorized) {
				return &ssh.Permissions{}, nil
			}
			return nil, fmt.Errorf("unknown key")
		}
	}
	return config
}

func (srv *testServer) knownHostsLine() string {
	return knownhosts.Line([]string{srv.addr}, srv.hostKey.PublicKey())
}

func (srv *testServer) acceptLoop() {
	for {
		conn, err := srv.listener.Accept()
		if err != nil {
			return
		}
		go srv.serve(conn)
	}
}

func (srv *testServer) serve(conn net.Conn) {
	defer func() {
		select {
		case srv.connectionsEnded <- struct{}{}:
		default:
		}
	}()
	serverConn, channels, requests, err := ssh.NewServerConn(conn, srv.config)
	if err != nil {
		conn.Close()
		return
	}
	srv.handshakes.Add(1)
	srv.connsMu.Lock()
	srv.conns = append(srv.conns, serverConn)
	srv.connsMu.Unlock()
	defer serverConn.Close()
	go srv.answerGlobalRequests(requests)
	for newChannel := range channels {
		switch newChannel.ChannelType() {
		case "session":
			go srv.serveSession(newChannel)
		case "direct-tcpip":
			if srv.opts.directTCPIP {
				go srv.forward(newChannel)
			} else {
				newChannel.Reject(ssh.Prohibited, "forwarding disabled")
			}
		default:
			newChannel.Reject(ssh.UnknownChannelType, "unsupported")
		}
	}
}

func (srv *testServer) answerGlobalRequests(requests <-chan *ssh.Request) {
	replied := 0
	for request := range requests {
		if request.Type == keepaliveRequest {
			srv.keepalivesSeen.Add(1)
			if srv.opts.keepaliveReplies >= 0 && replied >= srv.opts.keepaliveReplies {
				continue
			}
			replied++
		}
		if request.WantReply {
			request.Reply(false, nil)
		}
	}
}

func (srv *testServer) serveSession(newChannel ssh.NewChannel) {
	channel, requests, err := newChannel.Accept()
	if err != nil {
		return
	}
	for request := range requests {
		switch request.Type {
		case "pty-req":
			var payload struct {
				Term          string
				Columns, Rows uint32
				Width, Height uint32
				Modes         string
			}
			ssh.Unmarshal(request.Payload, &payload)
			srv.ptyRequests <- ptyRequest{
				term: payload.Term,
				cols: int(payload.Columns),
				rows: int(payload.Rows),
				echo: modesEnableEcho([]byte(payload.Modes)),
			}
			request.Reply(true, nil)
		case "window-change":
			var payload struct {
				Columns, Rows uint32
				Width, Height uint32
			}
			ssh.Unmarshal(request.Payload, &payload)
			srv.windowChanges <- windowChange{cols: int(payload.Columns), rows: int(payload.Rows)}
			if request.WantReply {
				request.Reply(true, nil)
			}
		case "shell":
			request.Reply(true, nil)
			go srv.runFakeShell(channel)
		case "subsystem":
			var payload struct{ Name string }
			ssh.Unmarshal(request.Payload, &payload)
			if payload.Name != "sftp" || srv.opts.files == nil {
				request.Reply(false, nil)
				continue
			}
			request.Reply(true, nil)
			go func() {
				server := sftp.NewRequestServer(channel, srv.opts.files.handlers(), sftp.WithStartDirectory(testHome))
				server.Serve()
				channel.Close()
			}()
		default:
			if request.WantReply {
				request.Reply(false, nil)
			}
		}
	}
}

func modesEnableEcho(modes []byte) bool {
	for len(modes) >= 5 {
		opcode := modes[0]
		if opcode == 0 {
			return false
		}
		value := uint32(modes[1])<<24 | uint32(modes[2])<<16 | uint32(modes[3])<<8 | uint32(modes[4])
		if opcode == ssh.ECHO {
			return value == 1
		}
		modes = modes[5:]
	}
	return false
}

func (srv *testServer) runFakeShell(channel ssh.Channel) {
	defer channel.Close()
	buffer := make([]byte, 4096)
	var pending []byte
	for {
		n, err := channel.Read(buffer)
		if n > 0 {
			channel.Write(buffer[:n])
			pending = append(pending, buffer[:n]...)
			for {
				end := bytes.IndexAny(pending, "\r\n")
				if end < 0 {
					break
				}
				line := strings.TrimSpace(string(pending[:end]))
				pending = pending[end+1:]
				if srv.runShellLine(channel, line) {
					return
				}
			}
		}
		if err != nil {
			return
		}
	}
}

func (srv *testServer) runShellLine(channel ssh.Channel, line string) (exited bool) {
	fields := strings.Fields(line)
	if len(fields) != 2 {
		return false
	}
	count, err := strconv.Atoi(fields[1])
	if err != nil {
		return false
	}
	switch fields[0] {
	case "exit":
		channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{uint32(count)}))
		return true
	case "flood":
		srv.flood(channel, count)
	}
	return false
}

func floodLine(i int) string {
	return fmt.Sprintf("line-%06d\n", i)
}

func (srv *testServer) flood(channel io.Writer, lines int) {
	var chunk bytes.Buffer
	for i := 0; i < lines; i++ {
		chunk.WriteString(floodLine(i))
		if chunk.Len() >= 16<<10 || i == lines-1 {
			n, err := channel.Write(chunk.Bytes())
			srv.floodWritten.Add(int64(n))
			if err != nil {
				return
			}
			chunk.Reset()
		}
	}
}

func (srv *testServer) forward(newChannel ssh.NewChannel) {
	var payload struct {
		Host       string
		Port       uint32
		OriginHost string
		OriginPort uint32
	}
	if err := ssh.Unmarshal(newChannel.ExtraData(), &payload); err != nil {
		newChannel.Reject(ssh.ConnectionFailed, "bad payload")
		return
	}
	target, err := net.Dial("tcp", net.JoinHostPort(payload.Host, strconv.Itoa(int(payload.Port))))
	if err != nil {
		newChannel.Reject(ssh.ConnectionFailed, "Connection refused")
		return
	}
	channel, requests, err := newChannel.Accept()
	if err != nil {
		target.Close()
		return
	}
	go ssh.DiscardRequests(requests)
	var copies sync.WaitGroup
	copies.Go(func() {
		io.Copy(target, channel)
		target.Close()
	})
	copies.Go(func() {
		io.Copy(channel, target)
		channel.Close()
	})
	copies.Wait()
}

func passwordChallenge(password string, extra ...string) func(ssh.ConnMetadata, ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
	return func(meta ssh.ConnMetadata, client ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
		answers, err := client("", "", []string{"Password: "}, []bool{false})
		if err != nil {
			return nil, err
		}
		if len(answers) != 1 || answers[0] != password {
			return nil, fmt.Errorf("wrong password")
		}
		if len(extra) == 2 {
			answers, err = client("Second factor", "Enter the code from your app", []string{extra[0]}, []bool{true})
			if err != nil {
				return nil, err
			}
			if len(answers) != 1 || answers[0] != extra[1] {
				return nil, fmt.Errorf("wrong code")
			}
		}
		return &ssh.Permissions{}, nil
	}
}
