package main

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const partSuffix = ".agentgrid-part"

const posixRenameExtension = "posix-rename@openssh.com"

var transferProgressInterval = 250 * time.Millisecond

type plannedEntry struct {
	rel   string
	size  int64
	mtime time.Time
}

type transferPlan struct {
	folder   bool
	rootName string
	dirs     []plannedEntry
	files    []plannedEntry
	total    int64
}

type transfer struct {
	files      *sftpSession
	id         opaqueID
	upload     bool
	localRoot  string
	remoteRoot string
	overwrite  bool
	ctx        context.Context
	cancel     context.CancelCauseFunc
	plan       transferPlan

	moved     atomic.Int64
	filesDone atomic.Int64

	mu      sync.Mutex
	current string
}

type progressSnapshot struct {
	bytes      int64
	total      int64
	files      int
	filesTotal int
	current    string
}

func (f *sftpSession) startTransfer(cmd *command, tid opaqueID) {
	if cmd.LocalPath == "" || cmd.RemotePath == "" {
		f.owner.emitUnlessFinished(transferDoneEvent{
			Ev: "transfer-done", Sid: f.owner.id.raw, Tid: tid.raw,
			Error: &sftpError{Code: codeFailure, Message: "localPath and remotePath are required"},
		})
		return
	}
	f.mu.Lock()
	if f.closing {
		f.mu.Unlock()
		return
	}
	if _, busy := f.transfers[tid.key]; busy {
		f.mu.Unlock()
		f.owner.helper.diag.Printf("session %s: ignoring a second transfer with tid %s", f.owner.id.raw, tid.raw)
		return
	}
	ctx, cancel := context.WithCancelCause(f.transfersCtx)
	t := &transfer{
		files:      f,
		id:         tid,
		upload:     cmd.Op == "sftp-upload",
		localRoot:  cmd.LocalPath,
		remoteRoot: f.resolve(cmd.RemotePath),
		overwrite:  cmd.Overwrite,
		ctx:        ctx,
		cancel:     cancel,
	}
	f.transfers[tid.key] = t
	f.work.Add(1)
	f.mu.Unlock()

	go func() {
		defer f.work.Done()
		done := t.runToCompletion()
		f.forgetTransfer(t)
		f.owner.emitUnlessFinished(done)
	}()
}

func (f *sftpSession) cancelTransfer(rawTid []byte) {
	tid, ok := parseOpaqueID(rawTid)
	if !ok {
		return
	}
	f.mu.Lock()
	t := f.transfers[tid.key]
	f.mu.Unlock()
	if t != nil {
		t.cancel(errTransferCancelled)
	}
}

func (f *sftpSession) forgetTransfer(t *transfer) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.transfers[t.id.key] == t {
		delete(f.transfers, t.id.key)
	}
	t.cancel(nil)
}

func (t *transfer) runToCompletion() (done transferDoneEvent) {
	done = transferDoneEvent{Ev: "transfer-done", Sid: t.files.owner.id.raw, Tid: t.id.raw}
	defer func() {
		if r := recover(); r != nil {
			t.files.owner.helper.diag.Printf("session %s: internal error in transfer %s: %v", t.files.owner.id.raw, t.id.raw, r)
			done.Ok = false
			done.Error = &sftpError{Code: codeFailure, Message: "internal error"}
		}
	}()

	err := t.makePlan()
	if err == nil {
		stopProgress := make(chan struct{})
		var progress sync.WaitGroup
		progress.Go(func() { t.reportProgress(stopProgress) })
		err = t.execute()
		close(stopProgress)
		progress.Wait()
	}
	t.emitProgress(t.snapshot())
	if problem := t.outcome(err); problem != nil {
		done.Error = problem
		return done
	}
	done.Ok = true
	return done
}

func (t *transfer) outcome(err error) *sftpError {
	if err == nil {
		return nil
	}
	if cause := context.Cause(t.ctx); cause != nil {
		if errors.Is(cause, errConnectionGone) {
			return &sftpError{Code: codeConnection, Message: errConnectionGone.Error()}
		}
		return &sftpError{Code: codeCancelled, Message: errTransferCancelled.Error()}
	}
	return sftpErrorFrom(err)
}

func (t *transfer) stopped() error {
	if t.ctx.Err() != nil {
		return context.Cause(t.ctx)
	}
	return nil
}

