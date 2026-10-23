import { statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session, shell } from 'electron'
import { spawn as spawnPty } from 'node-pty'
import { findOnPath } from './executables'
import { registerIpc } from './ipc'
import {
  CONTENT_SECURITY_POLICY,
  DEV_CONTENT_SECURITY_POLICY,
  isTrustedUrl,
  type TrustedEntry
} from './security'
import { createShellDiscoveryDeps, discoverShells, type ShellDefinition } from './shells'
import { TerminalService } from './terminal-service'
import { IpcChannel } from '@shared/ipc'

app.setName('AgentGrid')

const devServerUrl = process.env['ELECTRON_RENDERER_URL']
const trustedEntry: TrustedEntry = {
  devServerUrl,
  fileUrl: pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

let mainWindow: BrowserWindow | null = null

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

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 480,
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

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url, trustedEntry)) event.preventDefault()
  })

  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) terminals.killAll()
  })

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
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('az.agentgrid.app')
    installSecurityPolicies()
    registerIpc(() => mainWindow, trustedEntry, { terminals, getShells })
    void getShells()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    terminals.killAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
