package main

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"net"
	"os"
	"path"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const (
	modeSftp = "sftp"

	codeNotFound   = "not-found"
	codePermission = "permission"
	codeExists     = "exists"
	codeNotEmpty   = "not-empty"
	codeConnection = "connection"
	codeFailure    = "failure"
	codeCancelled  = "cancelled"

	entryFile  = "file"
	entryDir   = "dir"
	entryLink  = "link"
	entryOther = "other"

	maxRequestsPerFile = 64
	linkLookupWorkers  = 8

	statusFileAlreadyExists = 11
	statusDirNotEmpty       = 18
)

var (
	sftpDrainTimeout = 3 * time.Second
	sftpCloseTimeout = 2 * time.Second
)

var (
	errTransferCancelled = errors.New("the transfer was cancelled")
	errConnectionGone    = errors.New("the connection was lost")
)

type fileOpError struct {
	code    string
	message string
}

func (e *fileOpError) Error() string {
	return e.message
}

type sftpSession struct {
	owner  *session
	client *sftp.Client
	home   string

	stop     chan struct{}
	stopOnce sync.Once

	transfersCtx    context.Context
	cancelTransfers context.CancelCauseFunc

	mu        sync.Mutex
	closing   bool
	transfers map[string]*transfer
	work      sync.WaitGroup
}

func (s *session) serveFiles(markReady func()) any {
	conn, f := s.filesConnection()
	if f != nil {
		return failedEventFor(s.id, f)
	}
	client, home, err := s.openSftpClient(conn)
	if err != nil {
		return failedEventFor(s.id, s.filesStartFailure(err))
	}
	s.track(boundedCloser{closer: client, limit: sftpCloseTimeout})

	files := newSftpSession(s, client, home)
	lost := make(chan struct{})
	go func() {
		client.Wait()
		close(lost)
	}()
	stopKeepalive := make(chan struct{})
	var keepalive sync.WaitGroup
	if s.via == nil {
		keepalive.Go(s.guarded(func() { s.keepAlive(conn, stopKeepalive) }))
	}

	s.mu.Lock()
	s.files = files
	s.mu.Unlock()
	markReady()
	s.emit(sftpReadyEvent{Ev: "sftp-ready", Sid: s.id.raw, Home: home})

	reason := reasonClosed
	select {
	case <-files.stop:
	case <-s.ctx.Done():
	case <-lost:
		reason = reasonLost
	}
	if reason == reasonLost {
		files.shutDown(errConnectionGone)
	} else {
		files.shutDown(errTransferCancelled)
	}
	close(stopKeepalive)
	keepalive.Wait()
	return closedEventFor(s.id, reason, nil)
}

func (s *session) filesConnection() (*ssh.Client, *failure) {
	if s.via == nil {
		return s.establish()
	}
	client := s.via.connectedShellClient()
	if client == nil {
		return nil, &failure{kind: kindOther, message: "via is not a connected shell session", host: s.target.displayName()}
	}
	return client, nil
}

func (s *session) openSftpClient(conn *ssh.Client) (*sftp.Client, string, error) {
	type opened struct {
		client *sftp.Client
		home   string
		err    error
	}
	result := make(chan opened, 1)
	go func() {
		client, err := sftp.NewClient(conn,
			sftp.UseConcurrentReads(true),
			sftp.UseConcurrentWrites(true),
			sftp.MaxConcurrentRequestsPerFile(maxRequestsPerFile))
		if err != nil {
			result <- opened{err: err}
			return
		}
		home, err := client.Getwd()
		if err != nil {
			client.Close()
			result <- opened{err: err}
			return
		}
		result <- opened{client: client, home: home}
	}()
	select {
	case r := <-result:
		return r.client, r.home, r.err
	case <-s.ctx.Done():
		go func() {
			if r := <-result; r.client != nil {
				r.client.Close()
			}
		}()
		return nil, "", errSessionClosed
	}
}

func (s *session) filesStartFailure(err error) *failure {
	host := s.target.displayName()
	if s.ctx.Err() != nil {
		return cancelledBeforeConnected(host)
	}
	return &failure{kind: kindOther, message: "could not start SFTP: " + err.Error(), host: host}
}

type boundedCloser struct {
	closer io.Closer
	limit  time.Duration
}

func (b boundedCloser) Close() error {
	done := make(chan error, 1)
	go func() { done <- b.closer.Close() }()
	select {
	case err := <-done:
		return err
	case <-time.After(b.limit):
		return errors.New("close did not finish in time")
	}
}

func newSftpSession(owner *session, client *sftp.Client, home string) *sftpSession {
	ctx, cancel := context.WithCancelCause(context.Background())
	return &sftpSession{
		owner:           owner,
		client:          client,
		home:            home,
		stop:            make(chan struct{}),
		transfersCtx:    ctx,
		cancelTransfers: cancel,
		transfers:       make(map[string]*transfer),
	}
}

