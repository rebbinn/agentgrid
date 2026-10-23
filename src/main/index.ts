import { statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, screen, session, shell } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import { listClaudeSessions } from './claude-sessions'
import { findOnPath } from './executables'
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
import { SettingsStore } from './settings-store'
import { TerminalService } from './terminal-service'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  resolveWindowBounds
} from './window-state'
import { IpcChannel } from '@shared/ipc'
import { toAppState, type LoadedSettings, type SettingsNotice } from '@shared/settings'

app.setName('AgentGrid')

const settingsStore = new SettingsStore(app.getPath('userData'))
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
      terminals.killAll()
      launchRouter.rendererReloaded()
    }
  })

  window.on('focus', () => void refreshJumpList())

  window.on('closed', () => {
    terminals.killAll()
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
    installSecurityPolicies()
    startupNotices = (await settingsStore.load()).notices
    registerIpc(() => mainWindow, trustedEntry, {
      terminals,
      getShells,
      listSessions,
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
    terminals.killAll()
    if (settingsFlushedForQuit) return
    event.preventDefault()
    void settingsStore.flush().finally(() => {
      settingsFlushedForQuit = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
