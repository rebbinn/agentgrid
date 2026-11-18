import { z } from 'zod'
import { AGENT_IDS } from './agents'
import type { HostSaveRequest, HostSaveResult, HostView, HostsTransferResult, KeyPickResult } from './hosts'
import { CommandLineSchema, type AppState, type LoadedSettings } from './settings'
import type {
  LocalChangedEvent,
  LocalListResult,
  LocalPickResult,
  LocalPlaces,
  SftpEvent,
  SftpOpenRequest,
  SftpOpenResult,
  SftpReply,
  SftpRequest,
  TransferRequest
} from './sftp'
import type { SshAnswer, SshEvent, SshOpenRequest, SshResult, SshTestRequest } from './ssh'

export const IpcChannel = {
  appInfo: 'app:info',
  projectPick: 'project:pick',
  shellList: 'shell:list',
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalAck: 'terminal:ack',
  terminalKill: 'terminal:kill',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  sessionsList: 'sessions:list',
  agentsStatus: 'agents:status',
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  settingsFlushRequest: 'settings:flush-request',
  settingsFlushDone: 'settings:flush-done',
  launchTakePending: 'launch:take-pending',
  launchRequest: 'launch:request',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  externalOpen: 'external:open',
  hostsList: 'hosts:list',
  hostsSave: 'hosts:save',
  hostsDelete: 'hosts:delete',
  hostsExport: 'hosts:export',
  hostsImport: 'hosts:import',
  hostsPickKey: 'hosts:pick-key',
  hostsForgetKey: 'hosts:forget-key',
  sshOpen: 'ssh:open',
  sshTest: 'ssh:test',
  sshAnswer: 'ssh:answer',
  sshCancel: 'ssh:cancel',
  sshEvent: 'ssh:event',
  sftpOpen: 'sftp:open',
  sftpRequest: 'sftp:request',
  sftpTransfer: 'sftp:transfer',
  sftpCancelTransfer: 'sftp:cancel-transfer',
  sftpClose: 'sftp:close',
  sftpEvent: 'sftp:event',
  localList: 'local:list',
  localPlaces: 'local:places',
  localPickFiles: 'local:pick-files',
  localReveal: 'local:reveal',
  localEditPath: 'local:edit-path',
  localOpenInEditor: 'local:open-in-editor',
  localWatch: 'local:watch',
  localUnwatch: 'local:unwatch',
  localChanged: 'local:changed'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export const MAX_WRITE_CHARS = 1_000_000
export const MAX_COLS = 1000
export const MAX_ROWS = 500

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  osBuild: z.number().int().nonnegative(),
  homeDir: z.string().min(1)
})
export type AppInfo = z.infer<typeof AppInfoSchema>

export const ProjectPickResultSchema = z.object({
  path: z.string().nullable()
})
export type ProjectPickResult = z.infer<typeof ProjectPickResultSchema>

export const SHELL_KINDS = ['cmd', 'powershell', 'pwsh', 'gitbash', 'wsl'] as const
export type ShellKind = (typeof SHELL_KINDS)[number]

export const ShellInfoSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string(),
  kind: z.enum(SHELL_KINDS)
})
export type ShellInfo = z.infer<typeof ShellInfoSchema>
export const ShellListSchema = z.array(ShellInfoSchema)

const TerminalIdSchema = z.uuid()
const ColsSchema = z.number().int().min(1).max(MAX_COLS)
const RowsSchema = z.number().int().min(1).max(MAX_ROWS)

export const TerminalCreateRequestSchema = z
  .object({
    id: TerminalIdSchema,
    shellId: z.string().min(1).max(128),
    cwd: z.string().min(1).max(1024),
    agentId: z.enum(AGENT_IDS).optional(),
    resumeSessionId: z.uuid().optional(),
    startupCommand: CommandLineSchema.optional(),
    requireInstalled: z.boolean().optional(),
    cols: ColsSchema,
    rows: RowsSchema
  })
  .refine((request) => request.resumeSessionId === undefined || request.agentId === 'claude', {
    message: 'Only Claude sessions can be resumed'
  })
  .refine((request) => request.startupCommand === undefined || request.agentId === undefined, {
    message: 'A custom command cannot be combined with a built-in agent'
  })
export type TerminalCreateRequest = z.infer<typeof TerminalCreateRequestSchema>

export const ClaudeSessionSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(300),
  cwd: z.string().min(1).max(1024),
  modifiedAt: z.number().int().nonnegative()
})
export type ClaudeSession = z.infer<typeof ClaudeSessionSchema>
export const ClaudeSessionListSchema = z.array(ClaudeSessionSchema)

export const AgentStatusSchema = z.object({
  claude: z.boolean(),
  codex: z.boolean(),
  gemini: z.boolean()
})
export type AgentStatus = z.infer<typeof AgentStatusSchema>

