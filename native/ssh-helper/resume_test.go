package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func (h *helperUnderTest) startResumableTransfer(sid, tid, op, localPath, remotePath string, overwrite, resume bool) {
	h.t.Helper()
	h.send(map[string]any{
		"op": op, "sid": sid, "tid": tid, "localPath": localPath, "remotePath": remotePath,
		"overwrite": overwrite, "resume": resume,
	})
}

func waitUntil(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(eventWait)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func sizeOf(local string) int64 {
	info, err := os.Stat(local)
	if err != nil {
		return 0
	}
	return info.Size()
}

func firstBytes(t *testing.T, progress []testEvent) int {
	t.Helper()
	if len(progress) == 0 {
		t.Fatal("no progress events")
	}
	moved, _ := progress[0].num("bytes")
	return moved
}

func TestSftpDroppedDownloadKeepsPartAndResumes(t *testing.T) {
	overrideDuration(t, &transferProgressInterval, 10*time.Millisecond)
	srv, files := startFileServer(t)
	content := randomBytes(t, 8<<20)
	files.writeFile(testHome+"/big.bin", string(content), fixedTime)
	files.slowDown(20 * time.Millisecond)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	destination := filepath.Join(t.TempDir(), "big.bin")
	part := destination + partSuffix

	h.startResumableTransfer("files", "d1", "sftp-download", destination, "big.bin", false, true)
	waitUntil(t, "a partly downloaded file", func() bool { return sizeOf(part) > 512<<10 })
	srv.dropConnections()
	_, done := h.awaitTransfer("files", "d1")
	expectErrorCode(t, done, codeConnection)
	h.expectClosed("files", reasonLost)
	kept := sizeOf(part)
	if kept == 0 || kept >= int64(len(content)) {
		t.Fatalf("local part file holds %d bytes, want a partial file", kept)
	}

	openFiles(t, h, "again", srv)
	h.startResumableTransfer("again", "d2", "sftp-download", destination, "big.bin", false, true)
	progress, done := h.awaitTransfer("again", "d2")
	expectTransferOk(t, progress, done, len(content), 1)
	if first := firstBytes(t, progress); int64(first) < kept {
		t.Fatalf("first progress after resume shows %d bytes, the part held %d", first, kept)
	}
	if !bytes.Equal(readFileBytes(t, destination), content) || !localModTime(t, destination).Equal(fixedTime) {
		t.Fatal("resumed download differs in content or mtime")
	}
	expectNoParts(t, files, filepath.Dir(destination))
}

func TestSftpDroppedUploadKeepsRemotePartAndResumes(t *testing.T) {
	overrideDuration(t, &transferProgressInterval, 10*time.Millisecond)
	srv, files := startFileServer(t)
	files.slowDown(20 * time.Millisecond)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	source := filepath.Join(folder, "big.bin")
	content := randomBytes(t, 8<<20)
	writeLocal(t, source, content, fixedTime)
	remotePart := files.local(testHome + "/big.bin" + partSuffix)

	h.startResumableTransfer("files", "u1", "sftp-upload", source, "big.bin", false, true)
	waitUntil(t, "a partly uploaded file", func() bool { return sizeOf(remotePart) > 512<<10 })
	srv.dropConnections()
	_, done := h.awaitTransfer("files", "u1")
	expectErrorCode(t, done, codeConnection)
	h.expectClosed("files", reasonLost)
	receive(t, srv.connectionsEnded, "the dropped connection")
	kept := sizeOf(remotePart)
	if kept == 0 || kept >= int64(len(content)) {
		t.Fatalf("remote part file holds %d bytes, want a partial file", kept)
	}

	openFiles(t, h, "again", srv)
	h.startResumableTransfer("again", "u2", "sftp-upload", source, "big.bin", false, true)
	progress, done := h.awaitTransfer("again", "u2")
	expectTransferOk(t, progress, done, len(content), 1)
	if first := firstBytes(t, progress); int64(first) < kept {
		t.Fatalf("first progress after resume shows %d bytes, the part held %d", first, kept)
	}
	if !bytes.Equal([]byte(files.read(testHome+"/big.bin")), content) || !files.modTime(testHome+"/big.bin").Equal(fixedTime) {
		t.Fatal("resumed upload differs in content or mtime")
	}
	expectNoParts(t, files, folder)
}

func TestSftpResumeRestartsWhenPartIsLarger(t *testing.T) {
	srv, files := startFileServer(t)
	remoteContent := randomBytes(t, 100<<10)
	files.writeFile(testHome+"/data.bin", string(remoteContent), fixedTime)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	garbage := bytes.Repeat([]byte{0xAB}, 300<<10)

	destination := filepath.Join(folder, "data.bin")
	writeLocal(t, destination+partSuffix, garbage, fixedTime)
	h.startResumableTransfer("files", "d1", "sftp-download", destination, "data.bin", false, true)
	progress, done := h.awaitTransfer("files", "d1")
	expectTransferOk(t, progress, done, len(remoteContent), 1)
	if !bytes.Equal(readFileBytes(t, destination), remoteContent) {
		t.Fatal("download over a larger part file is corrupt")
	}

	localContent := randomBytes(t, 100<<10)
	source := filepath.Join(folder, "up.bin")
	writeLocal(t, source, localContent, fixedTime)
	files.writeFile(testHome+"/up.bin"+partSuffix, string(garbage), time.Time{})
	h.startResumableTransfer("files", "u1", "sftp-upload", source, "up.bin", false, true)
	progress, done = h.awaitTransfer("files", "u1")
	expectTransferOk(t, progress, done, len(localContent), 1)
	if !bytes.Equal([]byte(files.read(testHome+"/up.bin")), localContent) {
		t.Fatal("upload over a larger part file is corrupt")
	}
	expectNoParts(t, files, folder)
}

func TestSftpWithoutResumeExistingPartIsIgnored(t *testing.T) {
	srv, files := startFileServer(t)
	remoteContent := randomBytes(t, 200<<10)
	files.writeFile(testHome+"/data.bin", string(remoteContent), fixedTime)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	stalePrefix := make([]byte, 100<<10)

	destination := filepath.Join(folder, "data.bin")
	writeLocal(t, destination+partSuffix, stalePrefix, fixedTime)
	h.startResumableTransfer("files", "d1", "sftp-download", destination, "data.bin", false, false)
	progress, done := h.awaitTransfer("files", "d1")
	expectTransferOk(t, progress, done, len(remoteContent), 1)
	if !bytes.Equal(readFileBytes(t, destination), remoteContent) {
		t.Fatal("download with resume:false reused the stale part file")
	}

	localContent := randomBytes(t, 200<<10)
	source := filepath.Join(folder, "up.bin")
	writeLocal(t, source, localContent, fixedTime)
	files.writeFile(testHome+"/up.bin"+partSuffix, string(stalePrefix), time.Time{})
	h.startResumableTransfer("files", "u1", "sftp-upload", source, "up.bin", false, false)
	progress, done = h.awaitTransfer("files", "u1")
	expectTransferOk(t, progress, done, len(localContent), 1)
	if !bytes.Equal([]byte(files.read(testHome+"/up.bin")), localContent) {
		t.Fatal("upload with resume:false reused the stale part file")
	}
	expectNoParts(t, files, folder)
}

func TestSftpResumedUploadRepairsHolesNearTheEnd(t *testing.T) {
	srv, files := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	content := randomBytes(t, 6<<20)
	source := filepath.Join(folder, "big.bin")
	writeLocal(t, source, content, fixedTime)
	damaged := bytes.Clone(content[:5<<20])
	clear(damaged[4<<20+512<<10 : 4<<20+576<<10])
	files.writeFile(testHome+"/big.bin"+partSuffix, string(damaged), time.Time{})

	h.startResumableTransfer("files", "u1", "sftp-upload", source, "big.bin", false, true)
	progress, done := h.awaitTransfer("files", "u1")
	expectTransferOk(t, progress, done, len(content), 1)
	if !bytes.Equal([]byte(files.read(testHome+"/big.bin")), content) {
		t.Fatal("resumed upload kept the hole from the part file")
	}
	expectNoParts(t, files, folder)
}

func TestSftpFolderResumeSkipsFinishedAndResumesPartial(t *testing.T) {
	overrideDuration(t, &transferProgressInterval, 10*time.Millisecond)
	srv, files := startFileServer(t)
	files.slowDown(10 * time.Millisecond)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	project := filepath.Join(folder, "project")
	partial := randomBytes(t, 4<<20)
	writeLocal(t, filepath.Join(project, "a.txt"), []byte("alpha"), fixedTime)
	writeLocal(t, filepath.Join(project, "sub", "b.bin"), partial, fixedTime)
	writeLocal(t, filepath.Join(project, "sub", "c.txt"), []byte("charlie"), fixedTime)
	earlier := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	files.writeFile(testHome+"/project/a.txt", "alpha", earlier)
	files.writeFile(testHome+"/project/sub/b.bin"+partSuffix, string(partial[:2<<20]), time.Time{})

	h.startResumableTransfer("files", "u1", "sftp-upload", project, "project", false, true)
	progress, done := h.awaitTransfer("files", "u1")
	total := len("alpha") + len(partial) + len("charlie")
	expectTransferOk(t, progress, done, total, 3)
	if first := firstBytes(t, progress); first < len("alpha")+2<<20 {
		t.Fatalf("first progress shows %d bytes, want the finished file and the part counted", first)
	}
	if !files.modTime(testHome + "/project/a.txt").Equal(earlier) {
		t.Fatal("a finished file was copied again without overwrite")
	}
	if !bytes.Equal([]byte(files.read(testHome+"/project/sub/b.bin")), partial) || !files.modTime(testHome+"/project/sub/b.bin").Equal(fixedTime) {
		t.Fatal("the partial file was not completed correctly")
	}
	if files.read(testHome+"/project/sub/c.txt") != "charlie" {
		t.Fatal("the missing file was not copied")
	}
	expectNoParts(t, files, folder)
}

func TestSftpCancelRemovesPartEvenWithResume(t *testing.T) {
	overrideDuration(t, &transferProgressInterval, 10*time.Millisecond)
	srv, files := startFileServer(t)
	h := startHelper(t, helperSetup{trusted: []*testServer{srv}})
	openFiles(t, h, "files", srv)
	folder := t.TempDir()
	content := randomBytes(t, 8<<20)
	source := filepath.Join(folder, "big.bin")
	writeLocal(t, source, content, fixedTime)
	files.writeFile(testHome+"/big.bin"+partSuffix, string(content[:1<<20]), time.Time{})
	files.slowDown(20 * time.Millisecond)

	h.startResumableTransfer("files", "u1", "sftp-upload", source, "big.bin", false, true)
	h.awaitBytesMoving("files", "u1")
	h.send(map[string]any{"op": "transfer-cancel", "sid": "files", "tid": "u1"})
	_, done := h.awaitTransfer("files", "u1")
	expectErrorCode(t, done, codeCancelled)
	if files.exists(testHome + "/big.bin") {
		t.Fatal("a cancelled upload left the destination")
	}
	expectNoParts(t, files, folder)
}
