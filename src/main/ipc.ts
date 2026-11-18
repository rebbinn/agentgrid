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
  type AgentStatus,
  type AppInfo,
  type ClaudeSession,
  type LaunchRequest,
  type ProjectPickResult,
  type ShellInfo,
  type TerminalCreateResult
} from '@shared/ipc'
import {
  HostIdSchema,
  HostSaveRequestSchema,
  type HostSaveResult,
  type HostView,
  type HostsTransferResult,
  type KeyPickResult
} from '@shared/hosts'
import { AppStateSchema, type AppState, type LoadedSettings } from '@shared/settings'
import {
  SshAnswerSchema,
  SshCancelSchema,
  SshOpenRequestSchema,
  SshTestRequestSchema,
  type SshResult
} from '@shared/ssh'
import {
  EditPathRequestSchema,
  LocalListRequestSchema,
  LocalPathRequestSchema,
  SftpCloseSchema,
  SftpOpenRequestSchema,
  SftpRequestSchema,
  TransferCancelSchema,
  TransferRequestSchema,
  type LocalListResult,
  type LocalPickResult,
  type LocalPlaces,
  type SftpOpenResult,
  type SftpReply
} from '@shared/sftp'
import type { HostsService } from './hosts-service'
import { isOpenableExternalUrl, isTrustedSender, type TrustedEntry } from './security'
import type { ShellDefinition } from './shells'
import type { SshService } from './ssh-service'
import type { TerminalService } from './terminal-service'

