package main

import (
	"bytes"
	"crypto/rand"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var fixedTime = time.Date(2023, 5, 6, 7, 8, 9, 0, time.UTC)

func startFileServer(t *testing.T) (*testServer, *virtualFS) {
	t.Helper()
	files := newVirtualFS(t)
	return startServer(t, serverOptions{password: serverPassword, files: files}), files
}

func openFiles(t *testing.T, h *helperUnderTest, sid string, srv *testServer) {
	t.Helper()
	h.send(map[string]any{"op": "sftp-open", "sid": sid, "target": passwordHost("files", srv, serverPassword), "jump": nil})
	h.expectPhase(sid, "connecting", "files")
	h.expectPhase(sid, "authenticating", "files")
	if ready := h.expect(sid, "sftp-ready"); ready.str("home") != testHome {
		t.Fatalf("sftp-ready %s, want home %s", ready, testHome)
	}
}

func (h *helperUnderTest) request(sid, rid, op string, fields map[string]any) testEvent {
	h.t.Helper()
	cmd := map[string]any{"op": op, "sid": sid, "rid": rid}
	for key, value := range fields {
		cmd[key] = value
	}
	h.send(cmd)
	reply := h.next(sid+"#rid:"+rid, eventWait)
	if reply.str("ev") != "sftp-reply" {
		h.t.Fatalf("got %s, want sftp-reply", reply)
	}
	return reply
}

func expectOk(t *testing.T, reply testEvent) {
	t.Helper()
	if reply["ok"] != true {
		t.Fatalf("request failed: %s", reply)
	}
}

func errorCode(event testEvent) string {
	problem, _ := event["error"].(map[string]any)
	code, _ := problem["code"].(string)
	return code
}

func expectErrorCode(t *testing.T, event testEvent, code string) {
	t.Helper()
	if event["ok"] != false || errorCode(event) != code {
		t.Fatalf("got %s, want error %s", event, code)
	}
	if problem, _ := event["error"].(map[string]any); problem["message"] == "" {
		t.Fatalf("error without a message: %s", event)
	}
}

func (h *helperUnderTest) startTransfer(sid, tid, op, localPath, remotePath string, overwrite bool) {
	h.t.Helper()
	h.send(map[string]any{"op": op, "sid": sid, "tid": tid, "localPath": localPath, "remotePath": remotePath, "overwrite": overwrite})
}

func (h *helperUnderTest) awaitTransfer(sid, tid string) ([]testEvent, testEvent) {
	h.t.Helper()
	var progress []testEvent
	deadline := time.Now().Add(30 * time.Second)
	for {
		event := h.next(sid+"#tid:"+tid, time.Until(deadline))
		if event.str("ev") == "transfer-done" {
			return progress, event
		}
		progress = append(progress, event)
	}
}

func (h *helperUnderTest) awaitBytesMoving(sid, tid string) testEvent {
	h.t.Helper()
	deadline := time.Now().Add(eventWait)
	for {
		event := h.next(sid+"#tid:"+tid, time.Until(deadline))
		if event.str("ev") == "transfer-done" {
			h.t.Fatalf("transfer finished before it could be interrupted: %s", event)
		}
		if moved, _ := event.num("bytes"); moved > 0 {
			return event
		}
	}
}

func seqOf(event testEvent) int {
	seq, _ := event.num("_seq")
	return seq
}

func expectTransferOk(t *testing.T, progress []testEvent, done testEvent, wantBytes, wantFiles int) {
	t.Helper()
	if done["ok"] != true {
		t.Fatalf("transfer failed: %s", done)
	}
	if len(progress) == 0 {
		t.Fatal("no transfer event before transfer-done")
	}
	last := progress[len(progress)-1]
	bytesMoved, _ := last.num("bytes")
	total, _ := last.num("total")
	filesMoved, _ := last.num("files")
	filesTotal, _ := last.num("filesTotal")
	if bytesMoved != wantBytes || total != wantBytes || filesMoved != wantFiles || filesTotal != wantFiles {
		t.Fatalf("final progress %s, want %d bytes and %d files", last, wantBytes, wantFiles)
	}
}

func writeLocal(t *testing.T, local string, content []byte, mtime time.Time) {
	t.Helper()
	writeFile(t, local, string(content))
	if err := os.Chtimes(local, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func localPartFiles(t *testing.T, dir string) []string {
	t.Helper()
	var parts []string
	filepath.WalkDir(dir, func(local string, entry fs.DirEntry, err error) error {
		if err == nil && strings.HasSuffix(entry.Name(), partSuffix) {
			parts = append(parts, local)
		}
		return nil
	})
	return parts
}

func expectNoParts(t *testing.T, files *virtualFS, localDirs ...string) {
	t.Helper()
	if parts := files.partFiles(); len(parts) > 0 {
		t.Fatalf("part files left on the server: %v", parts)
	}
	for _, dir := range localDirs {
		if parts := localPartFiles(t, dir); len(parts) > 0 {
			t.Fatalf("part files left locally: %v", parts)
		}
	}
}

func localModTime(t *testing.T, local string) time.Time {
	t.Helper()
	info, err := os.Stat(local)
	if err != nil {
		t.Fatal(err)
	}
	return info.ModTime()
}

func randomBytes(t *testing.T, size int) []byte {
	t.Helper()
	content := make([]byte, size)
	if _, err := rand.Read(content); err != nil {
		t.Fatal(err)
	}
	return content
}

func TestSftpOpenViaShellSessionUsesTheSameLogin(t *testing.T) {
	srv, files := startFileServer(t)
	files.writeFile(testHome+"/hello.txt", "hi", time.Time{})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	h.remember(serverPassword)

	connectShell(t, h, srv, "shell", "app-01")
	h.send(map[string]any{"op": "sftp-open", "sid": "files", "via": "shell"})
	if ready := h.expect("files", "sftp-ready"); ready.str("home") != testHome {
		t.Fatalf("got %s, want home %s", ready, testHome)
	}
	reply := h.request("files", "r1", "sftp-list", map[string]any{"path": "."})
	expectOk(t, reply)
	if entries, _ := reply["entries"].([]any); len(entries) != 1 {
		t.Fatalf("unexpected listing %s", reply)
	}
	if srv.handshakes.Load() != 1 {
		t.Fatalf("server saw %d logins, want 1", srv.handshakes.Load())
	}

	h.send(map[string]any{"op": "sftp-close", "sid": "files"})
	h.expectClosed("files", reasonClosed)
	h.input("shell", "still here\n")
	h.readOutputUntil("shell", "still here\n")
}

func TestSftpOpenWithOwnConnection(t *testing.T) {
	srv, _ := startFileServer(t)
	h := startHelper(t, helperSetup{})

	h.send(map[string]any{"op": "sftp-open", "sid": "files", "target": passwordHost("files", srv, serverPassword), "jump": nil})
	question := expectHostKeyQuestion(t, h, "files", srv, "files")
	early := h.request("files", "r0", "sftp-list", map[string]any{"path": "."})
	expectErrorCode(t, early, codeConnection)
	h.answer("files", question["rid"], map[string]any{"accept": true})
	h.expectPhase("files", "authenticating", "files")
	if ready := h.expect("files", "sftp-ready"); ready.str("home") != testHome {
		t.Fatalf("got %s, want home %s", ready, testHome)
	}

	h.send(map[string]any{"op": "sftp-close", "sid": "files"})
	h.expectClosed("files", reasonClosed)
	receive(t, srv.connectionsEnded, "the SFTP connection close")
}

func TestSftpOpenViaMissingOrUnconnectedSession(t *testing.T) {
	srv, _ := startFileServer(t)
	h := startHelper(t, helperSetup{})

	h.send(map[string]any{"op": "sftp-open", "sid": "f1", "via": "ghost"})
	h.expectFailed("f1", kindOther, "")

	h.connect("shell", modeShell, passwordHost("app-01", srv, serverPassword), nil)
	h.skipUntil("shell", "hostkey")
	h.send(map[string]any{"op": "sftp-open", "sid": "f2", "via": "shell"})
	h.expectFailed("f2", kindOther, "app-01")
}

func TestSftpRefusedSubsystemFails(t *testing.T) {
	srv := startServer(t, serverOptions{password: serverPassword})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	h.send(map[string]any{"op": "sftp-open", "sid": "files", "target": passwordHost("files", srv, serverPassword), "jump": nil})
	h.expectPhase("files", "connecting", "files")
	h.expectPhase("files", "authenticating", "files")
	h.expectFailed("files", kindOther, "files")
	receive(t, srv.connectionsEnded, "the SFTP connection close")
}

func TestSftpRequestOnShellSessionFails(t *testing.T) {
	srv, _ := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "shell", "app-01")
	expectErrorCode(t, h.request("shell", "r1", "sftp-list", map[string]any{"path": "."}), codeFailure)
}

func TestSftpListShowsLinks(t *testing.T) {
	srv, files := startFileServer(t)
	files.writeFile(testHome+"/a.txt", "hello", fixedTime)
	files.setMode(testHome+"/a.txt", 0o644)
	files.mkdir(testHome + "/docs")
	files.link(testHome+"/to-file", "a.txt")
	files.link(testHome+"/to-dir", testHome+"/docs")
	files.link(testHome+"/dangling", "nowhere")
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)

	reply := h.request("files", "r1", "sftp-list", map[string]any{"path": "."})
	expectOk(t, reply)
	if reply.str("path") != testHome {
		t.Fatalf("list path %q, want %q", reply.str("path"), testHome)
	}
	raw, _ := reply["entries"].([]any)
	var names []string
	entries := make(map[string]map[string]any)
	for _, item := range raw {
		entry := item.(map[string]any)
		names = append(names, entry["name"].(string))
		entries[entry["name"].(string)] = entry
	}
	if strings.Join(names, ",") != "a.txt,dangling,docs,to-dir,to-file" {
		t.Fatalf("entries %v", names)
	}
	file := entries["a.txt"]
	if file["kind"] != "file" || file["size"] != float64(5) || file["mtime"] != float64(fixedTime.UnixMilli()) || file["mode"] != float64(0o644) {
		t.Fatalf("unexpected file entry %v", file)
	}
	if entries["docs"]["kind"] != "dir" {
		t.Fatalf("unexpected dir entry %v", entries["docs"])
	}
	if link := entries["to-file"]; link["kind"] != "link" || link["target"] != "a.txt" || link["targetKind"] != "file" {
		t.Fatalf("unexpected file link %v", link)
	}
	if link := entries["to-dir"]; link["kind"] != "link" || link["target"] != testHome+"/docs" || link["targetKind"] != "dir" {
		t.Fatalf("unexpected dir link %v", link)
	}
	if link := entries["dangling"]; link["kind"] != "link" || link["target"] != "nowhere" {
		t.Fatalf("unexpected dangling link %v", link)
	} else if _, has := link["targetKind"]; has {
		t.Fatalf("dangling link must not have targetKind: %v", link)
	}
}

func TestSftpRealpathOfDot(t *testing.T) {
	srv, _ := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)

	reply := h.request("files", "r1", "sftp-realpath", map[string]any{"path": "."})
	expectOk(t, reply)
	if reply.str("path") != testHome {
		t.Fatalf("realpath %s, want %s", reply, testHome)
	}
}

