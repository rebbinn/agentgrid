package main

import (
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pkg/sftp"
)

const testHome = "/home/tester"

const permissionBitsMask = os.ModePerm | os.ModeSetuid | os.ModeSetgid | os.ModeSticky

type virtualFS struct {
	t     *testing.T
	root  string
	delay atomic.Int64

	callsInFlight     atomic.Int64
	peakCallsInFlight atomic.Int64

	mu     sync.Mutex
	links  map[string]string
	modes  map[string]os.FileMode
	denied map[string]bool
}

func newVirtualFS(t *testing.T) *virtualFS {
	t.Helper()
	v := &virtualFS{
		t:      t,
		root:   t.TempDir(),
		links:  make(map[string]string),
		modes:  make(map[string]os.FileMode),
		denied: make(map[string]bool),
	}
	if err := os.MkdirAll(v.local(testHome), 0o755); err != nil {
		t.Fatal(err)
	}
	return v
}

func (v *virtualFS) handlers() sftp.Handlers {
	return sftp.Handlers{FileGet: v, FilePut: v, FileCmd: v, FileList: v}
}

func (v *virtualFS) local(remote string) string {
	return filepath.Join(v.root, filepath.FromSlash(path.Clean("/"+remote)))
}

func (v *virtualFS) slowDown(perCall time.Duration) {
	v.delay.Store(int64(perCall))
}

func (v *virtualFS) writeFile(remote, content string, mtime time.Time) {
	v.t.Helper()
	local := v.local(remote)
	if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
		v.t.Fatal(err)
	}
	if err := os.WriteFile(local, []byte(content), 0o644); err != nil {
		v.t.Fatal(err)
	}
	if !mtime.IsZero() {
		if err := os.Chtimes(local, mtime, mtime); err != nil {
			v.t.Fatal(err)
		}
	}
}

func (v *virtualFS) mkdir(remote string) {
	v.t.Helper()
	if err := os.MkdirAll(v.local(remote), 0o755); err != nil {
		v.t.Fatal(err)
	}
}

func (v *virtualFS) link(remote, target string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.links[remote] = target
}

func (v *virtualFS) deny(remote string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.denied[remote] = true
}

func (v *virtualFS) setMode(remote string, mode os.FileMode) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.modes[remote] = mode & permissionBitsMask
}

func (v *virtualFS) read(remote string) string {
	v.t.Helper()
	content, err := os.ReadFile(v.local(remote))
	if err != nil {
		v.t.Fatalf("reading remote %s: %v", remote, err)
	}
	return string(content)
}

func (v *virtualFS) exists(remote string) bool {
	if v.isLink(remote) {
		return true
	}
	_, err := os.Lstat(v.local(remote))
	return err == nil
}

func (v *virtualFS) isLink(remote string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	_, ok := v.links[remote]
	return ok
}

func (v *virtualFS) modTime(remote string) time.Time {
	v.t.Helper()
	info, err := os.Stat(v.local(remote))
	if err != nil {
		v.t.Fatal(err)
	}
	return info.ModTime()
}

func (v *virtualFS) partFiles() []string {
	var parts []string
	filepath.WalkDir(v.root, func(local string, entry os.DirEntry, err error) error {
		if err == nil && strings.HasSuffix(entry.Name(), partSuffix) {
			parts = append(parts, local)
		}
		return nil
	})
	return parts
}

func (v *virtualFS) isDenied(remote string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	for current := path.Clean(remote); ; current = path.Dir(current) {
		if v.denied[current] {
			return true
		}
		if current == "/" {
			return false
		}
	}
}

func (v *virtualFS) resolve(remote string, followLast bool) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	current := path.Clean(remote)
	for hops := 0; hops < 32; hops++ {
		next, changed := v.resolveOnce(current, followLast)
		if !changed {
			return current, nil
		}
		current = next
	}
	return "", errors.New("too many levels of symbolic links")
}

func (v *virtualFS) resolveOnce(remote string, followLast bool) (string, bool) {
	parts := strings.Split(strings.TrimPrefix(remote, "/"), "/")
	for i := range parts {
		if i == len(parts)-1 && !followLast {
			break
		}
		prefix := "/" + strings.Join(parts[:i+1], "/")
		target, ok := v.links[prefix]
		if !ok {
			continue
		}
		if !path.IsAbs(target) {
			target = path.Join(path.Dir(prefix), target)
		}
		return path.Join(append([]string{target}, parts[i+1:]...)...), true
	}
	return remote, false
}

