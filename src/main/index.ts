import { spawn as spawnProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, Menu, safeStorage, screen, session, shell } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import { listClaudeSessions } from './claude-sessions'
import { findOnPath } from './executables'
import { HostsService } from './hosts-service'
import { HostsStore } from './hosts-store'
import { LocalEditing } from './local-editing'
import { listDrives, listLocalDirectory } from './local-files'
import { registerIpc } from './ipc'
import { buildJumpList } from './jump-list'
import { parseLaunchArgs } from './launch-args'
import { LaunchRouter } from './launch-router'
import {
  CONTENT_SECURITY_POLICY,
  DEV_CONTENT_SECURITY_POLICY,
  isTrustedUrl,
  type TrustedEntry
} from './security'
import { createShellDiscoveryDeps, discoverShells, type ShellDefinition } from './shells'
import { SecretStore } from './secret-store'
import { SettingsStore } from './settings-store'
import { SshHelper, type HelperChild } from './ssh-helper'
import { SshService } from './ssh-service'
import { TerminalService } from './terminal-service'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  resolveWindowBounds
} from './window-state'
import { findAgent } from '@shared/agents'
import { IpcChannel } from '@shared/ipc'
import { toAppState, type LoadedSettings, type SettingsNotice } from '@shared/settings'

app.setName('AgentGrid')

const userDataDir = app.getPath('userData')
const settingsStore = new SettingsStore(userDataDir)
const hostsStore = new HostsStore(userDataDir)
const secretStore = new SecretStore(userDataDir, {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptStringAsync(text),
  decrypt: async (data) => (await safeStorage.decryptStringAsync(data)).result
})
const knownHostsPath = join(userDataDir, 'known_hosts')
let startupNotices: SettingsNotice[] = []

function loadedSettings(): LoadedSettings {
  const notices = startupNotices
  startupNotices = []
  return { state: toAppState(settingsStore.snapshot()), notices }
}

const RENDERER_FLUSH_TIMEOUT_MS = 800
let flushWaiter: (() => void) | null = null

function requestRendererFlush(): Promise<void> {
  const contents = mainWindow?.webContents
  if (!contents || contents.isDestroyed()) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      flushWaiter = null
      resolve()
    }
    const timer = setTimeout(finish, RENDERER_FLUSH_TIMEOUT_MS)
    flushWaiter = finish
    contents.send(IpcChannel.settingsFlushRequest)
  })
}

const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const trustedEntry: TrustedEntry = {
  devServerUrl,
  fileUrl: pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

let mainWindow: BrowserWindow | null = null

function claudeProjectsRoot(): string {
  const override = process.env['AGENTGRID_CLAUDE_PROJECTS_DIR']
  if (override && !app.isPackaged) return override
  return join(app.getPath('home'), '.claude', 'projects')
}

const discoveryDeps = createShellDiscoveryDeps()
let shellsPromise: Promise<ShellDefinition[]> | null = null

function getShells(): Promise<ShellDefinition[]> {
  shellsPromise ??= discoverShells(discoveryDeps)
  return shellsPromise
}

function sendToWindow(channel: string, payload: unknown): void {
  const contents = mainWindow?.webContents
  if (contents && !contents.isDestroyed()) contents.send(channel, payload)
}

function listSessions(): ReturnType<typeof listClaudeSessions> {
  return listClaudeSessions(claudeProjectsRoot())
}

const launchRouter = new LaunchRouter({
  listSessions,
  send: (request) => sendToWindow(IpcChannel.launchRequest, request)
})

const JUMP_LIST_MIN_INTERVAL_MS = 60_000
let lastJumpListUpdate = 0

async function refreshJumpList(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'win32') return
  const now = Date.now()
  if (now - lastJumpListUpdate < JUMP_LIST_MIN_INTERVAL_MS) return
  lastJumpListUpdate = now
  try {
    const result = app.setJumpList(buildJumpList(await listSessions(), process.execPath))
    if (result !== 'ok') console.warn(`Jump list was not updated: ${result}`)
  } catch (error) {
    console.warn('Jump list update failed', error)
  }
}