func TestSftpMkdir(t *testing.T) {
	srv, files := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)

	expectOk(t, h.request("files", "r1", "sftp-mkdir", map[string]any{"path": "made"}))
	if info, err := os.Stat(files.local(testHome + "/made")); err != nil || !info.IsDir() {
		t.Fatalf("directory was not created (%v)", err)
	}
	expectErrorCode(t, h.request("files", "r2", "sftp-mkdir", map[string]any{"path": testHome + "/made"}), codeExists)
}

func TestSftpRenameNeverOverwrites(t *testing.T) {
	srv, files := startFileServer(t)
	files.writeFile(testHome+"/a.txt", "A", time.Time{})
	files.writeFile(testHome+"/b.txt", "B", time.Time{})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)

	expectOk(t, h.request("files", "r1", "sftp-rename", map[string]any{"from": "a.txt", "to": "c.txt"}))
	if files.exists(testHome+"/a.txt") || files.read(testHome+"/c.txt") != "A" {
		t.Fatal("rename did not move the file")
	}
	expectErrorCode(t, h.request("files", "r2", "sftp-rename", map[string]any{"from": "c.txt", "to": "b.txt"}), codeExists)
	if files.read(testHome+"/b.txt") != "B" || files.read(testHome+"/c.txt") != "A" {
		t.Fatal("a refused rename changed the files")
	}
}