func (t *transfer) snapshot() progressSnapshot {
	t.mu.Lock()
	current := t.current
	t.mu.Unlock()
	moved := t.moved.Load()
	return progressSnapshot{
		bytes:      moved,
		total:      max(t.plan.total, moved),
		files:      int(t.filesDone.Load()),
		filesTotal: len(t.plan.files),
		current:    current,
	}
}

func (t *transfer) emitProgress(snap progressSnapshot) {
	t.files.owner.emitUnlessFinished(transferEvent{
		Ev:         "transfer",
		Sid:        t.files.owner.id.raw,
		Tid:        t.id.raw,
		Bytes:      snap.bytes,
		Total:      snap.total,
		Files:      snap.files,
		FilesTotal: snap.filesTotal,
		Current:    snap.current,
	})
}

func (t *transfer) reportProgress(stop <-chan struct{}) {
	ticker := time.NewTicker(transferProgressInterval)
	defer ticker.Stop()
	var last progressSnapshot
	sent := false
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		}
		snap := t.snapshot()
		if !sent || snap != last {
			t.emitProgress(snap)
			last, sent = snap, true
		}
	}
}

func (t *transfer) setCurrent(file plannedEntry) {
	name := file.rel
	if name == "" {
		name = t.plan.rootName
	}
	t.mu.Lock()
	t.current = name
	t.mu.Unlock()
}

func (t *transfer) makePlan() error {
	var plan transferPlan
	var err error
	if t.upload {
		plan, err = t.planLocal()
	} else {
		plan, err = t.planRemote()
	}
	if err != nil {
		return err
	}
	for _, file := range plan.files {
		plan.total += file.size
	}
	t.plan = plan
	return nil
}

func (t *transfer) planLocal() (transferPlan, error) {
	info, err := os.Stat(t.localRoot)
	if err != nil {
		return transferPlan{}, atPath(t.localRoot, err)
	}
	if !info.IsDir() {
		if !info.Mode().IsRegular() {
			return transferPlan{}, &fileOpError{code: codeFailure, message: t.localRoot + " is not a regular file"}
		}
		return transferPlan{
			rootName: filepath.Base(t.localRoot),
			files:    []plannedEntry{{size: info.Size(), mtime: info.ModTime()}},
		}, nil
	}
	plan := transferPlan{folder: true, rootName: filepath.Base(t.localRoot), dirs: []plannedEntry{{mtime: info.ModTime()}}}
	err = filepath.WalkDir(t.localRoot, func(local string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return atPath(local, walkErr)
		}
		if err := t.stopped(); err != nil {
			return err
		}
		if local == t.localRoot {
			return nil
		}
		relative, err := filepath.Rel(t.localRoot, local)
		if err != nil {
			return err
		}
		rel := filepath.ToSlash(relative)
		switch {
		case entry.IsDir():
			info, err := entry.Info()
			if err != nil {
				return atPath(local, err)
			}
			plan.dirs = append(plan.dirs, plannedEntry{rel: rel, mtime: info.ModTime()})
		case entry.Type()&fs.ModeSymlink != 0:
			if target, err := os.Stat(local); err == nil && target.Mode().IsRegular() {
				plan.files = append(plan.files, plannedEntry{rel: rel, size: target.Size(), mtime: target.ModTime()})
			}
		case entry.Type().IsRegular():
			info, err := entry.Info()
			if err != nil {
				return atPath(local, err)
			}
			plan.files = append(plan.files, plannedEntry{rel: rel, size: info.Size(), mtime: info.ModTime()})
		}
		return nil
	})
	return plan, err
}

func (t *transfer) planRemote() (transferPlan, error) {
	client := t.files.client
	info, err := client.Stat(t.remoteRoot)
	if err != nil {
		return transferPlan{}, atPath(t.remoteRoot, err)
	}
	if !info.IsDir() {
		if !info.Mode().IsRegular() {
			return transferPlan{}, &fileOpError{code: codeFailure, message: t.remoteRoot + " is not a regular file"}
		}
		return transferPlan{
			rootName: path.Base(t.remoteRoot),
			files:    []plannedEntry{{size: info.Size(), mtime: info.ModTime()}},
		}, nil
	}
	plan := transferPlan{folder: true, rootName: path.Base(t.remoteRoot), dirs: []plannedEntry{{mtime: info.ModTime()}}}
	err = t.walkRemote("", &plan)
	return plan, err
}