func (v *virtualFS) access(remote string, followLast bool) (string, error) {
	if v.isDenied(remote) {
		return "", sftp.ErrSSHFxPermissionDenied
	}
	resolved, err := v.resolve(remote, followLast)
	if err != nil {
		return "", err
	}
	if v.isDenied(resolved) {
		return "", sftp.ErrSSHFxPermissionDenied
	}
	return resolved, nil
}

func (v *virtualFS) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	target, err := v.access(r.Filepath, true)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(v.local(target))
	if err != nil {
		return nil, err
	}
	return &slowFile{File: file, owner: v, delay: time.Duration(v.delay.Load())}, nil
}

func (v *virtualFS) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	target, err := v.access(r.Filepath, true)
	if err != nil {
		return nil, err
	}
	flags := os.O_WRONLY | os.O_CREATE
	if r.Pflags().Trunc {
		flags |= os.O_TRUNC
	}
	if r.Pflags().Excl {
		flags |= os.O_EXCL
	}
	file, err := os.OpenFile(v.local(target), flags, 0o644)
	if err != nil {
		return nil, err
	}
	return &slowFile{File: file, owner: v, delay: time.Duration(v.delay.Load())}, nil
}

func (v *virtualFS) Filecmd(r *sftp.Request) error {
	switch r.Method {
	case "Setstat":
		return v.setstat(r)
	case "Rename":
		return v.rename(r.Filepath, r.Target, false)
	case "Mkdir":
		target, err := v.access(r.Filepath, false)
		if err != nil {
			return err
		}
		return os.Mkdir(v.local(target), 0o755)
	case "Rmdir":
		return v.rmdir(r.Filepath)
	case "Remove":
		return v.remove(r.Filepath)
	}
	return sftp.ErrSSHFxOpUnsupported
}

func (v *virtualFS) PosixRename(r *sftp.Request) error {
	return v.rename(r.Filepath, r.Target, true)
}

func (v *virtualFS) setstat(r *sftp.Request) error {
	target, err := v.access(r.Filepath, true)
	if err != nil {
		return err
	}
	attrs, flags := r.Attributes(), r.AttrFlags()
	if flags.Permissions {
		v.setMode(target, attrs.FileMode())
	}
	if flags.Acmodtime {
		if err := os.Chtimes(v.local(target), time.Unix(int64(attrs.Atime), 0), time.Unix(int64(attrs.Mtime), 0)); err != nil {
			return err
		}
	}
	if flags.Size {
		return os.Truncate(v.local(target), int64(attrs.Size))
	}
	return nil
}

func (v *virtualFS) rename(from, to string, replace bool) error {
	source, err := v.access(from, false)
	if err != nil {
		return err
	}
	destination, err := v.access(to, false)
	if err != nil {
		return err
	}
	if v.exists(destination) && !replace {
		return sftp.ErrSSHFxFailure
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if target, isLink := v.links[source]; isLink {
		delete(v.links, source)
		v.links[destination] = target
		return nil
	}
	delete(v.links, destination)
	if mode, ok := v.modes[source]; ok {
		delete(v.modes, source)
		v.modes[destination] = mode
	}
	return os.Rename(v.local(source), v.local(destination))
}

func (v *virtualFS) rmdir(remote string) error {
	target, err := v.access(remote, false)
	if err != nil {
		return err
	}
	v.mu.Lock()
	for link := range v.links {
		if path.Dir(link) == target {
			v.mu.Unlock()
			return sftp.ErrSSHFxFailure
		}
	}
	v.mu.Unlock()
	return os.Remove(v.local(target))
}

func (v *virtualFS) remove(remote string) error {
	target, err := v.access(remote, false)
	if err != nil {
		return err
	}
	v.mu.Lock()
	if _, isLink := v.links[target]; isLink {
		delete(v.links, target)
		v.mu.Unlock()
		return nil
	}
	v.mu.Unlock()
	info, err := os.Lstat(v.local(target))
	if err != nil {
		return err
	}
	if info.IsDir() {
		return sftp.ErrSSHFxFailure
	}
	return os.Remove(v.local(target))
}

func (v *virtualFS) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	switch r.Method {
	case "List":
		return v.list(r.Filepath)
	case "Stat":
		target, err := v.access(r.Filepath, true)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(v.local(target))
		if err != nil {
			return nil, err
		}
		return listerAt{v.describe(target, path.Base(r.Filepath), info)}, nil
	}
	return nil, sftp.ErrSSHFxOpUnsupported
}