func TestSftpRemove(t *testing.T) {
	srv, files := startFileServer(t)
	files.writeFile(testHome+"/file.txt", "x", time.Time{})
	files.mkdir(testHome + "/empty")
	files.writeFile(testHome+"/full/inner/deep.txt", "deep", time.Time{})
	files.writeFile(testHome+"/keep.txt", "keep", time.Time{})
	files.link(testHome+"/full/outside", testHome+"/keep.txt")
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)

	expectOk(t, h.request("files", "r1", "sftp-remove", map[string]any{"path": "file.txt", "recursive": false}))
	expectOk(t, h.request("files", "r2", "sftp-remove", map[string]any{"path": "empty", "recursive": false}))
	expectErrorCode(t, h.request("files", "r3", "sftp-remove", map[string]any{"path": "full", "recursive": false}), codeNotEmpty)
	if !files.exists(testHome + "/full/inner/deep.txt") {
		t.Fatal("a refused remove deleted files")
	}
	expectOk(t, h.request("files", "r4", "sftp-remove", map[string]any{"path": "full", "recursive": true}))
	switch {
	case files.exists(testHome + "/file.txt"), files.exists(testHome + "/empty"), files.exists(testHome + "/full"), files.isLink(testHome + "/full/outside"):
		t.Fatal("something was not removed")
	case files.read(testHome+"/keep.txt") != "keep":
		t.Fatal("removing a link followed it")
	}
}