func (t *transfer) walkRemote(dirRel string, plan *transferPlan) error {
	if err := t.stopped(); err != nil {
		return err
	}
	client := t.files.client
	dir := t.remotePathOf(dirRel)
	children, err := client.ReadDir(dir)
	if err != nil {
		return atPath(dir, err)
	}
	for _, child := range children {
		name := child.Name()
		if name == "." || name == ".." {
			continue
		}
		rel := joinRel(dirRel, name)
		mode := child.Mode()
		if (mode.IsDir() || mode.IsRegular() || mode&os.ModeSymlink != 0) && !isSafeLocalName(name) {
			return &fileOpError{code: codeFailure, message: "cannot save " + rel + " on this computer: unsupported file name"}
		}
		switch {
		case mode.IsDir():
			plan.dirs = append(plan.dirs, plannedEntry{rel: rel, mtime: child.ModTime()})
			if err := t.walkRemote(rel, plan); err != nil {
				return err
			}
		case mode&os.ModeSymlink != 0:
			if target, err := client.Stat(path.Join(dir, name)); err == nil && target.Mode().IsRegular() {
				plan.files = append(plan.files, plannedEntry{rel: rel, size: target.Size(), mtime: target.ModTime()})
			}
		case mode.IsRegular():
			plan.files = append(plan.files, plannedEntry{rel: rel, size: child.Size(), mtime: child.ModTime()})
		}
	}
	return nil
}

func isSafeLocalName(name string) bool {
	return name != "" && !strings.ContainsAny(name, `\/`) && filepath.IsLocal(name)
}

func joinRel(dirRel, name string) string {
	if dirRel == "" {
		return name
	}
	return dirRel + "/" + name
}

func parentRel(rel string) string {
	parent := path.Dir(rel)
	if parent == "." {
		return ""
	}
	return parent
}

func (t *transfer) remotePathOf(rel string) string {
	if rel == "" {
		return t.remoteRoot
	}
	return path.Join(t.remoteRoot, rel)
}

func (t *transfer) localPathOf(rel string) string {
	if rel == "" {
		return t.localRoot
	}
	return filepath.Join(t.localRoot, filepath.FromSlash(rel))
}

func (t *transfer) execute() error {
	if err := t.checkDestination(); err != nil {
		return err
	}
	for _, dir := range t.plan.dirs {
		if err := t.stopped(); err != nil {
			return err
		}
		if err := t.makeDir(dir.rel); err != nil {
			return err
		}
	}
	for _, file := range t.plan.files {
		if err := t.stopped(); err != nil {
			return err
		}
		t.setCurrent(file)
		var err error
		if t.upload {
			err = t.uploadFile(file)
		} else {
			err = t.downloadFile(file)
		}
		if err != nil {
			return err
		}
		t.filesDone.Add(1)
	}
	for i := len(t.plan.dirs) - 1; i >= 0; i-- {
		t.copyDirTime(t.plan.dirs[i])
	}
	return nil
}

func destinationTaken(where string) error {
	return &fileOpError{code: codeExists, message: where + " already exists"}
}

func (t *transfer) checkDestination() error {
	if t.upload {
		return t.checkRemoteDestination()
	}
	return t.checkLocalDestination()
}

func (t *transfer) checkRemoteDestination() error {
	client := t.files.client
	info, err := client.Lstat(t.remoteRoot)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return atPath(t.remoteRoot, err)
	}
	if t.plan.folder != info.IsDir() || (!t.plan.folder && !t.overwrite) {
		return destinationTaken(t.remoteRoot)
	}
	if !t.plan.folder || t.overwrite {
		return nil
	}
	existing := make(map[string]bool)
	missing := make(map[string]bool)
	for _, dir := range t.plan.dirs {
		if err := t.stopped(); err != nil {
			return err
		}
		if dir.rel != "" && missing[parentRel(dir.rel)] {
			missing[dir.rel] = true
			continue
		}
		remoteDir := t.remotePathOf(dir.rel)
		children, err := client.ReadDir(remoteDir)
		if errors.Is(err, fs.ErrNotExist) {
			missing[dir.rel] = true
			continue
		}
		if err != nil {
			return atPath(remoteDir, err)
		}
		for _, child := range children {
			existing[joinRel(dir.rel, child.Name())] = true
		}
	}
	for _, file := range t.plan.files {
		if existing[file.rel] {
			return destinationTaken(t.remotePathOf(file.rel))
		}
	}
	return nil
}