const terminals = new TerminalService({
  spawn: (file, args, options) =>
    spawnPty(file, args, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env
    }),
  getShells,
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  findExecutable: (name) => findOnPath(name, discoveryDeps),
  baseEnv: process.env,
  emitData: (event) => sendToWindow(IpcChannel.terminalData, event),
  emitExit: (event) => sendToWindow(IpcChannel.terminalExit, event)
})

function helperExecutable(): string {
  const override = process.env['AGENTGRID_SSH_HELPER']
  if (override && !app.isPackaged) return override
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', 'agentgrid-ssh.exe')
    : join(app.getAppPath(), 'resources', 'bin', 'agentgrid-ssh.exe')
}

function startHelper(): HelperChild | null {
  const executable = helperExecutable()
  if (!existsSync(executable)) return null
  const extraKnownHosts = join(app.getPath('home'), '.ssh', 'known_hosts')
  const child = spawnProcess(
    executable,
    ['--known-hosts', knownHostsPath, '--extra-known-hosts', extraKnownHosts],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  )
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdin.on('error', () => undefined)
  return {
    write: (line) => child.stdin.write(line),
    end: () => child.stdin.end(),
    kill: () => child.kill(),
    onStdout: (listener) => child.stdout.on('data', listener),
    onStderr: (listener) => child.stderr.on('data', listener),
    onExit: (listener) => {
      child.once('exit', listener)
      child.once('error', listener)
    }
  }
}

const sshHelper = new SshHelper(startHelper, (message) => {
  if (!app.isPackaged) console.warn(`[ssh] ${message}`)
})

const sshService = new SshService({
  helper: sshHelper,
  terminals,
  hosts: hostsStore,
  secrets: secretStore,
  emitEvent: (event) => sendToWindow(IpcChannel.sshEvent, event),
  emitSftpEvent: (event) => sendToWindow(IpcChannel.sftpEvent, event),
  now: () => Date.now()
})

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }]

function parentWindowFor<T>(open: (window: BrowserWindow | null) => Promise<T>): Promise<T> {
  return open(mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
}

const hostsService = new HostsService({
  store: hostsStore,
  secrets: secretStore,
  knownHostsPath,
  chooseExportPath: () =>
    parentWindowFor(async (window) => {
      const options = { defaultPath: 'agentgrid-serverler.json', filters: JSON_FILTER }
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      return result.canceled || !result.filePath ? null : result.filePath
    }),
  chooseImportPath: () =>
    parentWindowFor(async (window) => {
      const options = { properties: ['openFile' as const], filters: JSON_FILTER }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }),
  chooseKeyPath: () =>
    parentWindowFor(async (window) => {
      const options = {
        properties: ['openFile' as const, 'showHiddenFiles' as const],
        defaultPath: join(app.getPath('home'), '.ssh')
      }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }),
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, text) => writeFile(path, text, 'utf8'),
  newId: () => crypto.randomUUID()
})

const localEditing = new LocalEditing({
  tempDir: app.getPath('temp'),
  windowsDir: process.env['SystemRoot'] ?? 'C:\\Windows',
  findOnPath: (name) => findOnPath(name, discoveryDeps),
  emitChanged: (path) => sendToWindow(IpcChannel.localChanged, { path }),
  newId: () => crypto.randomUUID(),
  ...(!app.isPackaged && process.env['AGENTGRID_EDITOR'] ? { editorOverride: process.env['AGENTGRID_EDITOR'] } : {})
})

function stopAllTerminals(): void {
  terminals.killAll()
  sshService.cancelAll()
  localEditing.unwatchAll()
}

function installSecurityPolicies(): void {
  const csp = devServerUrl ? DEV_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
}

const WINDOW_STATE_DEBOUNCE_MS = 600

function trackWindowState(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const capture = (): void => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return
    const bounds = window.getNormalBounds()
    void settingsStore.updateWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: window.isMaximized()
    })
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(capture, WINDOW_STATE_DEBOUNCE_MS)
  }
  window.on('resize', schedule)
  window.on('move', schedule)
  window.on('maximize', schedule)
  window.on('unmaximize', schedule)
}