export const LaunchRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claude') }),
  z.object({ kind: z.literal('resume'), session: ClaudeSessionSchema }),
  z.object({ kind: z.literal('session-missing') })
])
export type LaunchRequest = z.infer<typeof LaunchRequestSchema>
export const LaunchRequestListSchema = z.array(LaunchRequestSchema)

export const TERMINAL_ERROR_CODES = [
  'cwd-missing',
  'shell-missing',
  'agent-missing',
  'duplicate-id',
  'spawn-failed'
] as const
export type TerminalErrorCode = (typeof TERMINAL_ERROR_CODES)[number]

export const TerminalCreateResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), pid: z.number().int(), shell: ShellInfoSchema }),
  z.object({
    ok: z.literal(false),
    code: z.enum(TERMINAL_ERROR_CODES),
    message: z.string()
  })
])
export type TerminalCreateResult = z.infer<typeof TerminalCreateResultSchema>

export const TerminalWriteSchema = z.object({
  id: TerminalIdSchema,
  data: z.string().max(MAX_WRITE_CHARS)
})

export const TerminalResizeSchema = z.object({
  id: TerminalIdSchema,
  cols: ColsSchema,
  rows: RowsSchema
})

export const TerminalAckSchema = z.object({
  id: TerminalIdSchema,
  bytes: z.number().int().positive().max(MAX_WRITE_CHARS * 8)
})

export const TerminalKillSchema = z.object({ id: TerminalIdSchema })

export const TerminalDataEventSchema = z.object({
  id: TerminalIdSchema,
  data: z.string()
})
export type TerminalDataEvent = z.infer<typeof TerminalDataEventSchema>

export const EXIT_REASONS = ['exit', 'lost', 'closed'] as const
export type ExitReason = (typeof EXIT_REASONS)[number]

export const TerminalExitEventSchema = z.object({
  id: TerminalIdSchema,
  exitCode: z.number().int(),
  signal: z.number().int().optional(),
  reason: z.enum(EXIT_REASONS).optional()
})
export type TerminalExitEvent = z.infer<typeof TerminalExitEventSchema>

export const ClipboardWriteSchema = z.object({ text: z.string().max(MAX_WRITE_CHARS) })

export const ExternalOpenSchema = z.object({ url: z.string().max(2048) })

export interface AgentGridApi {
  app: {
    info(): Promise<AppInfo>
  }
  project: {
    pick(): Promise<ProjectPickResult>
  }
  shell: {
    list(): Promise<ShellInfo[]>
  }
  terminal: {
    create(request: TerminalCreateRequest): Promise<TerminalCreateResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    ack(id: string, bytes: number): void
    kill(id: string): void
    onData(listener: (event: TerminalDataEvent) => void): () => void
    onExit(listener: (event: TerminalExitEvent) => void): () => void
  }
  sessions: {
    list(): Promise<ClaudeSession[]>
  }
  agents: {
    status(): Promise<AgentStatus>
  }
  launcher: {
    takePending(): Promise<LaunchRequest[]>
    onRequest(listener: (request: LaunchRequest) => void): () => void
  }
  settings: {
    load(): Promise<LoadedSettings>
    save(state: AppState): void
    onFlushRequest(listener: () => void): () => void
    flushDone(): void
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  external: {
    open(url: string): Promise<boolean>
  }
  hosts: {
    list(): Promise<HostView[]>
    save(request: HostSaveRequest): Promise<HostSaveResult>
    remove(id: string): Promise<void>
    exportAll(): Promise<HostsTransferResult>
    importFile(): Promise<HostsTransferResult>
    pickKey(): Promise<KeyPickResult>
    forgetHostKey(id: string): Promise<boolean>
  }
  ssh: {
    open(request: SshOpenRequest): Promise<SshResult>
    test(request: SshTestRequest): Promise<SshResult>
    answer(answer: SshAnswer): void
    cancel(sessionId: string): void
    onEvent(listener: (event: SshEvent) => void): () => void
  }
  sftp: {
    open(request: SftpOpenRequest): Promise<SftpOpenResult>
    request(request: SftpRequest): Promise<SftpReply>
    transfer(request: TransferRequest): void
    cancelTransfer(sessionId: string, transferId: string): void
    close(sessionId: string): void
    onEvent(listener: (event: SftpEvent) => void): () => void
  }
  local: {
    list(path: string): Promise<LocalListResult>
    places(): Promise<LocalPlaces>
    pickFiles(): Promise<LocalPickResult>
    reveal(path: string): Promise<void>
    pathForFile(file: File): string
    editPath(name: string): Promise<string>
    openInEditor(path: string): Promise<boolean>
    watch(path: string): void
    unwatch(path: string): void
    onChanged(listener: (event: LocalChangedEvent) => void): () => void
  }
}