func (f *sftpSession) requestStop() {
	f.stopOnce.Do(func() { close(f.stop) })
}

func (f *sftpSession) shutDown(cause error) {
	f.mu.Lock()
	f.closing = true
	f.mu.Unlock()
	f.cancelTransfers(cause)
	drained := make(chan struct{})
	go func() {
		f.work.Wait()
		close(drained)
	}()
	select {
	case <-drained:
	case <-time.After(sftpDrainTimeout):
		f.owner.helper.diag.Printf("session %s: SFTP work was still running when the session closed", f.owner.id.raw)
	}
}

func (f *sftpSession) beginWork() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closing {
		return false
	}
	f.work.Add(1)
	return true
}

func (f *sftpSession) handleRequest(cmd *command, rid opaqueID) {
	if !f.beginWork() {
		return
	}
	request := *cmd
	go func() {
		defer f.work.Done()
		f.owner.emitUnlessFinished(f.answer(&request, rid))
	}()
}

func (f *sftpSession) answer(cmd *command, rid opaqueID) (reply sftpReplyEvent) {
	defer func() {
		if r := recover(); r != nil {
			f.owner.helper.diag.Printf("session %s: internal error in %s: %v", f.owner.id.raw, cmd.Op, r)
			reply = failedReply(f.owner.id, rid, &sftpError{Code: codeFailure, Message: "internal error"})
		}
	}()
	reply = sftpReplyEvent{Ev: "sftp-reply", Sid: f.owner.id.raw, Rid: rid.raw, Ok: true}
	var err error
	switch cmd.Op {
	case "sftp-list":
		reply.Path, reply.Entries, err = f.list(cmd.Path)
	case "sftp-realpath":
		reply.Path, err = f.realPath(cmd.Path)
	case "sftp-mkdir":
		err = f.mkdir(cmd.Path)
	case "sftp-rename":
		err = f.rename(cmd.From, cmd.To)
	case "sftp-remove":
		err = f.remove(cmd.Path, cmd.Recursive)
	case "sftp-chmod":
		err = f.chmod(cmd)
	}
	if err != nil {
		return failedReply(f.owner.id, rid, sftpErrorFrom(err))
	}
	return reply
}

func failedReply(sid, rid opaqueID, problem *sftpError) sftpReplyEvent {
	return sftpReplyEvent{Ev: "sftp-reply", Sid: sid.raw, Rid: rid.raw, Ok: false, Error: problem}
}

func (f *sftpSession) resolve(remote string) string {
	if remote == "" {
		return f.home
	}
	if !path.IsAbs(remote) {
		remote = path.Join(f.home, remote)
	}
	return path.Clean(remote)
}

func (f *sftpSession) requirePath(remote string) (string, error) {
	if remote == "" {
		return "", &fileOpError{code: codeFailure, message: "path is required"}
	}
	return f.resolve(remote), nil
}

func (f *sftpSession) list(remote string) (string, *[]sftpEntry, error) {
	dir := f.resolve(remote)
	infos, err := f.client.ReadDir(dir)
	if err != nil {
		return "", nil, atPath(dir, err)
	}
	entries := make([]sftpEntry, 0, len(infos))
	for _, info := range infos {
		if info.Name() == "." || info.Name() == ".." {
			continue
		}
		entries = append(entries, entryFor(info))
	}
	slices.SortFunc(entries, func(a, b sftpEntry) int { return strings.Compare(a.Name, b.Name) })
	f.describeLinks(dir, entries)
	return dir, &entries, nil
}

func (f *sftpSession) describeLinks(dir string, entries []sftpEntry) {
	slots := make(chan struct{}, linkLookupWorkers)
	var lookups sync.WaitGroup
	for i := range entries {
		if entries[i].Kind != entryLink {
			continue
		}
		entry := &entries[i]
		slots <- struct{}{}
		lookups.Go(func() {
			defer func() { <-slots }()
			full := path.Join(dir, entry.Name)
			if target, err := f.client.ReadLink(full); err == nil {
				entry.Target = target
			}
			if info, err := f.client.Stat(full); err == nil {
				entry.TargetKind = entryKindOf(info.Mode())
			}
		})
	}
	lookups.Wait()
}

func entryFor(info os.FileInfo) sftpEntry {
	return sftpEntry{
		Name:  info.Name(),
		Kind:  entryKindOf(info.Mode()),
		Size:  info.Size(),
		Mtime: info.ModTime().UnixMilli(),
		Mode:  posixPermissions(info.Mode()),
	}
}

func entryKindOf(mode os.FileMode) string {
	switch {
	case mode&os.ModeSymlink != 0:
		return entryLink
	case mode.IsDir():
		return entryDir
	case mode.IsRegular():
		return entryFile
	}
	return entryOther
}

func posixPermissions(mode os.FileMode) uint32 {
	bits := uint32(mode.Perm())
	if mode&os.ModeSetuid != 0 {
		bits |= 0o4000
	}
	if mode&os.ModeSetgid != 0 {
		bits |= 0o2000
	}
	if mode&os.ModeSticky != 0 {
		bits |= 0o1000
	}
	return bits
}