func (t *transfer) checkLocalDestination() error {
	info, err := os.Lstat(t.localRoot)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return atPath(t.localRoot, err)
	}
	if t.plan.folder != info.IsDir() || (!t.plan.folder && !t.overwrite) {
		return destinationTaken(t.localRoot)
	}
	if !t.plan.folder || t.overwrite {
		return nil
	}
	for _, file := range t.plan.files {
		local := t.localPathOf(file.rel)
		if _, err := os.Lstat(local); err == nil {
			return destinationTaken(local)
		}
	}
	return nil
}

func (t *transfer) makeDir(rel string) error {
	if t.upload {
		remote := t.remotePathOf(rel)
		err := t.files.client.Mkdir(remote)
		if err == nil {
			return nil
		}
		if info, statErr := t.files.client.Lstat(remote); statErr == nil && info.IsDir() {
			return nil
		}
		return atPath(remote, err)
	}
	local := t.localPathOf(rel)
	err := os.Mkdir(local, 0o755)
	if err == nil {
		return nil
	}
	if info, statErr := os.Lstat(local); statErr == nil && info.IsDir() {
		return nil
	}
	return atPath(local, err)
}

func (t *transfer) copyDirTime(dir plannedEntry) {
	if t.upload {
		t.files.client.Chtimes(t.remotePathOf(dir.rel), dir.mtime, dir.mtime)
		return
	}
	os.Chtimes(t.localPathOf(dir.rel), dir.mtime, dir.mtime)
}

func (t *transfer) uploadFile(file plannedEntry) error {
	client := t.files.client
	local := t.localPathOf(file.rel)
	remote := t.remotePathOf(file.rel)
	part := remote + partSuffix

	source, err := os.Open(local)
	if err != nil {
		return atPath(local, err)
	}
	defer source.Close()
	target, err := client.OpenFile(part, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return atPath(part, err)
	}
	_, err = target.ReadFromWithConcurrency(&progressReader{transfer: t, source: source}, maxRequestsPerFile)
	if closeErr := target.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = client.Chtimes(part, file.mtime, file.mtime)
	}
	if err == nil {
		err = t.placeRemote(part, remote)
	}
	if err != nil {
		client.Remove(part)
		return atPath(remote, err)
	}
	return nil
}

func (t *transfer) placeRemote(part, remote string) error {
	client := t.files.client
	if !t.overwrite {
		err := client.Rename(part, remote)
		if err != nil {
			if _, statErr := client.Lstat(remote); statErr == nil {
				return destinationTaken(remote)
			}
		}
		return err
	}
	if _, supported := client.HasExtension(posixRenameExtension); supported {
		return client.PosixRename(part, remote)
	}
	if err := client.Remove(remote); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return client.Rename(part, remote)
}

func (t *transfer) downloadFile(file plannedEntry) error {
	remote := t.remotePathOf(file.rel)
	local := t.localPathOf(file.rel)
	part := local + partSuffix

	source, err := t.files.client.Open(remote)
	if err != nil {
		return atPath(remote, err)
	}
	defer source.Close()
	target, err := os.OpenFile(part, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return atPath(part, err)
	}
	_, err = source.WriteTo(&progressWriter{transfer: t, target: target})
	if closeErr := target.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Chtimes(part, file.mtime, file.mtime)
	}
	if err == nil {
		err = t.placeLocal(part, local)
	}
	if err != nil {
		os.Remove(part)
		return atPath(local, err)
	}
	return nil
}

func (t *transfer) placeLocal(part, local string) error {
	if !t.overwrite {
		if _, err := os.Lstat(local); err == nil {
			return destinationTaken(local)
		}
	}
	return os.Rename(part, local)
}

type progressReader struct {
	transfer *transfer
	source   io.Reader
}

func (r *progressReader) Read(buffer []byte) (int, error) {
	if err := r.transfer.stopped(); err != nil {
		return 0, err
	}
	n, err := r.source.Read(buffer)
	r.transfer.moved.Add(int64(n))
	return n, err
}

type progressWriter struct {
	transfer *transfer
	target   io.Writer
}

func (w *progressWriter) Write(data []byte) (int, error) {
	if err := w.transfer.stopped(); err != nil {
		return 0, err
	}
	n, err := w.target.Write(data)
	w.transfer.moved.Add(int64(n))
	return n, err
}
