import { release } from 'node:os'
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import {
  ClipboardWriteSchema,
  ExternalOpenSchema,
  IpcChannel,
  TerminalAckSchema,
  TerminalCreateRequestSchema,
  TerminalKillSchema,
  TerminalResizeSchema,
  TerminalWriteSchema,
  type AppInfo,
  type ClaudeSession,
  type LaunchRequest,
  type ProjectPickResult,
  type ShellInfo,
  type TerminalCreateResult
} from '@shared/ipc'
import { AppStateSchema, type AppState, type LoadedSettings } from '@shared/settings'
import { isOpenableExternalUrl, isTrustedSender, type TrustedEntry } from './security'
import type { ShellDefinition } from './shells'
import type { TerminalService } from './terminal-service'

export interface IpcServices {
  terminals: TerminalService
  getShells(): Promise<ShellDefinition[]>
  listSessions(): Promise<ClaudeSession[]>
  takePendingLaunch(): LaunchRequest[]
  loadSettings(): LoadedSettings
  saveSettings(state: AppState): void
  settingsFlushed(): void
}

function windowsBuildNumber(): number {
  const build = Number(release().split('.')[2])
  return Number.isInteger(build) && build > 0 ? build : 0
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  entry: TrustedEntry,
  services: IpcServices
): void {
  function isTrusted(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
    const window = getWindow()
    return isTrustedSender(event.senderFrame, window?.webContents ?? null, entry)
  }

  function guard(event: IpcMainInvokeEvent): void {
    if (!isTrusted(event)) throw new Error('Untrusted IPC sender')
  }

  ipcMain.handle(IpcChannel.appInfo, (event): AppInfo => {
    guard(event)
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      osBuild: windowsBuildNumber(),
      homeDir: app.getPath('home')
    }
  })

  ipcMain.handle(IpcChannel.projectPick, async (event): Promise<ProjectPickResult> => {
    guard(event)
    const window = getWindow()
    const options = { properties: ['openDirectory' as const] }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    return { path: result.canceled || !path ? null : path }
  })

  ipcMain.handle(IpcChannel.shellList, async (event): Promise<ShellInfo[]> => {
    guard(event)
    const shells = await services.getShells()
    return shells.map(({ id, label, kind }) => ({ id, label, kind }))
  })

  ipcMain.handle(
    IpcChannel.terminalCreate,
    async (event, payload: unknown): Promise<TerminalCreateResult> => {
      guard(event)
      const parsed = TerminalCreateRequestSchema.safeParse(payload)
      if (!parsed.success) throw new Error('Invalid terminal create request')
      return services.terminals.create(parsed.data)
    }
  )

  ipcMain.on(IpcChannel.terminalWrite, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = TerminalWriteSchema.safeParse(payload)
    if (parsed.success) services.terminals.write(parsed.data.id, parsed.data.data)
  })

  ipcMain.on(IpcChannel.terminalResize, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = TerminalResizeSchema.safeParse(payload)
    if (parsed.success) services.terminals.resize(parsed.data.id, parsed.data.cols, parsed.data.rows)
  })

  ipcMain.on(IpcChannel.terminalAck, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = TerminalAckSchema.safeParse(payload)
    if (parsed.success) services.terminals.ack(parsed.data.id, parsed.data.bytes)
  })

  ipcMain.on(IpcChannel.terminalKill, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = TerminalKillSchema.safeParse(payload)
    if (parsed.success) services.terminals.kill(parsed.data.id)
  })

  ipcMain.handle(IpcChannel.sessionsList, async (event): Promise<ClaudeSession[]> => {
    guard(event)
    return services.listSessions()
  })

  ipcMain.handle(IpcChannel.settingsLoad, (event): LoadedSettings => {
    guard(event)
    return services.loadSettings()
  })

  ipcMain.on(IpcChannel.settingsSave, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = AppStateSchema.safeParse(payload)
    if (parsed.success) services.saveSettings(parsed.data satisfies AppState)
  })

  ipcMain.on(IpcChannel.settingsFlushDone, (event) => {
    if (isTrusted(event)) services.settingsFlushed()
  })

  ipcMain.handle(IpcChannel.launchTakePending, (event): LaunchRequest[] => {
    guard(event)
    return services.takePendingLaunch()
  })

  ipcMain.handle(IpcChannel.clipboardRead, async (event): Promise<string> => {
    guard(event)
    return await clipboard.readText()
  })

  ipcMain.handle(IpcChannel.clipboardWrite, async (event, payload: unknown): Promise<void> => {
    guard(event)
    const parsed = ClipboardWriteSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid clipboard payload')
    await clipboard.writeText(parsed.data.text)
  })

  ipcMain.handle(IpcChannel.externalOpen, async (event, payload: unknown): Promise<boolean> => {
    guard(event)
    const parsed = ExternalOpenSchema.safeParse(payload)
    if (!parsed.success || !isOpenableExternalUrl(parsed.data.url)) return false
    await shell.openExternal(parsed.data.url)
    return true
  })
}