func TestSftpChmod(t *testing.T) {
	srv, files := startFileServer(t)
	files.writeFile(testHome+"/a.txt", "x", time.Time{})
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)

	expectOk(t, h.request("files", "r1", "sftp-chmod", map[string]any{"path": "a.txt", "mode": 0o600}))
	reply := h.request("files", "r2", "sftp-list", map[string]any{"path": testHome})
	entry := reply["entries"].([]any)[0].(map[string]any)
	if entry["mode"] != float64(0o600) {
		t.Fatalf("mode after chmod %v, want %d", entry["mode"], 0o600)
	}
	expectErrorCode(t, h.request("files", "r3", "sftp-chmod", map[string]any{"path": "a.txt", "mode": "rwx"}), codeFailure)
}

func TestSftpErrorMapping(t *testing.T) {
	srv, files := startFileServer(t)
	files.mkdir(testHome + "/locked")
	files.deny(testHome + "/locked")
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)

	expectErrorCode(t, h.request("files", "r1", "sftp-list", map[string]any{"path": "missing"}), codeNotFound)
	expectErrorCode(t, h.request("files", "r2", "sftp-remove", map[string]any{"path": "missing"}), codeNotFound)
	expectErrorCode(t, h.request("files", "r3", "sftp-list", map[string]any{"path": "locked"}), codePermission)
	expectErrorCode(t, h.request("files", "r4", "sftp-mkdir", map[string]any{"path": "locked/new"}), codePermission)
}