func (f *sftpSession) realPath(remote string) (string, error) {
	target := f.resolve(remote)
	resolved, err := f.client.RealPath(target)
	if err != nil {
		return "", atPath(target, err)
	}
	return resolved, nil
}

func (f *sftpSession) mkdir(remote string) error {
	target, err := f.requirePath(remote)
	if err != nil {
		return err
	}
	if err := f.client.Mkdir(target); err != nil {
		if _, statErr := f.client.Lstat(target); statErr == nil {
			return &fileOpError{code: codeExists, message: target + " already exists"}
		}
		return atPath(target, err)
	}
	return nil
}

func (f *sftpSession) rename(from, to string) error {
	if from == "" || to == "" {
		return &fileOpError{code: codeFailure, message: "from and to are required"}
	}
	source, destination := f.resolve(from), f.resolve(to)
	taken := &fileOpError{code: codeExists, message: destination + " already exists"}
	if _, err := f.client.Lstat(destination); err == nil {
		return taken
	}
	if err := f.client.Rename(source, destination); err != nil {
		if _, statErr := f.client.Lstat(destination); statErr == nil {
			return taken
		}
		return atPath(source, err)
	}
	return nil
}

func (f *sftpSession) remove(remote string, recursive bool) error {
	target, err := f.requirePath(remote)
	if err != nil {
		return err
	}
	info, err := f.client.Lstat(target)
	if err != nil {
		return atPath(target, err)
	}
	if !info.IsDir() {
		return atPath(target, f.client.Remove(target))
	}
	if recursive {
		return f.removeTree(target)
	}
	children, err := f.client.ReadDir(target)
	if err != nil {
		return atPath(target, err)
	}
	if len(children) > 0 {
		return &fileOpError{code: codeNotEmpty, message: target + " is not empty"}
	}
	return atPath(target, f.client.RemoveDirectory(target))
}

func (f *sftpSession) removeTree(dir string) error {
	children, err := f.client.ReadDir(dir)
	if err != nil {
		return atPath(dir, err)
	}
	for _, child := range children {
		if child.Name() == "." || child.Name() == ".." {
			continue
		}
		full := path.Join(dir, child.Name())
		if child.IsDir() {
			err = f.removeTree(full)
		} else {
			err = atPath(full, f.client.Remove(full))
		}
		if err != nil {
			return err
		}
	}
	return atPath(dir, f.client.RemoveDirectory(dir))
}

func (f *sftpSession) chmod(cmd *command) error {
	target, err := f.requirePath(cmd.Path)
	if err != nil {
		return err
	}
	bits, ok := cmd.permissionBits()
	if !ok {
		return &fileOpError{code: codeFailure, message: "mode must be permission bits from 0 to 4095"}
	}
	return atPath(target, f.client.Chmod(target, os.FileMode(bits)))
}

type pathError struct {
	path string
	err  error
}

func (e *pathError) Error() string {
	return e.path + ": " + e.err.Error()
}

func (e *pathError) Unwrap() error {
	return e.err
}

func atPath(target string, err error) error {
	if err == nil {
		return nil
	}
	var explicit *fileOpError
	if errors.As(err, &explicit) {
		return err
	}
	var withPath *fs.PathError
	if errors.As(err, &withPath) {
		err = withPath.Err
	}
	return &pathError{path: target, err: err}
}

func sftpErrorFrom(err error) *sftpError {
	var explicit *fileOpError
	if errors.As(err, &explicit) {
		return &sftpError{Code: explicit.code, Message: explicit.message}
	}
	return &sftpError{Code: classifyFileError(err), Message: err.Error()}
}

func classifyFileError(err error) string {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return codeNotFound
	case errors.Is(err, fs.ErrPermission):
		return codePermission
	case errors.Is(err, fs.ErrExist):
		return codeExists
	case isLostConnection(err):
		return codeConnection
	}
	var status *sftp.StatusError
	if errors.As(err, &status) {
		switch status.FxCode() {
		case sftp.ErrSSHFxNoSuchFile:
			return codeNotFound
		case sftp.ErrSSHFxPermissionDenied:
			return codePermission
		case sftp.ErrSSHFxNoConnection, sftp.ErrSSHFxConnectionLost:
			return codeConnection
		}
		switch status.Code {
		case statusFileAlreadyExists:
			return codeExists
		case statusDirNotEmpty:
			return codeNotEmpty
		}
	}
	return codeFailure
}

func isLostConnection(err error) bool {
	return errors.Is(err, sftp.ErrSSHFxConnectionLost) ||
		errors.Is(err, sftp.ErrSSHFxNoConnection) ||
		errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrUnexpectedEOF) ||
		errors.Is(err, io.ErrClosedPipe) ||
		errors.Is(err, net.ErrClosed)
}