func (v *virtualFS) Lstat(r *sftp.Request) (sftp.ListerAt, error) {
	target, err := v.access(r.Filepath, false)
	if err != nil {
		return nil, err
	}
	if link, ok := v.linkInfo(target); ok {
		return listerAt{link}, nil
	}
	info, err := os.Lstat(v.local(target))
	if err != nil {
		return nil, err
	}
	return listerAt{v.describe(target, path.Base(target), info)}, nil
}

func (v *virtualFS) Readlink(remote string) (string, error) {
	target, err := v.access(remote, false)
	if err != nil {
		return "", err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	linkTarget, ok := v.links[target]
	if !ok {
		return "", os.ErrInvalid
	}
	return linkTarget, nil
}

func (v *virtualFS) list(remote string) (sftp.ListerAt, error) {
	dir, err := v.access(remote, true)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(v.local(dir))
	if err != nil {
		return nil, err
	}
	var infos listerAt
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		infos = append(infos, v.describe(path.Join(dir, entry.Name()), entry.Name(), info))
	}
	v.mu.Lock()
	var links []string
	for link := range v.links {
		if path.Dir(link) == dir {
			links = append(links, link)
		}
	}
	v.mu.Unlock()
	for _, link := range links {
		if info, ok := v.linkInfo(link); ok {
			infos = append(infos, info)
		}
	}
	return infos, nil
}

func (v *virtualFS) linkInfo(remote string) (os.FileInfo, bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	target, ok := v.links[remote]
	if !ok {
		return nil, false
	}
	return &testFileInfo{
		name:  path.Base(remote),
		size:  int64(len(target)),
		mode:  os.ModeSymlink | 0o777,
		mtime: time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC),
	}, true
}

func (v *virtualFS) describe(remote, name string, info os.FileInfo) os.FileInfo {
	mode := info.Mode()
	v.mu.Lock()
	override, ok := v.modes[remote]
	v.mu.Unlock()
	if ok {
		mode = mode&^permissionBitsMask | override
	}
	return &testFileInfo{name: name, size: info.Size(), mode: mode, mtime: info.ModTime()}
}

type testFileInfo struct {
	name  string
	size  int64
	mode  os.FileMode
	mtime time.Time
}

func (i *testFileInfo) Name() string       { return i.name }
func (i *testFileInfo) Size() int64        { return i.size }
func (i *testFileInfo) Mode() os.FileMode  { return i.mode }
func (i *testFileInfo) ModTime() time.Time { return i.mtime }
func (i *testFileInfo) IsDir() bool        { return i.mode.IsDir() }
func (i *testFileInfo) Sys() any           { return nil }

type listerAt []os.FileInfo

func (l listerAt) ListAt(target []os.FileInfo, offset int64) (int, error) {
	if offset >= int64(len(l)) {
		return 0, io.EOF
	}
	n := copy(target, l[offset:])
	if n < len(target) {
		return n, io.EOF
	}
	return n, nil
}

type slowFile struct {
	*os.File
	owner *virtualFS
	delay time.Duration
}

func (f *slowFile) ReadAt(buffer []byte, offset int64) (int, error) {
	defer f.owner.enterCall()()
	time.Sleep(f.delay)
	return f.File.ReadAt(buffer, offset)
}

func (f *slowFile) WriteAt(data []byte, offset int64) (int, error) {
	defer f.owner.enterCall()()
	time.Sleep(f.delay)
	return f.File.WriteAt(data, offset)
}

func (v *virtualFS) enterCall() (leave func()) {
	running := v.callsInFlight.Add(1)
	for {
		peak := v.peakCallsInFlight.Load()
		if running <= peak || v.peakCallsInFlight.CompareAndSwap(peak, running) {
			break
		}
	}
	return func() { v.callsInFlight.Add(-1) }
}

func (v *virtualFS) takePeakCalls() int64 {
	return v.peakCallsInFlight.Swap(0)
}