func TestSftpSingleFileRoundTrip(t *testing.T) {
	srv, files := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	source := filepath.Join(folder, "report.txt")
	content := []byte("quarterly numbers\n")
	writeLocal(t, source, content, fixedTime)

	h.startTransfer("files", "u1", "sftp-upload", source, "report.txt", false)
	progress, done := h.awaitTransfer("files", "u1")
	expectTransferOk(t, progress, done, len(content), 1)
	if current := progress[len(progress)-1].str("current"); current != "report.txt" {
		t.Fatalf("current %q, want report.txt", current)
	}
	if files.read(testHome+"/report.txt") != string(content) || !files.modTime(testHome+"/report.txt").Equal(fixedTime) {
		t.Fatal("uploaded file differs in content or mtime")
	}

	copyPath := filepath.Join(folder, "copy.txt")
	h.startTransfer("files", "d1", "sftp-download", copyPath, testHome+"/report.txt", false)
	progress, done = h.awaitTransfer("files", "d1")
	expectTransferOk(t, progress, done, len(content), 1)
	if string(readFile(t, copyPath)) != string(content) || !localModTime(t, copyPath).Equal(fixedTime) {
		t.Fatal("downloaded file differs in content or mtime")
	}
	expectNoParts(t, files, folder)
}

func TestSftpFolderRoundTrip(t *testing.T) {
	srv, files := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	project := filepath.Join(folder, "project")
	writeLocal(t, filepath.Join(project, "a.txt"), []byte("alpha"), fixedTime)
	writeLocal(t, filepath.Join(project, "sub", "b.txt"), []byte("bravo!"), fixedTime)
	writeLocal(t, filepath.Join(project, "sub", "deeper", "c.txt"), []byte("charlie"), fixedTime)
	if err := os.MkdirAll(filepath.Join(project, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}

	h.startTransfer("files", "u1", "sftp-upload", project, "project", false)
	progress, done := h.awaitTransfer("files", "u1")
	expectTransferOk(t, progress, done, len("alpha")+len("bravo!")+len("charlie"), 3)
	for remote, want := range map[string]string{"/project/a.txt": "alpha", "/project/sub/b.txt": "bravo!", "/project/sub/deeper/c.txt": "charlie"} {
		if files.read(testHome+remote) != want || !files.modTime(testHome+remote).Equal(fixedTime) {
			t.Fatalf("uploaded %s differs", remote)
		}
	}
	if !files.exists(testHome + "/project/empty") {
		t.Fatal("empty folder was not created")
	}

	files.link(testHome+"/project/link-to-file", "a.txt")
	files.link(testHome+"/project/sub/link-to-dir", "deeper")
	copyRoot := filepath.Join(folder, "project-copy")
	h.startTransfer("files", "d1", "sftp-download", copyRoot, testHome+"/project", false)
	progress, done = h.awaitTransfer("files", "d1")
	expectTransferOk(t, progress, done, len("alpha")*2+len("bravo!")+len("charlie"), 4)
	for local, want := range map[string]string{"a.txt": "alpha", "link-to-file": "alpha", "sub/b.txt": "bravo!", "sub/deeper/c.txt": "charlie"} {
		path := filepath.Join(copyRoot, filepath.FromSlash(local))
		if string(readFile(t, path)) != want || !localModTime(t, path).Equal(fixedTime) {
			t.Fatalf("downloaded %s differs", local)
		}
	}
	if _, err := os.Lstat(filepath.Join(copyRoot, "sub", "link-to-dir")); !os.IsNotExist(err) {
		t.Fatal("a link to a folder must be skipped")
	}
	if info, err := os.Stat(filepath.Join(copyRoot, "empty")); err != nil || !info.IsDir() {
		t.Fatal("empty folder was not downloaded")
	}
	expectNoParts(t, files, folder)
}

func expectRisingProgress(t *testing.T, progress []testEvent, size int) {
	t.Helper()
	if len(progress) < 3 {
		t.Fatalf("only %d progress events for a large file", len(progress))
	}
	previous := -1
	for _, event := range progress {
		moved, _ := event.num("bytes")
		total, _ := event.num("total")
		if moved < previous || total != size {
			t.Fatalf("progress went backwards or total changed: %s", event)
		}
		previous = moved
	}
	if previous != size {
		t.Fatalf("final progress %d, want %d", previous, size)
	}
}

func TestSftpLargeFileReportsProgress(t *testing.T) {
	overrideDuration(t, &transferProgressInterval, 20*time.Millisecond)
	srv, files := startFileServer(t)
	files.slowDown(2 * time.Millisecond)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	size := 21 << 20
	content := randomBytes(t, size)
	source := filepath.Join(folder, "big.bin")
	writeLocal(t, source, content, fixedTime)

	files.takePeakCalls()
	h.startTransfer("files", "u1", "sftp-upload", source, "big.bin", false)
	progress, done := h.awaitTransfer("files", "u1")
	expectTransferOk(t, progress, done, size, 1)
	expectRisingProgress(t, progress, size)
	if !bytes.Equal([]byte(files.read(testHome+"/big.bin")), content) {
		t.Fatal("uploaded large file differs")
	}
	if peak := files.takePeakCalls(); peak < 2 {
		t.Fatalf("upload wrote with %d request in flight, want concurrent writes", peak)
	}

	copyPath := filepath.Join(folder, "big-copy.bin")
	h.startTransfer("files", "d1", "sftp-download", copyPath, "big.bin", false)
	progress, done = h.awaitTransfer("files", "d1")
	expectTransferOk(t, progress, done, size, 1)
	expectRisingProgress(t, progress, size)
	if !bytes.Equal(readFileBytes(t, copyPath), content) {
		t.Fatal("downloaded large file differs")
	}
	if peak := files.takePeakCalls(); peak < 2 {
		t.Fatalf("download read with %d request in flight, want concurrent reads", peak)
	}
	expectNoParts(t, files, folder)
}

func readFileBytes(t *testing.T, local string) []byte {
	t.Helper()
	content, err := os.ReadFile(local)
	if err != nil {
		t.Fatal(err)
	}
	return content
}

func TestSftpExistingDestinationNeedsOverwrite(t *testing.T) {
	srv, files := startFileServer(t)
	files.writeFile(testHome+"/keep.txt", "original", fixedTime)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	source := filepath.Join(folder, "replacement.txt")
	writeLocal(t, source, []byte("replacement"), fixedTime)
	localExisting := filepath.Join(folder, "local.txt")
	writeLocal(t, localExisting, []byte("local original"), fixedTime)

	h.startTransfer("files", "u1", "sftp-upload", source, "keep.txt", false)
	_, done := h.awaitTransfer("files", "u1")
	expectErrorCode(t, done, codeExists)
	if files.read(testHome+"/keep.txt") != "original" {
		t.Fatal("upload without overwrite changed the destination")
	}

	h.startTransfer("files", "d1", "sftp-download", localExisting, "keep.txt", false)
	_, done = h.awaitTransfer("files", "d1")
	expectErrorCode(t, done, codeExists)
	if string(readFile(t, localExisting)) != "local original" {
		t.Fatal("download without overwrite changed the destination")
	}

	h.startTransfer("files", "u2", "sftp-upload", source, "keep.txt", true)
	if _, done = h.awaitTransfer("files", "u2"); done["ok"] != true || files.read(testHome+"/keep.txt") != "replacement" {
		t.Fatalf("upload with overwrite: %s", done)
	}
	h.startTransfer("files", "d2", "sftp-download", localExisting, "keep.txt", true)
	if _, done = h.awaitTransfer("files", "d2"); done["ok"] != true || string(readFile(t, localExisting)) != "replacement" {
		t.Fatalf("download with overwrite: %s", done)
	}
	expectNoParts(t, files, folder)
}

func TestSftpCancelStopsTransferAndRemovesPart(t *testing.T) {
	overrideDuration(t, &transferProgressInterval, 10*time.Millisecond)
	srv, files := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	source := filepath.Join(folder, "big.bin")
	writeLocal(t, source, randomBytes(t, 8<<20), fixedTime)
	files.writeFile(testHome+"/remote-big.bin", string(randomBytes(t, 8<<20)), fixedTime)
	files.slowDown(20 * time.Millisecond)

	h.startTransfer("files", "u1", "sftp-upload", source, "big.bin", false)
	h.awaitBytesMoving("files", "u1")
	h.send(map[string]any{"op": "transfer-cancel", "sid": "files", "tid": "u1"})
	_, done := h.awaitTransfer("files", "u1")
	expectErrorCode(t, done, codeCancelled)
	if files.exists(testHome + "/big.bin") {
		t.Fatal("a cancelled upload left the destination")
	}

	copyPath := filepath.Join(folder, "copy.bin")
	h.startTransfer("files", "d1", "sftp-download", copyPath, "remote-big.bin", false)
	h.awaitBytesMoving("files", "d1")
	h.send(map[string]any{"op": "transfer-cancel", "sid": "files", "tid": "d1"})
	_, done = h.awaitTransfer("files", "d1")
	expectErrorCode(t, done, codeCancelled)
	if _, err := os.Stat(copyPath); !os.IsNotExist(err) {
		t.Fatal("a cancelled download left the destination")
	}
	expectNoParts(t, files, folder)
}

func TestSftpCloseCancelsRunningTransfers(t *testing.T) {
	overrideDuration(t, &transferProgressInterval, 10*time.Millisecond)
	srv, files := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	source := filepath.Join(folder, "big.bin")
	writeLocal(t, source, randomBytes(t, 8<<20), fixedTime)
	files.slowDown(20 * time.Millisecond)

	h.startTransfer("files", "u1", "sftp-upload", source, "big.bin", false)
	h.awaitBytesMoving("files", "u1")
	h.send(map[string]any{"op": "sftp-close", "sid": "files"})
	_, done := h.awaitTransfer("files", "u1")
	expectErrorCode(t, done, codeCancelled)
	closed := h.expectClosed("files", reasonClosed)
	if seqOf(done) > seqOf(closed) {
		t.Fatal("transfer-done must come before closed")
	}
	expectNoParts(t, files, folder)
	if files.exists(testHome + "/big.bin") {
		t.Fatal("a cancelled upload left the destination")
	}
}

func TestSftpEndsLostWhenViaSessionCloses(t *testing.T) {
	srv, _ := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})

	connectShell(t, h, srv, "shell", "app-01")
	h.send(map[string]any{"op": "sftp-open", "sid": "files", "via": "shell"})
	h.expect("files", "sftp-ready")
	h.send(map[string]any{"op": "close", "sid": "shell"})
	h.expectClosed("shell", reasonClosed)
	h.expectClosed("files", reasonLost)
}