export interface IpcServices {
  terminals: TerminalService
  hosts: HostsService
  ssh: SshService
  local: {
    list(path: string): Promise<LocalListResult>
    places(): LocalPlaces
    pickFiles(): Promise<LocalPickResult>
    reveal(path: string): void
    editPath(name: string): Promise<string>
    openInEditor(path: string): Promise<boolean>
    watch(path: string): void
    unwatch(path: string): void
  }
  getShells(): Promise<ShellDefinition[]>
  listSessions(): Promise<ClaudeSession[]>
  agentStatus(): AgentStatus
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
    if (!parsed.success) return
    if (!services.terminals.kill(parsed.data.id)) services.ssh.cancel(parsed.data.id)
  })

  ipcMain.handle(IpcChannel.sessionsList, async (event): Promise<ClaudeSession[]> => {
    guard(event)
    return services.listSessions()
  })

  ipcMain.handle(IpcChannel.agentsStatus, (event): AgentStatus => {
    guard(event)
    return services.agentStatus()
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

  ipcMain.handle(IpcChannel.hostsList, (event): HostView[] => {
    guard(event)
    return services.hosts.views()
  })

  ipcMain.handle(IpcChannel.hostsSave, async (event, payload: unknown): Promise<HostSaveResult> => {
    guard(event)
    const parsed = HostSaveRequestSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, code: 'invalid' }
    return services.hosts.save(parsed.data)
  })

  ipcMain.handle(IpcChannel.hostsDelete, async (event, payload: unknown): Promise<void> => {
    guard(event)
    const parsed = HostIdSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid host id')
    await services.hosts.remove(parsed.data.id)
  })

  ipcMain.handle(IpcChannel.hostsExport, async (event): Promise<HostsTransferResult> => {
    guard(event)
    return services.hosts.exportAll()
  })

  ipcMain.handle(IpcChannel.hostsImport, async (event): Promise<HostsTransferResult> => {
    guard(event)
    return services.hosts.importFile()
  })

  ipcMain.handle(IpcChannel.hostsPickKey, async (event): Promise<KeyPickResult> => {
    guard(event)
    return services.hosts.pickKey()
  })

  ipcMain.handle(IpcChannel.hostsForgetKey, async (event, payload: unknown): Promise<boolean> => {
    guard(event)
    const parsed = HostIdSchema.safeParse(payload)
    if (!parsed.success) return false
    return services.hosts.forgetHostKey(parsed.data.id)
  })

  ipcMain.handle(IpcChannel.sshOpen, async (event, payload: unknown): Promise<SshResult> => {
    guard(event)
    const parsed = SshOpenRequestSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid SSH open request')
    return services.ssh.open(parsed.data)
  })

  ipcMain.handle(IpcChannel.sshTest, async (event, payload: unknown): Promise<SshResult> => {
    guard(event)
    const parsed = SshTestRequestSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid SSH test request')
    return services.ssh.test(parsed.data)
  })

  ipcMain.on(IpcChannel.sshAnswer, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = SshAnswerSchema.safeParse(payload)
    if (parsed.success) services.ssh.answer(parsed.data)
  })

  ipcMain.on(IpcChannel.sshCancel, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = SshCancelSchema.safeParse(payload)
    if (parsed.success) services.ssh.cancel(parsed.data.sessionId)
  })

  ipcMain.handle(IpcChannel.sftpOpen, async (event, payload: unknown): Promise<SftpOpenResult> => {
    guard(event)
    const parsed = SftpOpenRequestSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid SFTP open request')
    return services.ssh.openSftp(parsed.data)
  })

  ipcMain.handle(IpcChannel.sftpRequest, async (event, payload: unknown): Promise<SftpReply> => {
    guard(event)
    const parsed = SftpRequestSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: { code: 'failure', message: 'invalid request' } }
    return services.ssh.sftpRequest(parsed.data)
  })

  ipcMain.on(IpcChannel.sftpTransfer, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = TransferRequestSchema.safeParse(payload)
    if (parsed.success) services.ssh.transfer(parsed.data)
  })

  ipcMain.on(IpcChannel.sftpCancelTransfer, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = TransferCancelSchema.safeParse(payload)
    if (parsed.success) services.ssh.cancelTransfer(parsed.data.sessionId, parsed.data.transferId)
  })

  ipcMain.on(IpcChannel.sftpClose, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = SftpCloseSchema.safeParse(payload)
    if (parsed.success) services.ssh.closeSftp(parsed.data.sessionId)
  })

  ipcMain.handle(IpcChannel.localList, async (event, payload: unknown): Promise<LocalListResult> => {
    guard(event)
    const parsed = LocalListRequestSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, error: { code: 'not-found', message: '' } }
    return services.local.list(parsed.data.path)
  })

  ipcMain.handle(IpcChannel.localPlaces, (event): LocalPlaces => {
    guard(event)
    return services.local.places()
  })

  ipcMain.handle(IpcChannel.localPickFiles, async (event): Promise<LocalPickResult> => {
    guard(event)
    return services.local.pickFiles()
  })

  ipcMain.handle(IpcChannel.localReveal, (event, payload: unknown): void => {
    guard(event)
    const parsed = LocalPathRequestSchema.safeParse(payload)
    if (parsed.success) services.local.reveal(parsed.data.path)
  })

  ipcMain.handle(IpcChannel.localEditPath, async (event, payload: unknown): Promise<{ path: string }> => {
    guard(event)
    const parsed = EditPathRequestSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid file name')
    return { path: await services.local.editPath(parsed.data.name) }
  })

  ipcMain.handle(IpcChannel.localOpenInEditor, async (event, payload: unknown): Promise<boolean> => {
    guard(event)
    const parsed = LocalPathRequestSchema.safeParse(payload)
    return parsed.success ? services.local.openInEditor(parsed.data.path) : false
  })

  ipcMain.on(IpcChannel.localWatch, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = LocalPathRequestSchema.safeParse(payload)
    if (parsed.success) services.local.watch(parsed.data.path)
  })

  ipcMain.on(IpcChannel.localUnwatch, (event, payload: unknown) => {
    if (!isTrusted(event)) return
    const parsed = LocalPathRequestSchema.safeParse(payload)
    if (parsed.success) services.local.unwatch(parsed.data.path)
  })

  ipcMain.handle(IpcChannel.externalOpen, async (event, payload: unknown): Promise<boolean> => {
    guard(event)
    const parsed = ExternalOpenSchema.safeParse(payload)
    if (!parsed.success || !isOpenableExternalUrl(parsed.data.url)) return false
    await shell.openExternal(parsed.data.url)
    return true
  })
}