function createWindow(): void {
  const saved = resolveWindowBounds(
    settingsStore.windowState,
    screen.getAllDisplays().map((display) => display.workArea)
  )
  const window = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#0d0f12',
    title: 'AgentGrid',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0f12', symbolColor: '#aab2bd', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  if (settingsStore.windowState) {
    const position = saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}
    window.setBounds({ width: saved.width, height: saved.height, ...position })
    const actual = window.getBounds()
    const widthError = actual.width - saved.width
    const heightError = actual.height - saved.height
    if (widthError !== 0 || heightError !== 0) {
      window.setBounds({
        width: saved.width - widthError,
        height: saved.height - heightError,
        ...position
      })
    }
  }

  window.once('ready-to-show', () => {
    if (saved.maximized) window.maximize()
    window.show()
  })

  trackWindowState(window)

  let closeApproved = false
  window.on('close', (event) => {
    if (closeApproved) return
    event.preventDefault()
    void requestRendererFlush().then(() => {
      closeApproved = true
      if (!window.isDestroyed()) window.close()
    })
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url, trustedEntry)) event.preventDefault()
  })

  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      stopAllTerminals()
      launchRouter.rendererReloaded()
    }
  })

  window.on('focus', () => void refreshJumpList())

  window.on('closed', () => {
    stopAllTerminals()
    mainWindow = null
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = window
}

const hasLock = app.requestSingleInstanceLock()

if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    void launchRouter.handle(parseLaunchArgs(argv))
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('az.agentgrid.app')
    Menu.setApplicationMenu(null)
    installSecurityPolicies()
    startupNotices = (await settingsStore.load()).notices
    const hostsReport = await hostsStore.load()
    await secretStore.load()
    if (hostsReport.preservedAs) startupNotices.push({ kind: 'hosts-unreadable', backupFile: hostsReport.preservedAs })
    if (hostsReport.dropped > 0) startupNotices.push({ kind: 'dropped-hosts', count: hostsReport.dropped })
    registerIpc(() => mainWindow, trustedEntry, {
      terminals,
      hosts: hostsService,
      ssh: sshService,
      local: {
        list: listLocalDirectory,
        places: () => ({
          home: app.getPath('home'),
          downloads: app.getPath('downloads'),
          drives: listDrives()
        }),
        pickFiles: () =>
          parentWindowFor(async (window) => {
            const options = { properties: ['openFile' as const, 'multiSelections' as const] }
            const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
            return { paths: result.canceled ? [] : result.filePaths }
          }),
        reveal: (path) => shell.showItemInFolder(path),
        editPath: (name) => localEditing.editPath(name),
        openInEditor: (path) => localEditing.openInEditor(path),
        watch: (path) => localEditing.watch(path),
        unwatch: (path) => localEditing.unwatch(path)
      },
      getShells,
      listSessions,
      agentStatus: () => ({
        claude: findOnPath(findAgent('claude').command, discoveryDeps) !== null,
        codex: findOnPath(findAgent('codex').command, discoveryDeps) !== null,
        gemini: findOnPath(findAgent('gemini').command, discoveryDeps) !== null
      }),
      takePendingLaunch: () => launchRouter.takePending(),
      loadSettings: loadedSettings,
      saveSettings: (state) => void settingsStore.save(state),
      settingsFlushed: () => flushWaiter?.()
    })
    void getShells()
    createWindow()
    void launchRouter.handle(parseLaunchArgs(process.argv))
    void refreshJumpList()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  let settingsFlushedForQuit = false
  app.on('before-quit', (event) => {
    stopAllTerminals()
    sshHelper.stop()
    if (settingsFlushedForQuit) return
    event.preventDefault()
    void Promise.allSettled([settingsStore.flush(), hostsStore.flush(), secretStore.flush()]).finally(() => {
      settingsFlushedForQuit = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