func TestSftpTwoTransfersRunInParallel(t *testing.T) {
	overrideDuration(t, &transferProgressInterval, 10*time.Millisecond)
	srv, files := startFileServer(t)
	files.slowDown(4 * time.Millisecond)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	first, second := randomBytes(t, 4<<20), randomBytes(t, 4<<20)
	writeLocal(t, filepath.Join(folder, "first.bin"), first, fixedTime)
	writeLocal(t, filepath.Join(folder, "second.bin"), second, fixedTime)

	h.startTransfer("files", "t1", "sftp-upload", filepath.Join(folder, "first.bin"), "first.bin", false)
	h.startTransfer("files", "t2", "sftp-upload", filepath.Join(folder, "second.bin"), "second.bin", false)
	firstProgress, firstDone := h.awaitTransfer("files", "t1")
	secondProgress, secondDone := h.awaitTransfer("files", "t2")
	expectTransferOk(t, firstProgress, firstDone, len(first), 1)
	expectTransferOk(t, secondProgress, secondDone, len(second), 1)
	if !bytes.Equal([]byte(files.read(testHome+"/first.bin")), first) || !bytes.Equal([]byte(files.read(testHome+"/second.bin")), second) {
		t.Fatal("parallel uploads mixed up their content")
	}
	if max(seqOf(firstProgress[0]), seqOf(secondProgress[0])) > min(seqOf(firstDone), seqOf(secondDone)) {
		t.Fatal("the transfers did not overlap")
	}
}
